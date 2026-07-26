/** Asteroids and what is left of them. Shared by the space backgrounds so a
 * rock looks the same wherever it turns up, and so an explosion is worth
 * watching rather than a puff of squares. */

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
 * own. */
const rockShades = ["#3a342d", "#2b2521", "#4a4239", "#211c18"] as const;

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
    drift: (Math.random() - 0.5) * 0.5,
    fall: 60 + Math.random() * 70,
    spin: (Math.random() - 0.5) * 1.4,
    angle: Math.random() * Math.PI * 2,
    radius,
    shape,
    craters,
  };
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
  body.addColorStop(0, "#3a342d");
  body.addColorStop(0.45, "#241f1a");
  body.addColorStop(1, "#141110");
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
    ctx.fillStyle = "#191512";
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
    ctx.fillStyle = "#221d19";
    ctx.fill();
  }

  // Barely there, so the rock reads as a dense body rather than an outline.
  ctx.save();
  traceRock(ctx, rock, 1);
  ctx.clip();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = "#4b443b";
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
          "#2b2521",
      });
    }
  }

  paint(ctx: CanvasRenderingContext2D): void {
    // The dust sits under everything, so the bright parts read against it.
    for (let index = this.dust.length - 1; index >= 0; index -= 1) {
      const puff = this.dust[index];
      if (puff === undefined) {
        continue;
      }
      puff.life -= 0.011;
      if (puff.life <= 0) {
        this.dust.splice(index, 1);
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
      cloud.addColorStop(0, "rgba(86,74,62,0.55)");
      cloud.addColorStop(1, "rgba(38,31,26,0)");
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
        this.flashes.splice(index, 1);
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
      if (chunk.life <= 0) {
        this.chunks.splice(index, 1);
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
