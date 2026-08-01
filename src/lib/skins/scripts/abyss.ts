/** Abyss, as a background script. Source rather than a module because it is
 * evaluated inside the worker, the same way one somebody wrote is. */
export const abyssScript = String.raw`
const moteCount = 80;
/** Shafts of light coming down through the water. Slow, wide and barely there,
 * so they read as depth rather than as an effect. */
const shafts = [0.18, 0.44, 0.71, 0.9];

function seedMotes(view) {
  const motes = [];
  for (let count = 0; count < moteCount; count += 1) {
    motes.push({
      x: random() * view.width,
      y: random() * view.height,
      rise: 3 + random() * 14,
      radius: 0.5 + random() * 1.8,
      sway: random() * Math.PI * 2,
    });
  }
  return motes;
}

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

function drawFish(ctx, fish, elapsed) {
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

function drawSubmarine(ctx, sub, elapsed) {
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
class DeepLife {
  fish = new Particles(maxFish);
  sub = null;

  school(view) {
    const toRight = random() < 0.5;
    const size = 4 + random() * 7;
    const speed = (14 + random() * 26) * (toRight ? 1 : -1);
    const facing = toRight ? 1 : -1;
    const from = toRight ? -24 : view.width + 24;
    const depth = view.keyboardTop * (0.12 + random() * 0.72);
    const count = 3 + Math.floor(random() * 7);
    // The whole string has to start inside the margin the pool culls at, or the
    // back of a long school is forgotten on the frame it is made.
    const trail = Math.min(maxTrail, count * (size * 3.4 + 16));
    for (let index = 0; index < count; index += 1) {
      this.fish.add({
        // Strung out behind the leader rather than stacked, so it reads as a
        // school and not as a row.
        x: from - facing * (index / count) * trail,
        y: depth + (random() - 0.5) * size * 9,
        vx: speed * (0.85 + random() * 0.3),
        vy: (random() - 0.5) * 5,
        fade: 0,
        size: size * (0.75 + random() * 0.5),
        seed: random() * Math.PI * 2,
      });
    }
  }

  paint(ctx, view, elapsed, step) {
    if (random() < schoolRate * step) {
      this.school(view);
    }
    if (this.sub === null && random() < subRate * step) {
      const toRight = random() < 0.5;
      const size = 26 + random() * 22;
      this.sub = {
        x: toRight ? -size * 3 : view.width + size * 3,
        y: view.keyboardTop * (0.2 + random() * 0.5),
        speed: (26 + random() * 18) * (toRight ? 1 : -1),
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

background({
  name: "Abyss",
  blurb:
    "Deep water with almost no light left in it. Schools of fish cross the shafts, a submarine passes now and then, and every note leaving the keys drags a column of bubbles up behind it.",
  directions: ["up"],

  create() {
    let motes = [];
    let seeded = 0;
    const bubbles = new Particles(260);
    const life = new DeepLife();

    return {
      paint(ctx, view, frame) {
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

        life.paint(ctx, view, frame.elapsed, frame.step);

        ctx.fillStyle = "rgba(103,232,249,0.20)";
        for (const mote of motes) {
          mote.y -= mote.rise * frame.step;
          if (mote.y < 0) {
            mote.y = view.height;
            mote.x = random() * view.width;
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
              x: strike.x + (random() - 0.5) * 20,
              y: view.keyboardTop - random() * 14,
              vx: 0,
              vy: -(50 + random() * 120),
              fade: 0.28,
              size: 1 + random() * 3.6,
              seed: random() * Math.PI * 2,
            });
          }
        }

        // A note still climbing keeps trailing, so a held chord streams rather
        // than puffing once.
        for (const traveller of frame.notes) {
          if (random() < 0.22) {
            bubbles.add({
              x: traveller.x + (random() - 0.5) * traveller.radius,
              y: traveller.y,
              vx: 0,
              vy: -(30 + random() * 70),
              fade: 0.4,
              size: 0.8 + random() * 2.2,
              seed: random() * Math.PI * 2,
            });
          }
        }

        ctx.lineWidth = 1;
        bubbles.sweep(
          frame.step,
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
`;
