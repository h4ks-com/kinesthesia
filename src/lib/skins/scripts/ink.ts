/** Ink, as a background script. Source rather than a module because it is
 * evaluated inside the worker, the same way one somebody wrote is. */
export const inkScript = String.raw`
const bloomLife = 3.4;
const most = 60;

background({
  name: "Ink",
  blurb:
    "Near-black paper. A key struck blooms a cloud of ink that spreads, thins and is gone. The quietest of them, and the only one that never moves on its own.",
  directions: ["up", "down"],

  create() {
    let paper = null;
    let drawnAt = 0;
    const blooms = [];

    /* The paper is drawn once and stamped, because fibre that moves is not
       paper. */
    function makePaper(view) {
      const sheet = new OffscreenCanvas(
        Math.max(1, Math.round(view.width)),
        Math.max(1, Math.round(view.height)),
      );
      const ctx = sheet.getContext("2d");
      ctx.fillStyle = "#08080a";
      ctx.fillRect(0, 0, sheet.width, sheet.height);
      ctx.strokeStyle = "rgba(148,163,184,0.05)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let fibre = 0; fibre < 220; fibre += 1) {
        const x = random() * sheet.width;
        const y = random() * sheet.height;
        const length = 8 + random() * 46;
        const lean = (random() - 0.5) * 0.7;
        ctx.moveTo(x, y);
        ctx.lineTo(x + length, y + length * lean);
      }
      ctx.stroke();
      return sheet;
    }

    return {
      paint(ctx, view, frame) {
        if (drawnAt !== view.width && view.width > 0) {
          paper = makePaper(view);
          drawnAt = view.width;
        }
        if (paper === null) {
          ctx.fillStyle = "#08080a";
          ctx.fillRect(0, 0, view.width, view.height);
        } else {
          ctx.drawImage(paper, 0, 0, view.width, view.height);
        }

        for (const strike of frame.strikes) {
          if (blooms.length >= most) {
            blooms.shift();
          }
          blooms.push({
            x: strike.x,
            y: view.keyboardTop - 40 - random() * 110,
            vx: (random() - 0.5) * 10,
            vy: -6 - random() * 10,
            size: 5,
            life: 1,
            seed: random() * Math.PI * 2,
          });
        }

        for (let i = blooms.length - 1; i >= 0; i -= 1) {
          const bloom = blooms[i];
          bloom.life -= frame.step / bloomLife;
          if (bloom.life <= 0) {
            blooms.splice(i, 1);
            continue;
          }
          /* Fast at first and slowing, the way ink meets wet paper. */
          bloom.size += (52 + bloom.size * 0.4) * frame.step * bloom.life;
          bloom.x += bloom.vx * frame.step;
          bloom.y += bloom.vy * frame.step;

          const spread = Math.max(1, bloom.size);
          /* Three offset discs rather than one, so the edge is ragged. */
          for (let lobe = 0; lobe < 3; lobe += 1) {
            const around = bloom.seed + lobe * 2.1;
            const off = spread * 0.22;
            const x = bloom.x + Math.cos(around) * off;
            const y = bloom.y + Math.sin(around) * off;
            const wash = ctx.createRadialGradient(x, y, 0, x, y, spread);
            const depth = bloom.life * 0.26;
            wash.addColorStop(0, "rgba(100,116,139," + depth + ")");
            wash.addColorStop(0.55, "rgba(51,65,85," + depth * 0.5 + ")");
            wash.addColorStop(1, "rgba(15,23,42,0)");
            ctx.fillStyle = wash;
            ctx.beginPath();
            ctx.arc(x, y, spread, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      },
    };
  },
});
`;
