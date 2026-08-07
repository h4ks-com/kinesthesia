/** Smoke, as a background script. Source rather than a module because it is
 * evaluated inside the worker, the same way one somebody wrote is. */
export const smokeScript = String.raw`
const authoredWidth = 1280;
const authoredArea = 1280 * 800;
const spriteSize = 128;
/* Colour is quantised to the top nibble of each channel, so this only ever
   holds the handful of shades the roll paints notes in. */
const shadesKept = 48;
/* Puffs at the width and area the scene was built against. Everything below is
   a fraction of it. */
const roomiest = 2600;
const fewest = 260;

background({
  name: "Smoke",
  blurb:
    "Total darkness, and coloured smoke off every key struck. It gathers and drifts as you play, and notes climbing away from the keys push it aside.",
  directions: ["up", "down"],

  create() {
    const puffs = [];
    /* The grain of the hit itself: far too small and short lived to read as
       smoke, and gone before it can pile up, so it costs nothing to keep the
       burst sharp while the puffs behind it stay soft. */
    const grit = [];
    /* The heat left on the key for an instant after it is struck. Without it
       the burst has no source and the spray looks like it began in mid air. */
    const flares = [];
    let sheets = {};
    let held = 0;

    /* One smooth falloff and no structure of its own. Smoke reads as smoke
       because many faint puffs overlap; give a single puff an outline or a
       solid core and the eye picks it out as a ball instead. */
    function sheetFor(r, g, b) {
      const key = ((r & 0xf0) << 16) | ((g & 0xf0) << 8) | (b & 0xf0);
      const kept = sheets[key];
      if (kept !== undefined) {
        return kept;
      }
      if (held >= shadesKept) {
        sheets = {};
        held = 0;
      }
      const sheet = new OffscreenCanvas(spriteSize, spriteSize);
      const ctx = sheet.getContext("2d");
      const mid = spriteSize / 2;
      const tint = (r & 0xf0) + "," + (g & 0xf0) + "," + (b & 0xf0);
      const cloud = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
      cloud.addColorStop(0, "rgba(" + tint + ",1)");
      cloud.addColorStop(0.25, "rgba(" + tint + ",0.65)");
      cloud.addColorStop(0.55, "rgba(" + tint + ",0.25)");
      cloud.addColorStop(1, "rgba(" + tint + ",0)");
      ctx.fillStyle = cloud;
      ctx.fillRect(0, 0, spriteSize, spriteSize);

      sheets[key] = sheet;
      held += 1;
      return sheet;
    }

    function tintOf(colour) {
      if (typeof colour === "string" && colour.charCodeAt(0) === 35) {
        const body =
          colour.length === 4
            ? colour[1] + colour[1] + colour[2] + colour[2] + colour[3] + colour[3]
            : colour.slice(1);
        return [
          parseInt(body.slice(0, 2), 16),
          parseInt(body.slice(2, 4), 16),
          parseInt(body.slice(4, 6), 16),
        ];
      }
      const found =
        typeof colour === "string" ? colour.match(/(\d+)[, ]+(\d+)[, ]+(\d+)/) : null;
      return found === null
        ? [100, 140, 220]
        : [Number(found[1]), Number(found[2]), Number(found[3])];
    }

    return {
      paint(ctx, view, frame) {
        const step = frame.step;
        const width = view.width;
        const height = view.height;
        const keyboardTop = view.keyboardTop;
        /* Every length here is in pixels the scene was drawn against, so on a
           narrow screen the same puff would cover several times as much of the
           frame and the whole thing would burn out white under lighter. */
        const scale = Math.min(1.15, Math.max(0.65, width / authoredWidth));

        /* What the field costs is what it draws, so the budget follows the area
           it is drawn over. A background is handed no measure of its own speed:
           it cannot read a clock, and the step it is given is the roll's frame
           gap on another thread, which holds steady however slow this gets. */
        const room = Math.min(1, (width * height) / authoredArea);
        const ceiling = Math.max(fewest, Math.round(roomiest * room));

        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, width, height);

        const crowd = puffs.length / ceiling;
        /* Over budget the whole field thins a little faster. Dropping the
           oldest instead takes away the grown clouds, which are the ones being
           looked at, and a busy song reads as the smoke cutting out. */
        const wear = crowd > 1 ? 1 + (crowd - 1) * 4 : 1;

        for (const strike of frame.strikes) {
          const parts = tintOf(strike.color);
          /* A key struck always smokes; when the field is full it smokes
             thinner. Refusing the strike would read as a missed note. */
          const thinned = 1 - Math.min(1, crowd) * 0.6;
          const count = Math.max(5, Math.round((11 + strike.velocity * 9) * thinned));
          for (let index = 0; index < count; index += 1) {
            const angle = -Math.PI / 2 + (random() - 0.5) * 0.7;
            const speed = (120 + random() * 140 + strike.velocity * 90) * scale;
            puffs.push({
              x: strike.x + (random() - 0.5) * 12 * scale,
              y: keyboardTop + (random() - 0.5) * 4,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              settled: false,
              age: 0,
              spreads: 0.16 + random() * 0.5,
              swirl: random() * 6.283,
              swirlRate: (random() < 0.5 ? -1 : 1) * (0.8 + random() * 3.6),
              orbit: (1 + random() * 3) * scale,
              orbitGrowth: (14 + random() * 70) * scale,
              /* Each puff is given its own shape of wander as well as its own
                 phase. Shared amplitudes leave them tracing one figure at
                 different offsets, which the eye reads as a single dance. */
              orbitSquash: 0.2 + random() * 0.65,
              lift: (13 + random() * 20) * scale,
              turnAmp: (9 + random() * 26) * scale,
              swayAmp: (4 + random() * 15) * scale,
              wanderX: (30 + random() * 80) * scale,
              bias: (random() - 0.5) * 22 * scale,
              size: (4.5 + random() * 4) * scale,
              growth: (5 + random() * 5) * scale,
              life: 1,
              span: 5 + random() * 5,
              r: parts[0],
              g: parts[1],
              b: parts[2],
              turn: random() * 6.283,
              sway: random() * 6.283,
              turnRate: 0.3 + random() * 1.5,
              swayRate: 0.15 + random() * 1.1,
              driftX: 0,
              driftY: 0,
            });
          }

          const specks = Math.round(9 + strike.velocity * 11);
          for (let index = 0; index < specks; index += 1) {
            const angle = -Math.PI / 2 + (random() - 0.5) * 0.5;
            const speed = (210 + random() * 300 + strike.velocity * 170) * scale;
            grit.push({
              x: strike.x + (random() - 0.5) * 9 * scale,
              y: keyboardTop + (random() - 0.5) * 3,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              size: (0.9 + random() * 1.5) * scale,
              life: 1,
              span: 0.3 + random() * 0.45,
              // Lifted toward white, so the hit reads as the bright point the
              // smoke is thrown from. Built once here: a speck's colour never
              // changes, and rebuilding it every frame of its life is a string
              // and a parse per speck per frame.
              tint:
                "rgb(" +
                Math.min(255, parts[0] + 90) +
                "," +
                Math.min(255, parts[1] + 90) +
                "," +
                Math.min(255, parts[2] + 90) +
                ")",
            });
          }

          flares.push({
            x: strike.x,
            y: keyboardTop,
            life: 1,
            span: 0.18 + strike.velocity * 0.14,
            reach: (26 + strike.velocity * 30) * scale,
            r: Math.min(255, parts[0] + 60),
            g: Math.min(255, parts[1] + 60),
            b: Math.min(255, parts[2] + 60),
          });
        }

        /* Only a note still well clear of the keys pushes smoke: one just off
           them sits inside the spray it is meant to be leaving. */
        const parting = keyboardTop * 0.9;
        const pushes = [];
        for (const note of frame.notes) {
          if (note.y < parting) {
            pushes.push(note);
          }
        }

        ctx.globalCompositeOperation = "lighter";

        for (let index = flares.length - 1; index >= 0; index -= 1) {
          const flare = flares[index];
          flare.life -= step / flare.span;
          if (flare.life <= 0) {
            const last = flares.pop();
            if (last !== undefined && index < flares.length) {
              flares[index] = last;
            }
            continue;
          }
          const grown = flare.reach * (1.6 - flare.life * 0.6);
          const sheet = sheetFor(flare.r, flare.g, flare.b);
          ctx.globalAlpha = flare.life * flare.life * 0.5;
          ctx.drawImage(sheet, flare.x - grown, flare.y - grown, grown * 2, grown * 2);
        }

        for (let index = puffs.length - 1; index >= 0; index -= 1) {
          const puff = puffs[index];
          puff.life -= (step / puff.span) * wear;
          if (puff.life <= 0) {
            const last = puffs.pop();
            if (last !== undefined && index < puffs.length) {
              puffs[index] = last;
            }
            continue;
          }

          const age = 1 - puff.life;
          puff.age += step;
          if (!puff.settled && puff.age > puff.spreads) {
            puff.settled = true;
          }

          let opening = 0;
          if (!puff.settled) {
            puff.vy *= 1 - step * 3.8;
            puff.vx *= 1 - step * 4.2;
            puff.x += puff.vx * step;
            puff.y += puff.vy * step;
          } else {
            const since = puff.age - puff.spreads;
            opening = Math.min(1, since);
            opening = opening * opening * (3 - 2 * opening);

            puff.vy -= puff.lift * step;
            puff.vy *= 1 - step * 0.12;
            puff.vx *= 1 - step * 0.22;

            puff.driftX += (random() - 0.5) * puff.wanderX * step;
            puff.driftY += (random() - 0.5) * 25 * scale * step;
            puff.driftX *= 1 - step * 0.65;
            puff.driftY *= 1 - step * 0.75;

            puff.turn += puff.turnRate * step;
            puff.sway += puff.swayRate * step;
            const rollX =
              Math.sin(puff.turn) * puff.turnAmp +
              Math.sin(puff.sway * 1.7) * puff.swayAmp +
              puff.bias;
            const rollY =
              Math.cos(puff.turn * 0.8) * puff.swayAmp * 0.7 +
              Math.cos(puff.sway * 1.3) * puff.turnAmp * 0.2;

            puff.x += (puff.vx + puff.driftX + rollX) * step;
            puff.y += (puff.vy + puff.driftY + rollY) * step;

            if (puff.y < parting) {
              for (const note of pushes) {
                const awayX = puff.x - note.x;
                const awayY = puff.y - note.y;
                const gap = awayX * awayX + awayY * awayY;
                const reach = note.radius + 55 * scale;
                if (gap < reach * reach && gap > 0.5) {
                  const span = Math.sqrt(gap);
                  const nearness = 1 - span / reach;
                  const shove = nearness * nearness * 320 * scale * step;
                  puff.vx += (awayX / span) * shove;
                  puff.vy += (awayY / span) * shove;
                  // A little across as well as out, so the smoke curls around
                  // the note rather than only fleeing it.
                  puff.vx += (-awayY / span) * shove * 0.25;
                  puff.vy += (awayX / span) * shove * 0.25;
                }
              }
            }
          }

          const risen = 1 - puff.y / height;
          const nearer = 1 + Math.max(0, risen - 0.25) * 1.5;

          puff.swirl += puff.swirlRate * step * opening;
          const orbit = (puff.orbit + puff.orbitGrowth * age) * opening;
          const x = puff.x + Math.cos(puff.swirl) * orbit;
          const y = puff.y + Math.sin(puff.swirl) * orbit * puff.orbitSquash;

          puff.size += puff.growth * step;
          const radius = Math.max(5 * scale, puff.size * nearer);

          if (
            x + radius < 0 ||
            x - radius > width ||
            y + radius < 0 ||
            y - radius > height
          ) {
            continue;
          }

          let depth =
            puff.life > 0.12 ? 0.28 * (1 - age * 0.35) : 0.28 * (puff.life / 0.12);
          depth *= 0.75 + 0.25 * Math.sin(puff.turn * 2.1);
          /* Only the swollen tail is held back. Alpha kept while the radius
             grows means a puff throws light by its area, and a long passage
             packs the top of the screen into blown white lumps. */
          depth *= Math.min(1, Math.sqrt((110 * scale) / radius));

          const sheet = sheetFor(puff.r, puff.g, puff.b);
          ctx.globalAlpha = Math.min(1, depth);
          const across = radius * 2;
          ctx.drawImage(sheet, x - radius, y - radius, across, across);
        }

        ctx.lineCap = "round";
        for (let index = grit.length - 1; index >= 0; index -= 1) {
          const speck = grit[index];
          speck.life -= step / speck.span;
          if (speck.life <= 0) {
            const last = grit.pop();
            if (last !== undefined && index < grit.length) {
              grit[index] = last;
            }
            continue;
          }
          speck.vy *= 1 - step * 3.2;
          speck.vx *= 1 - step * 3.6;
          speck.x += speck.vx * step;
          speck.y += speck.vy * step;
          ctx.globalAlpha = speck.life * speck.life * 0.85;
          ctx.strokeStyle = speck.tint;
          ctx.lineWidth = speck.size * 2;
          /* Drawn along where it has just been. A speck this small is a round
             dot at any one instant, and a field of dots reads as fireflies;
             the streak is what makes it spray. */
          ctx.beginPath();
          ctx.moveTo(speck.x, speck.y);
          ctx.lineTo(speck.x - speck.vx * 0.022, speck.y - speck.vy * 0.022);
          ctx.stroke();
        }

        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
      },
    };
  },
});
`;
