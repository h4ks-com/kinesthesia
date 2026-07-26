import { shaderPrelude } from "@/lib/skins/fullscreen";
import { Particles } from "@/lib/skins/particles";
import { defineSkin, moodOf } from "@/lib/skins/scene";

/** The sky, the sun and the haze are a shader; the grid and the beams are drawn
 * over them, because they have to line up with the keys. */
const source = `${shaderPrelude}
void main() {
  vec2 uv = gl_FragCoord.xy / size;
  // The shader draws bottom-up, the roll top-down; flip so "sky" means sky.
  float up = 1.0 - uv.y;
  float line = 0.52;

  vec3 high = vec3(0.05, 0.02, 0.10);
  vec3 low = vec3(0.24, 0.05, 0.20);
  vec3 sky = mix(high, low, smoothstep(0.0, line, up));

  // A banded sun sitting on the horizon, the bands widening toward the bottom.
  vec2 middle = vec2(0.5, line);
  vec2 at = vec2((uv.x - middle.x) * (size.x / size.y), up - middle.y);
  float disc = length(at * vec2(1.0, 1.35));
  float sun = smoothstep(0.30, 0.02, disc);
  float slats = step(0.35, fract((middle.y - up) * 34.0 + 0.35));
  sun *= up > line ? 1.0 : max(slats, smoothstep(0.14, 0.0, disc));
  sky += mix(vec3(1.0, 0.30, 0.42), vec3(1.0, 0.72, 0.30), 1.0 - disc * 2.2) * sun * 0.85;

  // Haze along the horizon, lifted by whatever is playing.
  sky += vec3(0.9, 0.25, 0.55) * smoothstep(0.12, 0.0, abs(up - line)) * (0.16 + energy * 0.3);

  float star = step(0.9985, hash(floor(gl_FragCoord.xy * 0.5))) * step(line, up);
  sky += vec3(star) * 0.6;

  colour = vec4(sky * gain, 1.0);
}`;

/** Where the sun sits, as a share of the way down to the keys. The grid runs
 * from here to the keyboard. */
const horizonAt = 0.48;
const columns = 15;
const rows = 13;
/** How fast the floor runs toward you, in grid rows a second. */
const roll = 0.55;

export const horizon = defineSkin({
  id: "horizon",
  name: "Horizon",
  blurb:
    "A grid running out to a banded sun. Each key struck fires a beam up off the floor on that key's line, so the distance reads as a second keyboard.",
  shader: { source, gain: 1 },

  createScene() {
    const beams = new Particles(48);
    let energy = 0;

    return {
      mood(frame, view) {
        const now = moodOf(frame, view);
        energy += (now.energy - energy) * (now.energy > energy ? 0.3 : 0.03);
        return { tone: now.tone, energy };
      },

      paint(ctx, view, frame, step) {
        const line = view.keyboardTop * horizonAt;
        const floor = view.keyboardTop;
        const deep = floor - line;

        ctx.save();
        ctx.globalCompositeOperation = "lighter";

        for (const strike of frame.strikes) {
          beams.add({
            x: strike.x,
            y: 0,
            vx: 0,
            vy: 0,
            fade: 1.6,
            size: 0,
            seed: 0,
          });
        }

        // A beam stands on the horizon under the key that was struck and sinks
        // back into it.
        beams.sweep(
          step,
          view,
          () => {},
          (particle) => {
            const reach = deep * 0.9 * particle.life;
            const glow = ctx.createLinearGradient(0, line - reach, 0, line);
            glow.addColorStop(0, "rgba(253,224,71,0)");
            glow.addColorStop(1, `rgba(253,224,71,${particle.life * 0.55})`);
            ctx.fillStyle = glow;
            ctx.fillRect(particle.x - 1.5, line - reach, 3, reach);
          },
        );
        ctx.restore();

        // The floor. Verticals fan out of the vanishing point; the horizontals
        // bunch toward it, so the spacing itself carries the distance.
        ctx.strokeStyle = `rgba(217,70,239,${0.34 + energy * 0.26})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const middle = view.width / 2;
        for (let column = -columns; column <= columns; column += 1) {
          ctx.moveTo(middle + column * 9, line);
          ctx.lineTo(middle + column * (view.width / 5), floor + 40);
        }
        const creep = (frame.elapsed * roll) % 1;
        for (let row = 0; row < rows; row += 1) {
          const depth = (row + creep) / rows;
          const y = line + deep * depth * depth;
          ctx.moveTo(0, y);
          ctx.lineTo(view.width, y);
        }
        ctx.stroke();

        // A haze where the grid meets the sky, so the two are one place.
        const seam = ctx.createLinearGradient(0, line - 24, 0, line + 24);
        seam.addColorStop(0, "rgba(244,63,94,0)");
        seam.addColorStop(0.5, "rgba(244,63,94,0.22)");
        seam.addColorStop(1, "rgba(244,63,94,0)");
        ctx.fillStyle = seam;
        ctx.fillRect(0, line - 24, view.width, 48);
      },
    };
  },
});
