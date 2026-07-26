import { Particles } from "@/lib/skins/particles";
import { defineSkin, type SceneView } from "@/lib/skins/scene";

/** The paper. Drawn once into its own canvas and stamped each frame, because
 * fibre that moves is not paper. */
function makePaper(view: SceneView): HTMLCanvasElement | null {
  const paper = document.createElement("canvas");
  paper.width = Math.max(1, Math.round(view.width));
  paper.height = Math.max(1, Math.round(view.height));
  const ctx = paper.getContext("2d");
  if (ctx === null) {
    return null;
  }
  ctx.fillStyle = "#08080a";
  ctx.fillRect(0, 0, paper.width, paper.height);
  ctx.strokeStyle = "rgba(148,163,184,0.05)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let fibre = 0; fibre < 220; fibre += 1) {
    const x = Math.random() * paper.width;
    const y = Math.random() * paper.height;
    const length = 8 + Math.random() * 46;
    const lean = (Math.random() - 0.5) * 0.7;
    ctx.moveTo(x, y);
    ctx.lineTo(x + length, y + length * lean);
  }
  ctx.stroke();
  return paper;
}

/** How long a bloom takes to spread and vanish, in seconds. */
const bloomLife = 3.4;

export const ink = defineSkin({
  id: "ink",
  name: "Ink",
  blurb:
    "Near-black paper. A key struck blooms a cloud of ink that spreads, thins and is gone. The quietest of them, and the only one that leaves the roll entirely alone.",

  createScene() {
    const blooms = new Particles(60);
    let paper: HTMLCanvasElement | null = null;
    let drawn = 0;

    return {
      paint(ctx, view, frame, step) {
        if (drawn !== view.width && view.width > 0) {
          paper = makePaper(view);
          drawn = view.width;
        }
        if (paper === null) {
          ctx.fillStyle = "#08080a";
          ctx.fillRect(0, 0, view.width, view.height);
        } else {
          ctx.drawImage(paper, 0, 0, view.width, view.height);
        }

        for (const strike of frame.strikes) {
          blooms.add({
            x: strike.x,
            y: view.keyboardTop - 40 - Math.random() * 110,
            vx: (Math.random() - 0.5) * 10,
            vy: -6 - Math.random() * 10,
            fade: 1 / bloomLife,
            size: 5,
            seed: Math.random() * Math.PI * 2,
          });
        }

        blooms.sweep(
          step,
          view,
          (particle, delta) => {
            // Fast at first and slowing, the way ink meets wet paper.
            particle.size += (52 + particle.size * 0.4) * delta * particle.life;
            particle.x += particle.vx * delta;
            particle.y += particle.vy * delta;
          },
          (particle) => {
            const spread = Math.max(1, particle.size);
            // Three offset discs rather than one, so the edge is ragged.
            for (let lobe = 0; lobe < 3; lobe += 1) {
              const around = particle.seed + lobe * 2.1;
              const off = spread * 0.22;
              const x = particle.x + Math.cos(around) * off;
              const y = particle.y + Math.sin(around) * off;
              const wash = ctx.createRadialGradient(x, y, 0, x, y, spread);
              const depth = particle.life * 0.26;
              wash.addColorStop(0, `rgba(100,116,139,${depth})`);
              wash.addColorStop(0.55, `rgba(51,65,85,${depth * 0.5})`);
              wash.addColorStop(1, "rgba(15,23,42,0)");
              ctx.fillStyle = wash;
              ctx.beginPath();
              ctx.arc(x, y, spread, 0, Math.PI * 2);
              ctx.fill();
            }
          },
        );
      },
    };
  },
});
