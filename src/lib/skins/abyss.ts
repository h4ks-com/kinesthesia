import { drift, Particles } from "@/lib/skins/particles";
import { defineSkin, type SceneView } from "@/lib/skins/scene";

type Mote = {
  x: number;
  y: number;
  rise: number;
  radius: number;
  sway: number;
};

const moteCount = 80;
/** Shafts of light coming down through the water. Slow, wide and barely there,
 * so they read as depth rather than as an effect. */
const shafts = [0.18, 0.44, 0.71, 0.9] as const;

function seedMotes(view: SceneView): Mote[] {
  const motes: Mote[] = [];
  for (let count = 0; count < moteCount; count += 1) {
    motes.push({
      x: Math.random() * view.width,
      y: Math.random() * view.height,
      rise: 3 + Math.random() * 14,
      radius: 0.5 + Math.random() * 1.8,
      sway: Math.random() * Math.PI * 2,
    });
  }
  return motes;
}

export const abyss = defineSkin({
  id: "abyss",
  name: "Abyss",
  blurb:
    "Deep water with almost no light left in it. Motes drift through the shafts, and every note leaving the keys drags a column of bubbles up behind it.",

  createScene() {
    let motes: Mote[] = [];
    let seeded = 0;
    const bubbles = new Particles(260);

    return {
      paint(ctx, view, frame, step) {
        if (seeded !== view.width) {
          motes = seedMotes(view);
          seeded = view.width;
        }

        const water = ctx.createLinearGradient(0, 0, 0, view.height);
        water.addColorStop(0, "#04121b");
        water.addColorStop(0.5, "#030c14");
        water.addColorStop(1, "#01060b");
        ctx.fillStyle = water;
        ctx.fillRect(0, 0, view.width, view.height);

        // The shafts lean with a slow swell, and fade out well before the keys.
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        shafts.forEach((across, index) => {
          const swing =
            Math.sin(frame.elapsed * 0.11 + index) * view.width * 0.04;
          const top = view.width * across + swing;
          const wide = view.width * (0.06 + index * 0.012);
          const beam = ctx.createLinearGradient(0, 0, 0, view.keyboardTop);
          beam.addColorStop(0, "rgba(90,190,220,0.10)");
          beam.addColorStop(0.6, "rgba(50,140,180,0.03)");
          beam.addColorStop(1, "rgba(20,80,120,0)");
          ctx.fillStyle = beam;
          ctx.beginPath();
          ctx.moveTo(top - wide, 0);
          ctx.lineTo(top + wide, 0);
          ctx.lineTo(top + wide * 3.2, view.keyboardTop);
          ctx.lineTo(top - wide * 2.4, view.keyboardTop);
          ctx.closePath();
          ctx.fill();
        });
        ctx.restore();

        ctx.fillStyle = "rgba(103,232,249,0.20)";
        for (const mote of motes) {
          mote.y -= mote.rise * step;
          if (mote.y < 0) {
            mote.y = view.height;
            mote.x = Math.random() * view.width;
          }
          ctx.beginPath();
          ctx.arc(
            mote.x + Math.sin(frame.elapsed * 0.6 + mote.sway) * 4,
            mote.y,
            mote.radius,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }

        for (const strike of frame.strikes) {
          for (let count = 0; count < 6; count += 1) {
            bubbles.add({
              x: strike.x + (Math.random() - 0.5) * 20,
              y: view.keyboardTop - Math.random() * 14,
              vx: 0,
              vy: -(50 + Math.random() * 120),
              fade: 0.28,
              size: 1 + Math.random() * 3.6,
              seed: Math.random() * Math.PI * 2,
            });
          }
        }

        // A note still climbing keeps trailing, so a held chord streams rather
        // than puffing once.
        for (const traveller of frame.travellers) {
          if (Math.random() < 0.22) {
            bubbles.add({
              x: traveller.x + (Math.random() - 0.5) * traveller.radius,
              y: traveller.y,
              vx: 0,
              vy: -(30 + Math.random() * 70),
              fade: 0.4,
              size: 0.8 + Math.random() * 2.2,
              seed: Math.random() * Math.PI * 2,
            });
          }
        }

        ctx.lineWidth = 1;
        bubbles.sweep(
          step,
          view,
          (particle, delta) => {
            particle.x +=
              Math.sin(frame.elapsed * 2.4 + particle.seed) * 14 * delta;
            drift(particle, delta);
          },
          (particle) => {
            ctx.globalAlpha = Math.min(1, particle.life) * 0.55;
            ctx.strokeStyle = "rgba(165,243,252,0.9)";
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
            ctx.stroke();
            // The catch-light is what makes a circle read as a bubble.
            ctx.globalAlpha = Math.min(1, particle.life) * 0.4;
            ctx.fillStyle = "#e0f7ff";
            ctx.beginPath();
            ctx.arc(
              particle.x - particle.size * 0.32,
              particle.y - particle.size * 0.32,
              Math.max(0.4, particle.size * 0.26),
              0,
              Math.PI * 2,
            );
            ctx.fill();
          },
        );
      },
    };
  },
});
