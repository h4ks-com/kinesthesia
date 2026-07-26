import { createFullscreen, nebulaSource } from "@/lib/skins/fullscreen";
import { drawRock, makeRock, type Rock, Rubble } from "@/lib/skins/rubble";
import type {
  Skin,
  SkinFrame,
  SkinInstance,
  SkinSurface,
} from "@/lib/skins/types";

/** Kept well under the roll's own brightness, so a note always reads against
 * it. The skin sits behind the notes, and this keeps it behind them in tone. */
const nebulaGain = 0.66;

const maxRocks = 14;

/** The gas and stars are a shader on one quad; the rocks are drawn over it on a
 * 2D layer, because they are a handful of shapes that have to answer to where
 * the notes are and that is not worth a second pipeline. */
function createStarfield({ base, overlay }: SkinSurface): SkinInstance | null {
  const gl = base.getContext("webgl2", {
    alpha: false,
    antialias: false,
    powerPreference: "low-power",
  });
  if (gl === null) {
    return null;
  }
  const gas = createFullscreen(gl, nebulaSource(0.015));
  if (gas === null) {
    return null;
  }
  const rocksCtx = overlay.getContext("2d");

  const rocks: Rock[] = [];
  const rubble = new Rubble();
  let width = 0;
  let height = 0;
  let ratio = 1;

  function spawnRock(): void {
    if (rocks.length >= maxRocks || width === 0) {
      return;
    }
    rocks.push(
      makeRock(
        Math.random() * width,
        -30 - Math.random() * 90,
        11 + Math.random() * 17,
      ),
    );
  }

  return {
    resize(nextWidth, nextHeight, nextRatio) {
      width = nextWidth;
      height = nextHeight;
      ratio = nextRatio;
      base.width = Math.round(nextWidth * nextRatio);
      base.height = Math.round(nextHeight * nextRatio);
      overlay.width = base.width;
      overlay.height = base.height;
      gl.viewport(0, 0, base.width, base.height);
    },

    draw(frame: SkinFrame) {
      gas.draw([base.width, base.height], frame.elapsed, nebulaGain);

      if (rocksCtx === null) {
        return;
      }
      rocksCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
      rocksCtx.clearRect(0, 0, width, height);

      if (Math.random() < 0.045) {
        spawnRock();
      }

      // A note head reaching a rock breaks it. The notes are never touched:
      // the rock is what gives way.
      for (let index = rocks.length - 1; index >= 0; index -= 1) {
        const rock = rocks[index];
        if (rock === undefined) {
          continue;
        }
        rock.y += rock.fall * 0.016;
        rock.x += rock.drift;
        rock.angle += rock.spin;
        if (rock.y - rock.radius > frame.keyboardTop) {
          rocks.splice(index, 1);
          continue;
        }
        const struck = frame.travellers.find(
          (traveller) =>
            Math.abs(traveller.x - rock.x) < rock.radius + traveller.radius &&
            Math.abs(traveller.y - rock.y) < rock.radius + traveller.radius,
        );
        if (struck !== undefined) {
          rubble.burst(rock.x, rock.y, rock.radius, struck.color);
          rocks.splice(index, 1);
          continue;
        }
        drawRock(rocksCtx, rock);
      }

      rubble.paint(rocksCtx);
    },

    dispose() {
      gas.dispose();
    },
  };
}

export const starfield: Skin = {
  id: "starfield",
  name: "Deep space",
  blurb:
    "Drifting gas and stars. In free roam the notes you play break the asteroids they reach.",
  // The rocks are flown into, so they only read while notes leave the keys.
  directions: ["up"],
  create: createStarfield,
};
