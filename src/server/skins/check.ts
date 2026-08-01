import puppeteer from "puppeteer-core";
import { runtimeStamp } from "@/lib/skins/runtime/stamp";
import { config } from "@/server/config";

/** Whether a script actually draws, which is the one question no amount of
 * reading the source answers. */
export type Checked =
  | { readonly ok: true }
  | { readonly ok: false; readonly why: string };

/** Long enough for a cold tab and a shader link, short enough that a script
 * looping in its own create() does not hold the browser. */
const checkMs = 25_000;
const navigateMs = 60_000;

/** How many may be checked at once. The browser is shared with renders and with
 * whatever else uses that endpoint. */
const atOnce = 2;
let running = 0;

/** How many frames it has to survive. One proves it draws; a few more reach the
 * accumulating state a background keeps between frames, which is where the
 * mistakes that only bite later live. */
const frames = 12;

/** Never the reason as it came: some connection failures stringify the endpoint
 * or the headers, and a deployment may carry the browser's credential in
 * either. */
function reportable(reason: unknown, fallback: string): string {
  const browser = config.renderBrowser;
  const secrets = [
    browser?.endpoint ?? "",
    ...Object.values(browser?.headers ?? {}),
  ].filter((secret) => secret !== "");
  const raw = reason instanceof Error ? reason.message : String(reason);
  return secrets.some((secret) => raw.includes(secret))
    ? fallback
    : raw.slice(0, 300);
}

/** Runs a script the way the roll will, in a real browser, and reports whether
 * it drew. A page on our own origin, because the worker is fetched from our own
 * route and the header that forbids it the network only exists on a response.
 *
 * Without this a broken background is stored happily and fails in the console of
 * whoever opens the page later, where its author never sees it. Passes where
 * there is no browser to try one in, since refusing every background over a
 * missing optional would be worse than keeping one nobody checked. */
export async function checkScript(source: string): Promise<Checked> {
  const browser = config.renderBrowser;
  if (browser === null) {
    return { ok: true };
  }
  if (running >= atOnce) {
    return { ok: false, why: `already trying ${running} backgrounds, wait` };
  }

  running += 1;
  const connection = await puppeteer
    .connect({
      browserWSEndpoint: browser.endpoint,
      headers: browser.headers,
      protocolTimeout: checkMs + navigateMs,
    })
    .catch((reason: unknown) => {
      running -= 1;
      return reportable(reason, "the browser could not be reached");
    });
  if (typeof connection === "string") {
    return { ok: false, why: connection };
  }

  const page = await connection.newPage().catch(() => null);
  try {
    if (page === null) {
      return { ok: false, why: "the browser would not open a tab" };
    }
    await page.goto(`${config.appBaseUrl}/play`, {
      waitUntil: "domcontentloaded",
      timeout: navigateMs,
    });
    const answer = await page.evaluate(
      runInPage,
      source,
      `/api/skins/runtime.js?build=${runtimeStamp}`,
      checkMs,
      frames,
    );
    return answer.ok
      ? { ok: true }
      : { ok: false, why: answer.why ?? "the background would not run" };
  } catch (reason: unknown) {
    return {
      ok: false,
      why: reportable(reason, "the background failed to run"),
    };
  } finally {
    running -= 1;
    await page?.close().catch(() => {});
    await connection.disconnect().catch(() => {});
  }
}

type PageAnswer = {
  ok: boolean;
  why?: string;
};

/** Runs inside the page, so it may reach nothing from this module. Kept apart
 * rather than inline to stay readable, and typed loosely because it is
 * serialised across. */
function runInPage(
  source: string,
  runtimeUrl: string,
  timeoutMs: number,
  wanted: number,
): Promise<PageAnswer> {
  return new Promise((settle) => {
    const worker = new Worker(runtimeUrl);
    let painted = 0;
    let started = false;
    const give = (answer: PageAnswer): void => {
      clearTimeout(timer);
      worker.terminate();
      settle(answer);
    };
    const timer = setTimeout(
      () =>
        give({
          ok: false,
          why: started
            ? `the background drew ${painted} of ${wanted} frames before it ran out of time`
            : "the background did not start in time",
        }),
      timeoutMs,
    );

    /* Something to react to, so a background that reads the notes or the
       harmony is exercised rather than only its idle path. */
    const frame = {
      elapsed: 0,
      position: 0,
      step: 1 / 60,
      keyboardTop: 520,
      notes: [
        {
          x: 300,
          y: 200,
          radius: 9,
          color: "#4ade80",
          pitch: 60,
          velocity: 0.8,
        },
        {
          x: 700,
          y: 380,
          radius: 9,
          color: "#60a5fa",
          pitch: 67,
          velocity: 0.5,
        },
      ],
      strikes: [{ x: 300, color: "#4ade80", pitch: 60, velocity: 0.8 }],
      pressed: [60, 64, 67],
      chord: { name: "CM", root: 0, quality: "major" },
      key: { root: 0, mode: "major" },
    };

    worker.addEventListener("message", (event: MessageEvent) => {
      const message = event.data;
      if (message.kind === "broke") {
        give({ ok: false, why: message.why });
        return;
      }
      if (message.kind === "started") {
        started = true;
        worker.postMessage({
          kind: "resize",
          width: 1280,
          height: 720,
          ratio: 1,
        });
        return;
      }
      if (message.kind === "painted") {
        message.painted.close();
        painted += 1;
      }
      if (painted >= wanted) {
        give({ ok: true });
        return;
      }
      frame.elapsed += frame.step;
      frame.position += frame.step;
      // Only the first frame lands a key, so a background that keeps a pool of
      // them is not handed the same strike a dozen times.
      frame.strikes = painted === 0 ? frame.strikes : [];
      worker.postMessage({ kind: "frame", frame });
    });
    worker.addEventListener("error", (event) =>
      give({ ok: false, why: String(event.message) }),
    );
    worker.postMessage({ kind: "start", source });
  });
}
