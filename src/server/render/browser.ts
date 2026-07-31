import puppeteer from "puppeteer-core";
import { config } from "@/server/config";
import { failJob, type RenderJob, renderTimeoutMs } from "@/server/render/jobs";

/** The page is a Next route on our own origin, so this only has to cover a cold
 * start, not a render. */
const navigateTimeoutMs = 60_000;

/** How many renders may be in flight. The browser is shared with whatever else
 * uses that endpoint, so this is a courtesy to them as much as a limit on us. */
const atOnce = 2;
/** And how many may be started in an hour, since each one leaves a permanent
 * file behind. */
const perHour = 12;
const hourMs = 60 * 60 * 1000;

let running = 0;
let starts: number[] = [];

export function renderEnabled(): boolean {
  return config.renderBrowser !== null && config.bucket !== null;
}

/** Why a render cannot be started now, or null to go ahead. Counted here rather
 * than per caller: one shared browser is the thing being protected, and every
 * caller arrives holding the same token. */
export function renderRefusal(): string | null {
  const now = Date.now();
  starts = starts.filter((at) => now - at < hourMs);
  if (running >= atOnce) {
    return `Already rendering ${running} songs. Wait for one to finish.`;
  }
  if (starts.length >= perHour) {
    return `That is ${perHour} renders this hour, which is the limit. Try later.`;
  }
  starts.push(now);
  return null;
}

/** Never the reason as it came: the only input to a connection is the endpoint,
 * and some failures stringify it, which would hand the browser's credential to
 * whoever asked for the render. */
function reportable(reason: unknown, fallback: string): string {
  const endpoint = config.renderBrowser?.endpoint ?? "";
  const raw = reason instanceof Error ? reason.message : String(reason);
  return endpoint !== "" && raw.includes(endpoint)
    ? fallback
    : raw.slice(0, 300);
}

/** Drives one render in a browser somewhere else. The page does the work and
 * hands the file back through our own api; this only opens a tab, waits, and
 * closes it however it ends. */
export async function driveRender(job: RenderJob, target: URL): Promise<void> {
  const browser = config.renderBrowser;
  if (browser === null) {
    failJob(job, "No render browser is configured");
    return;
  }

  running += 1;
  const connection = await puppeteer
    .connect({
      browserWSEndpoint: browser.endpoint,
      headers: browser.headers,
      protocolTimeout: renderTimeoutMs,
    })
    .catch((reason: unknown) => {
      failJob(
        job,
        reportable(reason, "The render browser could not be reached"),
      );
      return null;
    });
  if (connection === null) {
    running -= 1;
    return;
  }

  const page = await connection.newPage().catch(() => null);
  // A tab held open past the deadline is the expensive failure here: the browser
  // is shared, so a hung render would starve everything else using it.
  const deadline = setTimeout(() => {
    failJob(job, "The render ran past its time limit");
  }, renderTimeoutMs);

  try {
    if (page === null) {
      failJob(job, "The render browser would not open a tab");
      return;
    }
    // A fresh profile has never seen the walkthrough, and its overlay sits over
    // the player until it is dismissed.
    await page.evaluateOnNewDocument(() => {
      for (const mode of ["watch", "learn", "multiplayer"]) {
        localStorage.setItem(`kinesthesia:tour:${mode}`, "1");
      }
    });
    await page.goto(target.toString(), {
      waitUntil: "domcontentloaded",
      timeout: navigateTimeoutMs,
    });
    // The page reports through our own api rather than through the tab, so
    // finishing is something this already knows without asking the browser.
    while (job.state === "running") {
      await new Promise((wake) => setTimeout(wake, 1000));
    }
  } catch (reason: unknown) {
    failJob(job, reportable(reason, "The render failed"));
  } finally {
    clearTimeout(deadline);
    running -= 1;
    // The tab is closed by hand because the connection is only detached: the
    // browser belongs to somebody else, and a tab left behind by a render that
    // hung would go on burning their cpu forever.
    await page?.close().catch(() => {});
    await connection.disconnect().catch(() => {});
  }
}
