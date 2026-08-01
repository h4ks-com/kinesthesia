/** Ember, as a background script. Source rather than a module because it is
 * evaluated inside the worker, the same way one somebody wrote is. */
export const emberScript = String.raw`
/** Warm at birth and cooling on the way up, which is the whole of what makes a
 * spark read as hot rather than orange. */
function emberShade(life) {
  if (life > 0.72) {
    return "#fff1d6";
  }
  if (life > 0.45) {
    return "#fdba74";
  }
  return life > 0.22 ? "#f97316" : "#9a3412";
}

background({
  name: "Ember",
  blurb:
    "Black rock with the heat still in it. Sparks lift off the keys as you play and cool on the way up, and a loud passage brings the glow along the keybed with it.",
  directions: ["up"],

  create() {
    const sparks = new Particles(420);
    const motes = new Particles(90);
    let heat = 0;
    let smoulder = 0;

    return {
      paint(ctx, view, frame) {
        ctx.fillStyle = "#080604";
        ctx.fillRect(0, 0, view.width, view.height);

        // Heat follows what is sounding, rising fast and dying back slowly, so
        // the keybed breathes rather than flickers.
        const played = Math.min(1, frame.notes.length / 5);
        heat += (played - heat) * (played > heat ? 0.3 : 0.02);
        smoulder = Math.min(1, smoulder + frame.strikes.length * 0.2);
        smoulder = Math.max(0, smoulder - frame.step * 0.6);

        const reach = view.keyboardTop * 0.5;
        const glow = ctx.createLinearGradient(
          0,
          view.keyboardTop - reach,
          0,
          view.keyboardTop,
        );
        glow.addColorStop(0, "rgba(124,45,18,0)");
        glow.addColorStop(0.62, "rgba(154,52,18," + (0.06 + heat * 0.14) + ")");
        glow.addColorStop(1, "rgba(249,115,22," + (0.1 + heat * 0.3) + ")");
        ctx.fillStyle = glow;
        ctx.fillRect(0, view.keyboardTop - reach, view.width, reach);

        // Smoke sits over the glow and is only visible against it.
        if (random() < 0.35) {
          motes.add({
            x: random() * view.width,
            y: view.keyboardTop,
            vx: (random() - 0.5) * 14,
            vy: -(14 + random() * 26),
            fade: 0.18,
            size: 18 + random() * 44,
            seed: random(),
          });
        }
        motes.sweep(
          frame.step,
          view,
          (particle, delta) => {
            particle.size += 26 * delta;
            drift(particle, delta);
          },
          (particle) => {
            ctx.globalAlpha = particle.life * 0.07;
            const puff = ctx.createRadialGradient(
              particle.x,
              particle.y,
              0,
              particle.x,
              particle.y,
              particle.size,
            );
            puff.addColorStop(0, "rgba(120,90,70,1)");
            puff.addColorStop(1, "rgba(40,28,22,0)");
            ctx.fillStyle = puff;
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
            ctx.fill();
          },
        );
        ctx.globalAlpha = 1;

        for (const strike of frame.strikes) {
          const count = 10 + Math.floor(random() * 8);
          for (let index = 0; index < count; index += 1) {
            sparks.add({
              x: strike.x + (random() - 0.5) * 24,
              y: view.keyboardTop,
              vx: (random() - 0.5) * 70,
              vy: -(90 + random() * 230),
              fade: 0.42 + random() * 0.4,
              size: 1 + random() * 1.6,
              seed: random() * Math.PI * 2,
            });
          }
        }

        // A note still climbing keeps shedding, so a held chord keeps the
        // column alive under it.
        for (const traveller of frame.notes) {
          if (random() < 0.3) {
            sparks.add({
              x: traveller.x + (random() - 0.5) * traveller.radius * 1.4,
              y: traveller.y + traveller.radius,
              vx: (random() - 0.5) * 30,
              vy: -(20 + random() * 60),
              fade: 0.7,
              size: 0.8 + random() * 1.2,
              seed: random() * Math.PI * 2,
            });
          }
        }

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        sparks.sweep(
          frame.step,
          view,
          (particle, delta) => {
            // Rising air pushes back, and each spark wanders on its own phase.
            particle.vy += 42 * delta;
            particle.x +=
              Math.sin(frame.elapsed * 3 + particle.seed) * 22 * delta;
            drift(particle, delta);
          },
          (particle) => {
            ctx.globalAlpha = Math.min(1, particle.life * 1.4);
            ctx.fillStyle = emberShade(particle.life);
            ctx.fillRect(
              particle.x,
              particle.y,
              particle.size,
              particle.size + particle.life * 2.6,
            );
          },
        );
        ctx.restore();

        // A struck key throws a short flare across the rock, which is what sells
        // the keybed as the source of the heat.
        if (smoulder > 0.02) {
          const flare = ctx.createLinearGradient(
            0,
            view.keyboardTop - 26,
            0,
            view.keyboardTop,
          );
          flare.addColorStop(0, "rgba(255,190,110,0)");
          flare.addColorStop(1, "rgba(255,190,110," + smoulder * 0.22 + ")");
          ctx.fillStyle = flare;
          ctx.fillRect(0, view.keyboardTop - 26, view.width, 26);
        }
      },
    };
  },
});
`;
