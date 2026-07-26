import { createFullscreen, nebulaSource } from "@/lib/skins/fullscreen";
import type {
  Skin,
  SkinFrame,
  SkinInstance,
  SkinSurface,
  Traveller,
} from "@/lib/skins/types";

/** Dimmer than the still field, because streaking stars are already carrying
 * the eye and the notes still have to win. */
const nebulaGain = 0.5;

/** Layers of stars at different speeds, which is what reads as distance. The
 * near ones streak, the far ones barely move. */
const starLayers = [
  { count: 90, speed: 34, length: 0.5, size: 0.7, glow: 0.35 },
  { count: 55, speed: 96, length: 1.6, size: 1.0, glow: 0.6 },
  { count: 26, speed: 210, length: 4.2, size: 1.5, glow: 0.95 },
] as const;

const maxRocks = 9;
const maxShards = 300;
/** Roughly one rock every few seconds, so they are an event rather than a field
 * to fly through. */
const rockChance = 0.02;
/** A rock breaking up on its own, which happens far more rarely than one being
 * hit, so a struck one still reads as the player's doing. */
const spontaneous = 0.0016;

type Star = { x: number; y: number; layer: number };

type Rock = {
  x: number;
  y: number;
  drift: number;
  fall: number;
  spin: number;
  angle: number;
  radius: number;
};

type Shard = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
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
  const shards: Shard[] = [];
  let width = 0;
  let height = 0;
  let ratio = 1;
  let last = 0;

  function seedStars(): void {
    stars.length = 0;
    starLayers.forEach((layer, index) => {
      for (let count = 0; count < layer.count; count += 1) {
        stars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          layer: index,
        });
      }
    });
  }

  function shatter(x: number, y: number, color: string): void {
    for (let index = 0; index < 16 && shards.length < maxShards; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.7 + Math.random() * 2.6;
      shards.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        color: Math.random() < 0.5 ? color : "#cbbba6",
      });
    }
  }

  function reached(
    rock: Rock,
    travellers: readonly Traveller[],
  ): Traveller | undefined {
    return travellers.find(
      (traveller) =>
        Math.abs(traveller.x - rock.x) < rock.radius + traveller.radius &&
        Math.abs(traveller.y - rock.y) < rock.radius + traveller.radius,
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
      seedStars();
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

      for (const star of stars) {
        const layer = starLayers[star.layer] ?? starLayers[0];
        star.y += layer.speed * step;
        if (star.y > frame.keyboardTop) {
          star.y = -4;
          star.x = Math.random() * width;
        }
        const streak = layer.speed * step * layer.length;
        ctx.globalAlpha = layer.glow;
        ctx.strokeStyle = "#dbe6ff";
        ctx.lineWidth = layer.size;
        ctx.beginPath();
        ctx.moveTo(star.x, star.y - streak);
        ctx.lineTo(star.x, star.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      if (Math.random() < rockChance && rocks.length < maxRocks) {
        rocks.push({
          x: Math.random() * width,
          y: -40,
          drift: (Math.random() - 0.5) * 0.5,
          fall: 60 + Math.random() * 70,
          spin: (Math.random() - 0.5) * 1.4,
          angle: Math.random() * Math.PI * 2,
          radius: 12 + Math.random() * 16,
        });
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
        const struck = reached(rock, frame.travellers);
        if (struck !== undefined) {
          shatter(rock.x, rock.y, struck.color);
          rocks.splice(index, 1);
          continue;
        }
        if (Math.random() < spontaneous) {
          shatter(rock.x, rock.y, "#e8a33c");
          rocks.splice(index, 1);
          continue;
        }
        ctx.save();
        ctx.translate(rock.x, rock.y);
        ctx.rotate(rock.angle);
        ctx.beginPath();
        for (let point = 0; point < 7; point += 1) {
          const around = (point / 7) * Math.PI * 2;
          const reach = rock.radius * (0.72 + ((point * 37) % 11) / 34);
          ctx.lineTo(Math.cos(around) * reach, Math.sin(around) * reach);
        }
        ctx.closePath();
        ctx.fillStyle = "#241f1b";
        ctx.fill();
        ctx.strokeStyle = "#544a3f";
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.restore();
      }

      for (let index = shards.length - 1; index >= 0; index -= 1) {
        const shard = shards[index];
        if (shard === undefined) {
          continue;
        }
        shard.x += shard.vx;
        shard.y += shard.vy;
        shard.vy += 0.05;
        shard.life -= 0.018;
        if (shard.life <= 0) {
          shards.splice(index, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, shard.life) * 0.9;
        ctx.fillStyle = shard.color;
        ctx.fillRect(shard.x, shard.y, 2.4, 2.4);
      }
      ctx.globalAlpha = 1;
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
    "The keys fly through space. Stars streak past, and the rocks you reach break up.",
  directions: ["up"],
  create: createCruise,
};
