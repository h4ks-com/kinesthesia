import { runtimeStamp } from "@/lib/skins/runtime/stamp";
import type { BackdropSource, SkinFrame, SkinSurface } from "@/lib/skins/types";

/** Where the worker is fetched from. A url rather than a blob, because the
 * policy that forbids a background the network only exists on a response.
 *
 * Stamped with what it contains, so a build that changes the runtime can never
 * be met with a copy a browser kept: a stale worker is missing whichever helper
 * was added last, and every background that reaches for it dies. */
const runtimeUrl = `/api/skins/runtime.js?build=${runtimeStamp}`;

/** A background that spends longer than this on one frame is not drawing, it is
 * stuck, and the tab has no way to interrupt it. Worth the worker on its own:
 * this is a thing that can be stopped. */
const worstFrameMs = 1000;

/** How long a background gets to load and build its shader before it is given
 * up on. */
const startMs = 8000;

type Started = {
  readonly name: string;
  readonly blurb: string;
  readonly directions: readonly ("up" | "down")[];
};

export type Watching = {
  /** Told the first time a background throws, so the roll can drop back to the
   * plain view rather than sit behind a dead worker. */
  readonly onBroke?: (why: string) => void;
  /** False where the caller shows the reason itself, as a picker tile does. A
   * console error is the only report a roll has, so it is on by default; beside
   * a tile that already says a background will not run it is noise, and one per
   * broken tile at that. */
  readonly announce?: boolean;
};

/** Runs one background, somewhere it cannot reach anything. The worker paints
 * both layers and hands back a single picture, because handing back two costs
 * two hundred times as much as handing back one. */
export function scriptBackdrop(
  source: string,
  { onBroke, announce = true }: Watching = {},
): BackdropSource {
  return {
    create({ overlay }: SkinSurface, watching?: (why: string) => void) {
      const ctx = overlay.getContext("2d");
      if (ctx === null) {
        return null;
      }
      // Per mount, never shared: the picker and the roll each hold their own
      // worker, and one settling would otherwise tell the other its background
      // is up when a different one is.
      let settle: ((started: Started) => void) | null = null;
      let give: ((reason: Error) => void) | null = null;
      const started = new Promise<Started>((yes, no) => {
        settle = yes;
        give = no;
      });
      const worker = new Worker(runtimeUrl);
      let dead = false;
      let ratio = 1;
      const view = { width: 0, height: 0 };

      const die = (why: string): void => {
        if (dead) {
          return;
        }
        dead = true;
        // Whoever is waiting on this frame is told it is not coming, or a render
        // awaiting it would never take another step.
        waiting?.(null);
        waiting = null;
        // Said out loud: a background that stops drawing looks exactly like one
        // the device cannot run, and only the reason tells them apart.
        if (announce) {
          console.error("background stopped:", why);
        }
        onBroke?.(why);
        watching?.(why);
        give?.(new Error(why));
        worker.terminate();
      };

      const opened = setTimeout(
        () => die("the background did not start in time"),
        startMs,
      );

      /** One frame in flight at a time. A background that has not answered is
       * not asked again, so a slow one drops frames rather than queueing them
       * up and falling further behind. */
      let waiting: ((painted: ImageBitmap | null) => void) | null = null;
      let slowSince = 0;
      /** A frame that never comes back is the case the slow-frame count cannot
       * see, because it only counts frames that answered. A background looping
       * inside its own paint would otherwise hold the roll on its last picture
       * for as long as the page is open, with a core pinned behind it. */
      let overdue: ReturnType<typeof setTimeout> | null = null;
      /** Frames are only asked for once the worker has said it is up. Both
       * callers resize and then post a frame on the next tick, well before a
       * cold worker has fetched its runtime and linked a shader, and a frame
       * posted then would arm the mid-frame watchdog against work that is
       * really the start. Whichever timer is shorter would decide, and it is
       * not the one named for starting. */
      let running = false;

      worker.addEventListener("message", (event: MessageEvent) => {
        const message = event.data;
        if (message.kind === "started") {
          clearTimeout(opened);
          running = true;
          settle?.(message);
          return;
        }
        if (message.kind === "painted") {
          if (overdue !== null) {
            clearTimeout(overdue);
            overdue = null;
          }
          const answer = waiting;
          waiting = null;
          // Only ever what the worker was asked to hand back.
          answer?.(
            message.painted instanceof ImageBitmap ? message.painted : null,
          );
          return;
        }
        if (message.kind === "broke") {
          waiting?.(null);
          waiting = null;
          die(message.why);
        }
      });
      worker.addEventListener("error", (event) => die(String(event.message)));
      worker.postMessage({ kind: "start", source });

      return {
        ready: started.then(
          () => {},
          () => {},
        ),

        resize(width, height, nextRatio) {
          ratio = nextRatio;
          view.width = width;
          view.height = height;
          overlay.width = Math.max(1, Math.round(width * ratio));
          overlay.height = Math.max(1, Math.round(height * ratio));
          if (!dead) {
            worker.postMessage({ kind: "resize", width, height, ratio });
          }
        },

        draw(frame: SkinFrame): Promise<void> {
          if (dead || !running || waiting !== null || view.width === 0) {
            return Promise.resolve();
          }
          let landed: () => void = () => {};
          const onLayer = new Promise<void>((done) => {
            landed = done;
          });
          const asked = performance.now();
          overdue = setTimeout(
            () => die("the background stopped answering mid-frame"),
            worstFrameMs * 3,
          );
          waiting = (picture) => {
            if (picture === null) {
              landed();
              return;
            }
            const took = performance.now() - asked;
            // One slow frame is a hiccup; a run of them is a background that
            // will never keep up, and it is holding the roll's frames open.
            slowSince = took > worstFrameMs ? slowSince + 1 : 0;
            if (slowSince >= 3) {
              picture.close();
              die("the background is too slow to draw");
              landed();
              return;
            }
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, overlay.width, overlay.height);
            ctx.drawImage(picture, 0, 0);
            picture.close();
            landed();
          };
          worker.postMessage({
            kind: "frame",
            frame: {
              elapsed: frame.elapsed,
              position: frame.position,
              step: frame.step,
              keyboardTop: frame.keyboardTop,
              notes: frame.travellers,
              strikes: frame.strikes,
              pressed: frame.pressed,
              chord: frame.chord,
              key: frame.key,
            },
          });
          return onLayer;
        },

        dispose() {
          clearTimeout(opened);
          if (overdue !== null) {
            clearTimeout(overdue);
          }
          dead = true;
          worker.postMessage({ kind: "stop" });
          // Asked to close itself first so a background gets its dispose, then
          // taken down regardless, because a stuck one will never answer.
          setTimeout(() => worker.terminate(), 200);
        },
      };
    },
  };
}
