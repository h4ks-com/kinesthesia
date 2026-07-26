import { createFullscreen, nebulaSource } from "@/lib/skins/fullscreen";
import {
  drawRock,
  makeRock,
  type Rock,
  Rubble,
  struckBy,
} from "@/lib/skins/rubble";
import type {
  Skin,
  SkinFrame,
  SkinInstance,
  SkinSurface,
} from "@/lib/skins/types";

/** Dimmer than the still field, because streaking stars are already carrying
 * the eye and the notes still have to win. */
const nebulaGain = 0.5;

/** Stars are held in a space with depth and projected, so they spread out of
 * the point being travelled toward and streak more the nearer they come. A
 * column of falling lines reads as rain; this reads as motion. */
const starCount = 200;
/** How fast depth is eaten. The whole field crosses in a few seconds. */
const approach = 0.55;
const nearest = 0.06;

/** Real starlight is not white. A few warm and blue ones stop the field looking
 * like static. */
const starColours = [
  "#ffffff",
  "#dce8ff",
  "#bcd4ff",
  "#ffe9c8",
  "#ffd3a8",
] as const;

const maxRocks = 9;
/** Roughly one rock every few seconds, so they are an event rather than a field
 * to fly through. */
const rockChance = 0.02;

type Star = {
  /** Direction from the vanishing point, before depth is applied. */
  x: number;
  y: number;
  z: number;
  color: string;
  twinkle: number;
};

function createCruise({ base, overlay }: SkinSurface): SkinInstance | null {
  const gl = base.getContext("webgl2", {
    alpha: false,
    antialias: false,
    powerPreference: "low-power",
  });
  if (gl === null) {
    return null;
  }
  const gas = createFullscreen(gl, nebulaSource(0.06));
  if (gas === null) {
    return null;
  }
  const ctx = overlay.getContext("2d");

  const stars: Star[] = [];
  const rocks: Rock[] = [];
  const rubble = new Rubble();
  let width = 0;
  let height = 0;
  let ratio = 1;
  let last = 0;

  function placeStar(star: Star, fresh: boolean): void {
    star.x = (Math.random() - 0.5) * 2.4;
    star.y = (Math.random() - 0.5) * 2.4;
    star.z = fresh ? Math.random() : 1;
    star.color =
      starColours[Math.floor(Math.random() * starColours.length)] ?? "#ffffff";
    star.twinkle = Math.random() * Math.PI * 2;
  }

  function seedStars(): void {
    stars.length = 0;
    for (let count = 0; count < starCount; count += 1) {
      const star: Star = { x: 0, y: 0, z: 1, color: "#ffffff", twinkle: 0 };
      placeStar(star, true);
      stars.push(star);
    }
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
      if (stars.length === 0) {
        seedStars();
      }
    },

    draw(frame: SkinFrame) {
      gas.draw([base.width, base.height], frame.elapsed, nebulaGain);
      if (ctx === null) {
        return;
      }
      // Measured rather than assumed, so the travel reads the same whatever
      // rate the frames arrive at.
      const step = last === 0 ? 1 / 60 : Math.min(0.05, frame.elapsed - last);
      last = frame.elapsed;

      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // Travelling toward the top of the roll, so the field spreads out of a
      // point above it and pours down past the keys.
      const awayX = width / 2;
      const awayY = -height * 0.25;
      const reach = Math.max(width, height);

      for (const star of stars) {
        const was = star.z;
        star.z -= approach * step;
        if (star.z <= nearest) {
          placeStar(star, false);
          continue;
        }
        const near = star.x / star.z;
        const nearY = star.y / star.z;
        const x = awayX + near * reach * 0.5;
        const y = awayY + nearY * reach * 0.5;
        if (y > frame.keyboardTop + 40 || x < -60 || x > width + 60) {
          continue;
        }
        const wasX = awayX + (star.x / was) * reach * 0.5;
        const wasY = awayY + (star.y / was) * reach * 0.5;
        const closeness = 1 - star.z;
        const shine =
          (0.25 + closeness * 0.75) *
          (0.75 + 0.25 * Math.sin(frame.elapsed * 3 + star.twinkle));

        ctx.globalAlpha = Math.min(1, shine);
        ctx.strokeStyle = star.color;
        ctx.lineWidth = 0.5 + closeness * 2.1;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(wasX, wasY);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.lineCap = "butt";

      if (Math.random() < rockChance && rocks.length < maxRocks) {
        rocks.push(
          makeRock(Math.random() * width, -40, 13 + Math.random() * 17),
        );
      }

      for (let index = rocks.length - 1; index >= 0; index -= 1) {
        const rock = rocks[index];
        if (rock === undefined) {
          continue;
        }
        rock.y += rock.fall * step;
        rock.x += rock.drift;
        rock.angle += rock.spin * step;
        if (rock.y - rock.radius > frame.keyboardTop) {
          rocks.splice(index, 1);
          continue;
        }
        const struck = struckBy(rock, frame.travellers);
        if (struck !== null) {
          rubble.burst(rock.x, rock.y, rock.radius, struck.color);
          rocks.splice(index, 1);
          continue;
        }
        drawRock(ctx, rock);
      }

      rubble.paint(ctx, width, height);
    },

    dispose() {
      gas.dispose();
    },
  };
}

export const cruise: Skin = {
  id: "cruise",
  name: "Cruising",
  blurb:
    "The keys fly through space. Stars streak past, and the rocks your notes reach break apart.",
  directions: ["up"],
  create: createCruise,
};
