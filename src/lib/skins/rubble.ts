/** Asteroids and what is left of them. Shared by the space backgrounds so a
 * rock looks the same wherever it turns up, and so an explosion is worth
 * watching rather than a puff of squares. */

import type { SkinFrame, Traveller } from "@/lib/skins/types";

export type Rock = {
  x: number;
  y: number;
  drift: number;
  fall: number;
  spin: number;
  angle: number;
  radius: number;
  /** The silhouette, as a reach per corner. Cut once so a rock keeps its own
   * shape while it tumbles rather than boiling. */
  readonly shape: readonly number[];
  readonly craters: readonly { x: number; y: number; r: number }[];
};

type Chunk = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  angle: number;
  size: number;
  life: number;
  fade: number;
  color: string;
};

type Flash = {
  x: number;
  y: number;
  life: number;
  reach: number;
  color: string;
};

type Dust = {
  x: number;
  y: number;
  life: number;
  reach: number;
};

/** Pieces are chips off the rock, so they carry its colours and none of their
 * own. Stone, not soil: a warm rock reads as dirt against a cold sky. */
const rockShades = ["#3d4045", "#2b2d31", "#4d5157", "#212326"] as const;

const corners = 11;
const maxChunks = 320;
const maxFlashes = 12;
const maxDust = 90;

export function makeRock(x: number, y: number, radius: number): Rock {
  const shape: number[] = [];
  for (let corner = 0; corner < corners; corner += 1) {
    shape.push(0.62 + Math.random() * 0.45);
  }
  const craters: { x: number; y: number; r: number }[] = [];
  for (let count = 0; count < 3; count += 1) {
    const around = Math.random() * Math.PI * 2;
    const out = Math.random() * radius * 0.45;
    craters.push({
      x: Math.cos(around) * out,
      y: Math.sin(around) * out,
      r: radius * (0.11 + Math.random() * 0.16),
    });
  }
  return {
    x,
    y,
    drift: (Math.random() - 0.5) * 30,
    fall: 60 + Math.random() * 70,
    spin: (Math.random() - 0.5) * 1.4,
    angle: Math.random() * Math.PI * 2,
    radius,
    shape,
    craters,
  };
}

/** A rock still above the view is not in play: breaking it there spends the
 * whole burst where nobody sees it, and a busy roll reaches that high. */
export function struckBy(
  rock: Rock,
  travellers: readonly Traveller[],
): Traveller | null {
  if (rock.y + rock.radius < 0) {
    return null;
  }
  return (
    travellers.find(
      (traveller) =>
        Math.abs(traveller.x - rock.x) < rock.radius + traveller.radius &&
        Math.abs(traveller.y - rock.y) < rock.radius + traveller.radius,
    ) ?? null
  );
}

function traceRock(
  ctx: CanvasRenderingContext2D,
  rock: Rock,
  scale: number,
): void {
  ctx.beginPath();
  rock.shape.forEach((reach, corner) => {
    const around = (corner / rock.shape.length) * Math.PI * 2;
    const out = rock.radius * reach * scale;
    ctx.lineTo(Math.cos(around) * out, Math.sin(around) * out);
  });
  ctx.closePath();
}

/** Lit from the upper left, so a rock reads as a solid rather than a hole. */
export function drawRock(ctx: CanvasRenderingContext2D, rock: Rock): void {
  ctx.save();
  ctx.translate(rock.x, rock.y);
  ctx.rotate(rock.angle);

  const body = ctx.createLinearGradient(
    -rock.radius,
    -rock.radius,
    rock.radius,
    rock.radius,
  );
  body.addColorStop(0, "#43474d");
  body.addColorStop(0.45, "#292b30");
  body.addColorStop(1, "#131417");
  traceRock(ctx, rock, 1);
  ctx.fillStyle = body;
  ctx.fill();

  for (const crater of rock.craters) {
    ctx.beginPath();
    ctx.ellipse(
      crater.x,
      crater.y,
      crater.r,
      crater.r * 0.78,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = "#1b1d21";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(
      crater.x - crater.r * 0.2,
      crater.y - crater.r * 0.2,
      crater.r * 0.7,
      crater.r * 0.55,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = "#26292e";
    ctx.fill();
  }

  // Barely there, so the rock reads as a dense body rather than an outline.
  ctx.save();
  traceRock(ctx, rock, 1);
  ctx.clip();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = "#565b62";
  ctx.lineWidth = 1.6;
  traceRock(ctx, rock, 0.985);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();

  ctx.restore();
}

/** What a broken rock leaves: dust and pieces of the rock itself, thrown out
 * and then gone. Nothing here glows, so a break never outshines the notes. */
export class Rubble {
  private readonly chunks: Chunk[] = [];
  private readonly flashes: Flash[] = [];
  private readonly dust: Dust[] = [];

  burst(x: number, y: number, radius: number, color: string): void {
    if (this.flashes.length < maxFlashes) {
      this.flashes.push({ x, y, life: 1, reach: radius * 1.6, color });
    }
    for (let puff = 0; puff < 4 && this.dust.length < maxDust; puff += 1) {
      const around = Math.random() * Math.PI * 2;
      const out = Math.random() * radius * 0.7;
      this.dust.push({
        x: x + Math.cos(around) * out,
        y: y + Math.sin(around) * out,
        life: 1,
        reach: radius * (1.1 + Math.random()),
      });
    }
    const pieces = 16 + Math.floor(Math.random() * 10);
    for (let index = 0; index < pieces; index += 1) {
      if (this.chunks.length >= maxChunks) {
        break;
      }
      const around = Math.random() * Math.PI * 2;
      const speed = 0.8 + Math.random() * 3.4;
      this.chunks.push({
        x,
        y,
        vx: Math.cos(around) * speed,
        vy: Math.sin(around) * speed,
        spin: (Math.random() - 0.5) * 0.3,
        angle: Math.random() * Math.PI * 2,
        size: radius * (0.08 + Math.random() * 0.24),
        life: 1,
        fade: 0.014 + Math.random() * 0.016,
        color:
          rockShades[Math.floor(Math.random() * rockShades.length)] ??
          "#2b2d31",
      });
    }
  }

  /** Swap the last entry into the hole rather than shifting everything after
   * it, so a busy frame costs the same as a quiet one. */
  private static drop<T>(pool: T[], index: number): void {
    const last = pool.pop();
    if (last !== undefined && index < pool.length) {
      pool[index] = last;
    }
  }

  paint(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    // The dust sits under everything, so the bright parts read against it.
    for (let index = this.dust.length - 1; index >= 0; index -= 1) {
      const puff = this.dust[index];
      if (puff === undefined) {
        continue;
      }
      puff.life -= 0.011;
      if (puff.life <= 0) {
        Rubble.drop(this.dust, index);
        continue;
      }
      const spread = puff.reach * (1.6 - puff.life);
      const cloud = ctx.createRadialGradient(
        puff.x,
        puff.y,
        0,
        puff.x,
        puff.y,
        Math.max(1, spread),
      );
      cloud.addColorStop(0, "rgba(120,126,134,0.5)");
      cloud.addColorStop(1, "rgba(38,40,44,0)");
      ctx.globalAlpha = puff.life * 0.7;
      ctx.fillStyle = cloud;
      ctx.beginPath();
      ctx.arc(puff.x, puff.y, Math.max(1, spread), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let index = this.flashes.length - 1; index >= 0; index -= 1) {
      const flash = this.flashes[index];
      if (flash === undefined) {
        continue;
      }
      flash.life -= 0.055;
      if (flash.life <= 0) {
        Rubble.drop(this.flashes, index);
        continue;
      }
      // A short dull bloom in the note's colour, gone almost at once, so the
      // hit is felt without a flash competing with the roll.
      const grown = flash.reach * (1 - flash.life);
      const halo = ctx.createRadialGradient(
        flash.x,
        flash.y,
        0,
        flash.x,
        flash.y,
        Math.max(1, grown),
      );
      halo.addColorStop(0, flash.color);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = flash.life * flash.life * 0.22;
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(flash.x, flash.y, Math.max(1, grown), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    for (let index = this.chunks.length - 1; index >= 0; index -= 1) {
      const chunk = this.chunks[index];
      if (chunk === undefined) {
        continue;
      }
      chunk.x += chunk.vx;
      chunk.y += chunk.vy;
      chunk.vy += 0.05;
      chunk.vx *= 0.995;
      chunk.angle += chunk.spin;
      chunk.life -= chunk.fade;
      if (
        chunk.life <= 0 ||
        chunk.y - chunk.size > height ||
        chunk.x + chunk.size < 0 ||
        chunk.x - chunk.size > width
      ) {
        Rubble.drop(this.chunks, index);
        continue;
      }
      ctx.save();
      ctx.translate(chunk.x, chunk.y);
      ctx.rotate(chunk.angle);
      ctx.globalAlpha = Math.min(1, chunk.life * 1.2);
      ctx.fillStyle = chunk.color;
      ctx.beginPath();
      ctx.moveTo(-chunk.size, chunk.size * 0.6);
      ctx.lineTo(0, -chunk.size);
      ctx.lineTo(chunk.size, chunk.size * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}

/** Big enough that breaking it should leave something behind. Anything smaller
 * is spent in one hit. */
const splitAbove = 16;
const smallestPiece = 6;
/** Headroom over the spawn cap, so pieces have somewhere to go without letting
 * a long session fill the sky. */
const pieceRoom = 8;

export type RockFieldOptions = {
  readonly max: number;
  /** Rocks entering per second. */
  readonly rate: number;
  readonly smallest: number;
  readonly largest: number;
};

/** A drifting field of rocks that the notes break. Everything here is per
 * second and stepped by a measured delta, so a 120 Hz screen sees the same
 * scene as a 60 Hz one rather than twice the rocks at half the speed. */
export class RockField {
  private readonly rocks: Rock[] = [];
  private readonly rubble = new Rubble();
  private readonly options: RockFieldOptions;

  constructor(options: RockFieldOptions) {
    this.options = options;
  }

  paint(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    step: number,
    frame: SkinFrame,
  ): void {
    const { max, rate, smallest, largest } = this.options;
    if (this.rocks.length < max && Math.random() < rate * step) {
      this.rocks.push(
        makeRock(
          Math.random() * width,
          -40,
          smallest + Math.random() * (largest - smallest),
        ),
      );
    }

    for (let index = this.rocks.length - 1; index >= 0; index -= 1) {
      const rock = this.rocks[index];
      if (rock === undefined) {
        continue;
      }
      rock.y += rock.fall * step;
      rock.x += rock.drift * step;
      rock.angle += rock.spin * step;
      // Pieces are thrown in every direction, so leaving by any edge counts.
      if (
        rock.y - rock.radius > frame.keyboardTop ||
        rock.y + rock.radius < -400 ||
        rock.x + rock.radius < -200 ||
        rock.x - rock.radius > width + 200
      ) {
        this.rocks.splice(index, 1);
        continue;
      }
      const struck = struckBy(rock, frame.travellers);
      if (struck !== null) {
        this.rubble.burst(rock.x, rock.y, rock.radius, struck.color);
        this.rocks.splice(index, 1);
        this.split(rock);
        continue;
      }
      drawRock(ctx, rock);
    }

    this.rubble.paint(ctx, width, height);
  }

  /** What a broken rock leaves behind: two or three smaller ones thrown apart,
   * each still solid enough to be hit again. A small one leaves nothing. */
  private split(rock: Rock): void {
    if (rock.radius < splitAbove) {
      return;
    }
    const pieces = 2 + Math.floor(Math.random() * 2);
    for (let index = 0; index < pieces; index += 1) {
      if (this.rocks.length >= this.options.max + pieceRoom) {
        return;
      }
      const around = (index / pieces) * Math.PI * 2 + Math.random();
      const piece = makeRock(
        rock.x,
        rock.y,
        Math.max(smallestPiece, rock.radius / (pieces * 0.7)),
      );
      piece.drift = rock.drift + Math.cos(around) * 110;
      // Kept falling, so a piece thrown upward still comes back down the roll
      // rather than hanging above it.
      piece.fall = Math.max(25, rock.fall * 0.75 + Math.sin(around) * 80);
      piece.spin = (Math.random() - 0.5) * 3.4;
      this.rocks.push(piece);
    }
  }
}
