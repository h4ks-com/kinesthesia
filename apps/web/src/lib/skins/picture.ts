import { lookAhead } from "@/lib/render/piano-roll";
import { type Backdrop, plainBrightness } from "@/lib/skins/backdrop";
import type {
  BackdropSource,
  NoteDirection,
  SkinInstance,
  SkinSurface,
} from "@/lib/skins/types";

/** A picture behind the roll. Held still, or tiled and travelling with the
 * notes.
 *
 * Drawn on the overlay rather than the base: the base is where a shader takes a
 * WebGL context, and a canvas keeps the first kind it is given, so a picture
 * taking 2D there would poison it for the next background picked. */
export function pictureBackdrop(
  backdrop: Backdrop,
  /** The address the picture actually loads from. A `local:` source is resolved
   * to an object URL by the caller, which is the only place that can. */
  href: string,
  direction: NoteDirection,
  /** Told when the picture cannot be had, so nothing claims one is on screen. */
  onFailed?: () => void,
): BackdropSource {
  return {
    create({ overlay }: SkinSurface): SkinInstance | null {
      const ctx = overlay.getContext("2d");
      if (ctx === null) {
        return null;
      }

      const image = new Image();
      // A picture from another host is only drawable once it says it may be.
      if (!href.startsWith("blob:") && !href.startsWith("data:")) {
        image.crossOrigin = "anonymous";
      }
      let ready = false;
      const arrived = new Promise<void>((settle) => {
        image.addEventListener("load", () => {
          ready = true;
          settle();
        });
        // A dead address, or a host that will not say the picture may be used,
        // leaves the roll plain. Nothing is drawn either way; this says so, and
        // a render waiting on the picture stops waiting.
        image.addEventListener("error", () => {
          onFailed?.();
          settle();
        });
      });
      image.src = href;

      let view = { width: 0, height: 0 };
      let ratio = 1;

      return {
        ready: arrived,

        resize(width, height, nextRatio) {
          ratio = nextRatio;
          view = { width, height };
          overlay.width = Math.max(1, Math.round(width * ratio));
          overlay.height = Math.max(1, Math.round(height * ratio));
        },

        draw(frame) {
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
          ctx.clearRect(0, 0, view.width, view.height);
          if (!ready || image.naturalWidth === 0) {
            return;
          }
          ctx.filter =
            backdrop.brightness === plainBrightness
              ? "none"
              : `brightness(${backdrop.brightness}%)`;

          if (backdrop.scroll) {
            // Laid at the width of the roll and stacked downward, so it repeats
            // the way the notes arrive and never sideways.
            const tall =
              (image.naturalHeight / image.naturalWidth) * view.width;
            // Off the song rather than a clock of its own: a picture that keeps
            // moving under a stopped song reads as a broken one.
            const travelled =
              frame.position *
              (frame.keyboardTop / lookAhead) *
              (direction === "up" ? -1 : 1);
            const offset = ((travelled % tall) + tall) % tall;
            for (let y = offset - tall; y < view.height; y += tall) {
              ctx.drawImage(image, 0, y, view.width, tall);
            }
          } else {
            // One copy, covering the roll without being squashed.
            const scale = Math.max(
              view.width / image.naturalWidth,
              view.height / image.naturalHeight,
            );
            const width = image.naturalWidth * scale;
            const height = image.naturalHeight * scale;
            ctx.drawImage(
              image,
              (view.width - width) / 2,
              (view.height - height) / 2,
              width,
              height,
            );
          }
          ctx.filter = "none";
        },

        dispose() {
          // Cleared rather than emptied: an empty src is a request for the page
          // itself, which leaves a fetch in flight for a picture nobody wants.
          image.removeAttribute("src");
        },
      };
    },
  };
}
