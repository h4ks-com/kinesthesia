import { expect, test } from "@playwright/test";
import { runtimeStamp } from "@/lib/skins/runtime/stamp";
import { backgroundApiDoc } from "@/server/skins/doc";
import { seenTour } from "./fixture";

/** The shader the doc offers as the smallest one that compiles, lifted straight
 * out of the prose an author is handed. A documented example that no longer
 * compiles is worse than none: it is the first thing anybody copies. */
const heading = "Smallest shader that compiles:";

function documentedShader(): string {
  const marker = backgroundApiDoc.indexOf(heading);
  expect(marker).toBeGreaterThan(-1);
  const from = backgroundApiDoc.indexOf("shader: {", marker);
  // Past the gain rather than the first closing brace, since the shader's own
  // void main closes before the object the example is showing does.
  const gain = backgroundApiDoc.indexOf("gain:", from);
  const until = backgroundApiDoc.indexOf("}", gain);
  expect(from).toBeGreaterThan(marker);
  expect(until).toBeGreaterThan(gain);
  return backgroundApiDoc.slice(from, until + 1);
}

test("the shader the doc hands out actually compiles and draws", async ({
  page,
}) => {
  test.setTimeout(120000);
  await seenTour(page);
  await page.goto("/play");
  await page.locator("canvas").first().waitFor({ state: "visible" });

  const script = `background({
  name: "Documented",
  blurb: "The example from the doc, run as written.",
  ${documentedShader()},
  create() {
    return {
      mood(frame, view) { return moodOf(frame, view); },
      paint(ctx, view, frame) {
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fillRect(0, view.keyboardTop - 40, view.width, 40);
      },
    };
  },
});`;

  const answer = await page.evaluate(
    ([source, runtimeUrl]) =>
      new Promise<{ ok: boolean; why?: string }>((settle) => {
        const worker = new Worker(runtimeUrl);
        let painted = 0;
        const give = (out: { ok: boolean; why?: string }): void => {
          clearTimeout(timer);
          worker.terminate();
          settle(out);
        };
        const timer = setTimeout(
          () => give({ ok: false, why: `only drew ${painted}` }),
          15000,
        );
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
            worker.postMessage({
              kind: "resize",
              width: 800,
              height: 600,
              ratio: 1,
            });
            return;
          }
          if (message.kind === "painted") {
            message.painted.close();
            painted += 1;
          }
          if (painted >= 3) {
            give({ ok: true });
            return;
          }
          frame.elapsed += frame.step;
          worker.postMessage({ kind: "frame", frame });
        });
        worker.addEventListener("error", (event) =>
          give({ ok: false, why: String(event.message) }),
        );
        worker.postMessage({ kind: "start", source });
      }),
    [script, `/api/skins/runtime.js?build=${runtimeStamp}`] as const,
  );

  console.log(`### documented=${JSON.stringify(answer)}`);
  expect(answer.why ?? "").toBe("");
  expect(answer.ok).toBe(true);
});
