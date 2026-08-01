/** Rainfall, as a background script. Source rather than a module because it is
 * evaluated inside the worker, the same way one somebody wrote is. */
export const rainfallScript = String.raw`
const sheets = [
  {
    count: 46,
    speed: 1180,
    length: 46,
    width: 1.5,
    shade: "rgba(186,220,255,0.34)",
  },
  {
    count: 60,
    speed: 760,
    length: 30,
    width: 1,
    shade: "rgba(147,197,253,0.22)",
  },
  {
    count: 70,
    speed: 430,
    length: 18,
    width: 0.8,
    shade: "rgba(120,160,215,0.14)",
  },
];

const ringLife = 1.5;

function seed(sheet, view) {
  sheet.drops.length = 0;
  for (let count = 0; count < sheet.look.count; count += 1) {
    sheet.drops.push({
      x: random() * view.width,
      y: random() * view.height,
      speed: sheet.look.speed * (0.85 + random() * 0.3),
      length: sheet.look.length * (0.7 + random() * 0.6),
    });
  }
}

background({
  name: "Rainfall",
  blurb:
    "A storm behind glass. The rain falls the way the notes do, every key struck sets a ring spreading across the pane, and a full chord throws lightning.",
  directions: ["down"],

  create() {
    const sheetState = sheets.map((look) => ({ drops: [], look }));
    const rings = new Particles(40);
    const splashes = new Particles(120);
    let seeded = 0;
    let flash = 0;
    let lightning = 0;

    return {
      paint(ctx, view, frame) {
        if (seeded !== view.width) {
          for (const sheet of sheetState) {
            seed(sheet, view);
          }
          seeded = view.width;
        }

        const storm = ctx.createLinearGradient(0, 0, 0, view.height);
        storm.addColorStop(0, "#05070c");
        storm.addColorStop(0.55, "#080c14");
        storm.addColorStop(1, "#0b1119");
        ctx.fillStyle = storm;
        ctx.fillRect(0, 0, view.width, view.height);

        // A full handful lights the cloud, then it decays on its own.
        if (frame.strikes.length >= 3 && lightning <= 0) {
          flash = 1;
          lightning = 1.4;
        }
        lightning = Math.max(0, lightning - frame.step);
        if (flash > 0) {
          const sheetGlow = ctx.createLinearGradient(0, 0, 0, view.keyboardTop);
          sheetGlow.addColorStop(0, "rgba(196,220,255," + flash * 0.2 + ")");
          sheetGlow.addColorStop(1, "rgba(196,220,255,0)");
          ctx.fillStyle = sheetGlow;
          ctx.fillRect(0, 0, view.width, view.keyboardTop);
          flash = Math.max(0, flash - frame.step * 3.4);
        }

        for (const sheet of sheetState) {
          ctx.strokeStyle = sheet.look.shade;
          ctx.lineWidth = sheet.look.width;
          ctx.beginPath();
          for (const drop of sheet.drops) {
            drop.y += drop.speed * frame.step;
            if (drop.y - drop.length > view.keyboardTop) {
              drop.y = -drop.length;
              drop.x = random() * view.width;
              if (splashes.count < 60) {
                splashes.add({
                  x: drop.x,
                  y: view.keyboardTop,
                  vx: (random() - 0.5) * 40,
                  vy: -40 - random() * 60,
                  fade: 2.6,
                  size: 1,
                  seed: 0,
                });
              }
            }
            ctx.moveTo(drop.x, drop.y - drop.length);
            ctx.lineTo(drop.x + drop.length * 0.09, drop.y);
          }
          ctx.stroke();
        }

        // What bounces back off the keys, so the rain lands rather than stops.
        ctx.fillStyle = "rgba(191,219,254,0.5)";
        splashes.sweep(
          frame.step,
          view,
          (particle, delta) => {
            particle.vy += 420 * delta;
            drift(particle, delta);
          },
          (particle) => {
            ctx.globalAlpha = particle.life * 0.6;
            ctx.fillRect(particle.x, particle.y, 1.4, 1.4);
          },
        );
        ctx.globalAlpha = 1;

        for (const strike of frame.strikes) {
          rings.add({
            x: strike.x,
            y: view.keyboardTop - 24,
            vx: 0,
            vy: 0,
            fade: 1 / ringLife,
            size: 0,
            seed: 0,
          });
        }

        ctx.lineWidth = 1.4;
        rings.sweep(
          frame.step,
          view,
          (particle, delta) => {
            particle.size += 230 * delta;
          },
          (particle) => {
            ctx.globalAlpha = particle.life * particle.life * 0.42;
            ctx.strokeStyle = "#dbeafe";
            ctx.beginPath();
            ctx.ellipse(
              particle.x,
              particle.y,
              particle.size,
              particle.size * 0.34,
              0,
              0,
              Math.PI * 2,
            );
            ctx.stroke();
          },
        );
      },
    };
  },
});
`;
