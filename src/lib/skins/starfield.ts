import { createFullscreen, nebulaSource } from "@/lib/skins/fullscreen";
import type {
  Skin,
  SkinFrame,
  SkinInstance,
  SkinSurface,
} from "@/lib/skins/types";

/** Kept well under the roll's own brightness, so a note always reads against
 * it. The skin sits behind the notes, and this keeps it behind them in tone. */
const nebulaGain = 0.66;

type Rock = {
  x: number;
  y: number;
  drift: number;
  fall: number;
  spin: number;
  angle: number;
  radius: number;
  hit: number;
};

type Shard = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
};

const maxRocks = 14;
const maxShards = 260;

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
  const shards: Shard[] = [];
  let width = 0;
  let height = 0;
  let ratio = 1;

  function spawnRock(): void {
    if (rocks.length >= maxRocks || width === 0) {
      return;
    }
    rocks.push({
      x: Math.random() * width,
      y: -30 - Math.random() * 90,
      drift: (Math.random() - 0.5) * 0.4,
      fall: 0.9 + Math.random() * 1.1,
      spin: (Math.random() - 0.5) * 0.02,
      angle: Math.random() * Math.PI * 2,
      radius: 11 + Math.random() * 17,
      hit: 0,
    });
  }

  function burst(rock: Rock, color: string): void {
    for (let index = 0; index < 14 && shards.length < maxShards; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.6 + Math.random() * 2.4;
      shards.push({
        x: rock.x,
        y: rock.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.4,
        life: 1,
        color: Math.random() < 0.45 ? color : "#c9b9a4",
      });
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
        rock.y += rock.fall;
        rock.x += rock.drift;
        rock.angle += rock.spin;
        if (rock.hit > 0) {
          rock.hit -= 0.08;
        }
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
          burst(rock, struck.color);
          rocks.splice(index, 1);
          continue;
        }
        rocksCtx.save();
        rocksCtx.translate(rock.x, rock.y);
        rocksCtx.rotate(rock.angle);
        rocksCtx.beginPath();
        for (let point = 0; point < 7; point += 1) {
          const around = (point / 7) * Math.PI * 2;
          const reach = rock.radius * (0.72 + ((point * 37) % 11) / 34);
          rocksCtx.lineTo(Math.cos(around) * reach, Math.sin(around) * reach);
        }
        rocksCtx.closePath();
        rocksCtx.fillStyle = "#241f1b";
        rocksCtx.fill();
        rocksCtx.strokeStyle = rock.hit > 0 ? "#8d7f6b" : "#4a4038";
        rocksCtx.lineWidth = 1.4;
        rocksCtx.stroke();
        rocksCtx.restore();
      }

      for (let index = shards.length - 1; index >= 0; index -= 1) {
        const shard = shards[index];
        if (shard === undefined) {
          continue;
        }
        shard.x += shard.vx;
        shard.y += shard.vy;
        shard.vy += 0.04;
        shard.life -= 0.02;
        if (shard.life <= 0) {
          shards.splice(index, 1);
          continue;
        }
        rocksCtx.globalAlpha = Math.max(0, shard.life) * 0.85;
        rocksCtx.fillStyle = shard.color;
        rocksCtx.fillRect(shard.x, shard.y, 2.2, 2.2);
      }
      rocksCtx.globalAlpha = 1;
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
