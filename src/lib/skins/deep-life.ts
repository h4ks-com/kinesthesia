import { type Particle, Particles } from "@/lib/skins/particles";
import type { SceneView } from "@/lib/skins/scene";

/** What swims past in the deep, kept apart from the water itself so the skin
 * stays about the water and this stays about the things in it. */

/** Schools a second, and lone subs a second. Both rare enough to be a thing you
 * notice rather than scenery. */
const schoolRate = 0.14;
const subRate = 0.02;
const maxFish = 70;
/** How far behind the leader the back of a school may start. The pool forgets
 * anything further out than a quarter of the view, and the narrowest phone is
 * around 320px across. */
const maxTrail = 70;

/** Nothing down here is lit, so a fish is a shape the shafts catch rather than a
 * silhouette, which would be invisible against water this dark. */
const fishBody = "rgba(126,176,196,0.15)";
const fishEdge = "rgba(150,205,225,0.22)";
const fishEye = "rgba(140,240,255,0.5)";

type Submarine = {
  x: number;
  y: number;
  /** Pixels a second, signed: which way it is pointing. */
  speed: number;
  size: number;
};

function drawFish(
  ctx: CanvasRenderingContext2D,
  fish: Particle,
  elapsed: number,
): void {
  const size = fish.size;
  const wag = Math.sin(elapsed * 5.5 + fish.seed) * size * 0.3;
  ctx.save();
  ctx.translate(fish.x, fish.y);
  ctx.scale(fish.vx < 0 ? -1 : 1, 1);
  // A slow roll as it swims, so a school does not read as cut-outs sliding.
  ctx.rotate(Math.sin(elapsed * 1.6 + fish.seed) * 0.12);

  ctx.fillStyle = fishBody;
  ctx.strokeStyle = fishEdge;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(0, 0, size, size * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-size * 0.8, 0);
  ctx.lineTo(-size * 1.7, -size * 0.45 + wag);
  ctx.lineTo(-size * 1.7, size * 0.45 + wag);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, -size * 0.34);
  ctx.lineTo(size * 0.1, -size * 0.85);
  ctx.lineTo(size * 0.5, -size * 0.22);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = fishEye;
  ctx.beginPath();
  ctx.arc(size * 0.55, -size * 0.1, Math.max(0.6, size * 0.09), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSubmarine(
  ctx: CanvasRenderingContext2D,
  sub: Submarine,
  elapsed: number,
): void {
  const size = sub.size;
  const facing = sub.speed < 0 ? -1 : 1;
  ctx.save();
  ctx.translate(sub.x, sub.y + Math.sin(elapsed * 0.5) * size * 0.05);
  ctx.scale(facing, 1);

  // The lamp reaches ahead of it, which is the only real light down here.
  const reach = size * 4.5;
  const lamp = ctx.createLinearGradient(size, 0, size + reach, 0);
  lamp.addColorStop(0, "rgba(190,230,255,0.16)");
  lamp.addColorStop(1, "rgba(120,190,230,0)");
  ctx.fillStyle = lamp;
  ctx.beginPath();
  ctx.moveTo(size * 0.95, -size * 0.1);
  ctx.lineTo(size + reach, -size * 0.85);
  ctx.lineTo(size + reach, size * 0.85);
  ctx.lineTo(size * 0.95, size * 0.1);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(28,44,55,0.85)";
  ctx.strokeStyle = "rgba(140,190,215,0.28)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, 0, size, size * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-size * 0.3, -size * 0.3);
  ctx.lineTo(-size * 0.16, -size * 0.72);
  ctx.lineTo(size * 0.16, -size * 0.72);
  ctx.lineTo(size * 0.3, -size * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-size * 0.92, -size * 0.12);
  ctx.lineTo(-size * 1.35, -size * 0.5);
  ctx.lineTo(-size * 1.35, size * 0.5);
  ctx.lineTo(-size * 0.92, size * 0.12);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(255,214,140,0.55)";
  for (const along of [-0.42, -0.1, 0.22, 0.52]) {
    ctx.beginPath();
    ctx.arc(size * along, 0, Math.max(0.8, size * 0.06), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Fish that cross in schools, and now and then a submarine. Everything here
 * enters off one edge and is forgotten at the other. */
export class DeepLife {
  private readonly fish = new Particles(maxFish);
  private sub: Submarine | null = null;

  private school(view: SceneView): void {
    const toRight = Math.random() < 0.5;
    const size = 4 + Math.random() * 7;
    const speed = (14 + Math.random() * 26) * (toRight ? 1 : -1);
    const facing = toRight ? 1 : -1;
    const from = toRight ? -24 : view.width + 24;
    const depth = view.keyboardTop * (0.12 + Math.random() * 0.72);
    const count = 3 + Math.floor(Math.random() * 7);
    // The whole string has to start inside the margin the pool culls at, or the
    // back of a long school is forgotten on the frame it is made.
    const trail = Math.min(maxTrail, count * (size * 3.4 + 16));
    for (let index = 0; index < count; index += 1) {
      this.fish.add({
        // Strung out behind the leader rather than stacked, so it reads as a
        // school and not as a row.
        x: from - facing * (index / count) * trail,
        y: depth + (Math.random() - 0.5) * size * 9,
        vx: speed * (0.85 + Math.random() * 0.3),
        vy: (Math.random() - 0.5) * 5,
        fade: 0,
        size: size * (0.75 + Math.random() * 0.5),
        seed: Math.random() * Math.PI * 2,
      });
    }
  }

  paint(
    ctx: CanvasRenderingContext2D,
    view: SceneView,
    elapsed: number,
    step: number,
  ): void {
    if (Math.random() < schoolRate * step) {
      this.school(view);
    }
    if (this.sub === null && Math.random() < subRate * step) {
      const toRight = Math.random() < 0.5;
      const size = 26 + Math.random() * 22;
      this.sub = {
        x: toRight ? -size * 3 : view.width + size * 3,
        y: view.keyboardTop * (0.2 + Math.random() * 0.5),
        speed: (26 + Math.random() * 18) * (toRight ? 1 : -1),
        size,
      };
    }

    const sub = this.sub;
    if (sub !== null) {
      sub.x += sub.speed * step;
      const gone = sub.size * 4;
      if (sub.x < -gone || sub.x > view.width + gone) {
        this.sub = null;
      } else {
        drawSubmarine(ctx, sub, elapsed);
      }
    }

    this.fish.sweep(
      step,
      view,
      (fish, delta) => {
        fish.x += fish.vx * delta;
        fish.y += (fish.vy + Math.sin(elapsed * 0.8 + fish.seed) * 6) * delta;
      },
      (fish) => drawFish(ctx, fish, elapsed),
    );
  }
}
