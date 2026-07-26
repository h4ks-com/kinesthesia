import type { SceneView } from "@/lib/skins/scene";

/** Anything a background throws into the air. What it looks like belongs to the
 * skin; being born, moving, ageing and being forgotten is the same everywhere. */
export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 1 when new, 0 when gone. */
  life: number;
  /** Life lost per second. */
  fade: number;
  size: number;
  /** Free for the skin: a hue, a phase, a sway. */
  seed: number;
};

export type Spark = Omit<Particle, "life"> & { life?: number };

/** A pool with a ceiling, so a long session cannot grow one. Dropping swaps the
 * last entry into the hole rather than shifting the tail, and the sweep is the
 * only walk: a busy frame costs the same as a quiet one. */
export class Particles {
  private readonly pool: Particle[] = [];
  private readonly ceiling: number;

  constructor(ceiling: number) {
    this.ceiling = ceiling;
  }

  get count(): number {
    return this.pool.length;
  }

  /** Ignored once the pool is full, so a held chord cannot outrun the ceiling. */
  add(spark: Spark): void {
    if (this.pool.length >= this.ceiling) {
      return;
    }
    this.pool.push({ ...spark, life: spark.life ?? 1 });
  }

  /** Ages every particle, forgets the spent and the departed, and hands the
   * survivors back to be drawn. Motion is the skin's, since that is the part
   * that makes an ember an ember and a bubble a bubble. */
  sweep(
    step: number,
    view: SceneView,
    move: (particle: Particle, step: number) => void,
    draw: (particle: Particle) => void,
  ): void {
    const edge = Math.max(view.width, view.height) * 0.25;
    for (let index = this.pool.length - 1; index >= 0; index -= 1) {
      const particle = this.pool[index];
      if (particle === undefined) {
        continue;
      }
      move(particle, step);
      particle.life -= particle.fade * step;
      if (
        particle.life <= 0 ||
        particle.y < -edge ||
        particle.y > view.height + edge ||
        particle.x < -edge ||
        particle.x > view.width + edge
      ) {
        const last = this.pool.pop();
        if (last !== undefined && index < this.pool.length) {
          this.pool[index] = last;
        }
        continue;
      }
      draw(particle);
    }
  }
}

/** Drift with nothing acting on it. The most common motion there is. */
export function drift(particle: Particle, step: number): void {
  particle.x += particle.vx * step;
  particle.y += particle.vy * step;
}

/** Drift with something pulling down and the air holding it back. */
export function falls(pull: number, hold: number) {
  return (particle: Particle, step: number): void => {
    particle.vy += pull * step;
    particle.vx *= 1 - hold * step;
    drift(particle, step);
  };
}
