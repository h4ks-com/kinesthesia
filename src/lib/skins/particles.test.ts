import { describe, expect, it } from "vitest";
import { drift, falls, Particles } from "@/lib/skins/particles";
import type { SceneView } from "@/lib/skins/scene";

const view: SceneView = { width: 200, height: 100, keyboardTop: 80 };

function spark(over: Partial<Parameters<Particles["add"]>[0]> = {}) {
  return {
    x: 100,
    y: 50,
    vx: 0,
    vy: 0,
    fade: 0,
    size: 1,
    seed: 0,
    ...over,
  };
}

function drawn(pool: Particles, step = 1 / 60): number {
  let count = 0;
  pool.sweep(step, view, drift, () => {
    count += 1;
  });
  return count;
}

describe("a particle pool", () => {
  it("refuses more than its ceiling, so a held chord cannot grow it", () => {
    const pool = new Particles(3);
    for (let count = 0; count < 50; count += 1) {
      pool.add(spark());
    }
    expect(pool.count).toBe(3);
  });

  it("keeps the living and forgets the spent", () => {
    const pool = new Particles(10);
    pool.add(spark({ fade: 10 }));
    pool.add(spark({ fade: 0 }));
    expect(drawn(pool, 0.5)).toBe(1);
    expect(pool.count).toBe(1);
  });

  it("forgets what has left the view rather than tracking it forever", () => {
    const pool = new Particles(10);
    pool.add(spark({ y: -1000 }));
    pool.add(spark({ x: 5000 }));
    pool.add(spark());
    expect(drawn(pool)).toBe(1);
    expect(pool.count).toBe(1);
  });

  it("drops from the middle without losing the rest", () => {
    const pool = new Particles(10);
    pool.add(spark({ x: 10 }));
    pool.add(spark({ x: 20, y: -1000 }));
    pool.add(spark({ x: 30 }));
    const seen: number[] = [];
    pool.sweep(1 / 60, view, drift, (particle) => seen.push(particle.x));
    expect(seen.sort((a, b) => a - b)).toEqual([10, 30]);
  });

  it("moves a particle the way the skin says, per second", () => {
    const pool = new Particles(10);
    pool.add(spark({ vx: 10, vy: -20 }));
    pool.sweep(0.5, view, drift, (particle) => {
      expect(particle.x).toBeCloseTo(105);
      expect(particle.y).toBeCloseTo(40);
    });
  });

  it("pulls a falling particle down and holds it back sideways", () => {
    const pool = new Particles(10);
    pool.add(spark({ vx: 100, vy: 0 }));
    pool.sweep(0.5, view, falls(100, 1), (particle) => {
      expect(particle.vy).toBeCloseTo(50);
      expect(particle.vx).toBeLessThan(100);
    });
  });
});
