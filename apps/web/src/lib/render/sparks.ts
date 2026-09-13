import type { NoteColor } from "@/lib/midi/palette";

/** What a burst stands for: a note landing on its own, the player striking a
 * key, or striking one the song was waiting for. */
export type SparkKind = "note" | "strike" | "bloom";

const bursts: Record<
  SparkKind,
  { count: number; speed: number; radius: number; white: number }
> = {
  note: { count: 14, speed: 1, radius: 1, white: 0.35 },
  strike: { count: 18, speed: 1.15, radius: 1.1, white: 0.55 },
  bloom: { count: 30, speed: 1.5, radius: 1.35, white: 0.85 },
};

/** A dense passage lights hundreds of new notes a frame, each a spark burst, so
 * without a ceiling the particle list runs to tens of thousands and the frame
 * is spent redrawing sparks no one can pick out. Capped, the swarm reads the
 * same and stops spawning once it is full. */
const maxParticles = 1100;

const gravity = 0.16;
const fade = 0.03;

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  radius: number;
  color: string;
};

/** The swarm thrown up from the keys. Owns nothing but its own particles: what
 * is worth sparking for is the roll's call, and it only says where and how big. */
export class SparkField {
  private readonly particles: Particle[] = [];

  get count(): number {
    return this.particles.length;
  }

  spawn(
    centerX: number,
    keyboardTop: number,
    color: NoteColor,
    kind: SparkKind,
  ): void {
    if (this.particles.length >= maxParticles) {
      return;
    }
    const burst = bursts[kind];
    const count = burst.count + Math.floor(Math.random() * 8);
    for (let index = 0; index < count; index += 1) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
      const speed = Math.random() * 4 * burst.speed + 1;
      this.particles.push({
        x: centerX + (Math.random() - 0.5) * 7,
        y: keyboardTop,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        radius: Math.random() * 2.2 * burst.radius + 0.7,
        color:
          Math.random() < burst.white
            ? "#ffffff"
            : Math.random() < 0.5
              ? color.core
              : color.glow,
      });
    }
  }

  /** Advances every particle and draws it, dropping the ones that have burnt
   * out. One pass, so the swarm costs the same whether it is drawn or not. */
  paint(ctx: CanvasRenderingContext2D): void {
    ctx.globalCompositeOperation = "lighter";
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      if (particle === undefined) {
        continue;
      }
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += gravity;
      particle.life -= fade;
      if (particle.life <= 0) {
        this.particles.splice(index, 1);
        continue;
      }
      ctx.globalAlpha = Math.max(0, particle.life);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(
        particle.x,
        particle.y,
        particle.radius * particle.life + 0.4,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}
