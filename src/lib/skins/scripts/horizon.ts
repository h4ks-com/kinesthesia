/** Horizon, as a background script. Source rather than a module because it is
 * evaluated inside the worker, the same way ink is.
 *
 * The sky, the sun and the haze are a shader; the grid and the beams are drawn
 * over them, because they have to line up with the keys. */
export const horizonScript = String.raw`
/** Where the sun sits, as a share of the way down to the keys. The grid runs
 * from here to the keyboard. */
const horizonAt = 0.54;
const columns = 15;
const rows = 13;
/** How fast the floor runs toward you, in grid rows a second. */
const roll = 0.55;

const horizonSource = shaderPrelude +
  "/* A ridge of peaks along the horizon, from a sawtooth over a hashed height per\n" +
  "   peak, so the skyline is jagged rather than a repeating wave. */\n" +
  "float ridge(float x, float scale, float lift) {\n" +
  "  float along = x * scale;\n" +
  "  float peak = floor(along);\n" +
  "  float within = fract(along);\n" +
  "  float tall = lift * (0.45 + hash(vec2(peak, 3.7)) * 0.85);\n" +
  "  // Rounded rather than sawn, so the skyline reads as hills at a distance.\n" +
  "  return tall * pow(sin(within * 3.14159), 1.6);\n" +
  "}\n" +
  "\n" +
  "void main() {\n" +
  "  // The shader draws bottom-up: uv.y is 0 at the keys and 1 overhead.\n" +
  "  vec2 uv = gl_FragCoord.xy / size;\n" +
  "  float horizon = 0.46;\n" +
  "  float aspect = size.x / size.y;\n" +
  "\n" +
  "  // Deep indigo overhead falling to magenta at the skyline, which is the whole\n" +
  "  // of the look: the sun and the grid sit inside that gradient.\n" +
  "  vec3 deep = vec3(0.035, 0.015, 0.10);\n" +
  "  vec3 dusk = vec3(0.32, 0.05, 0.30);\n" +
  "  float up = smoothstep(horizon, 1.0, uv.y);\n" +
  "  vec3 sky = mix(dusk, deep, pow(up, 0.7));\n" +
  "\n" +
  "  // Standing on the skyline rather than centred on it, so the sliced half of\n" +
  "  // the disc is above the peaks where it can be seen.\n" +
  "  vec2 at = vec2((uv.x - 0.5) * aspect, uv.y - horizon - 0.11);\n" +
  "  float disc = length(at * vec2(1.0, 1.25));\n" +
  "\n" +
  "  // Gold at the crown running down through orange to deep rose. Kept well\n" +
  "  // clear of the track pink and well below the notes in brightness: a note\n" +
  "  // crossing the sun has to stay the brightest thing on that pixel.\n" +
  "  float across = clamp((at.y + 0.10) / 0.46, 0.0, 1.0);\n" +
  "  vec3 face = mix(vec3(0.46, 0.06, 0.20), vec3(0.62, 0.26, 0.13), smoothstep(0.0, 0.55, across));\n" +
  "  face = mix(face, vec3(0.72, 0.58, 0.22), smoothstep(0.5, 1.0, across));\n" +
  "\n" +
  "  // Slices only below the crown, widening toward the waterline, and cut off\n" +
  "  // where the sun meets the ground so they never band the sky.\n" +
  "  float band = fract((horizon + 0.36 - uv.y) * 15.0);\n" +
  "  float slice = smoothstep(0.46, 0.52, band);\n" +
  "  float sliced = at.y < 0.20 ? mix(1.0, slice, smoothstep(0.20, 0.06, at.y)) : 1.0;\n" +
  "\n" +
  "  float body = smoothstep(0.245, 0.232, disc) * sliced;\n" +
  "  float halo = pow(smoothstep(0.52, 0.22, disc), 2.0);\n" +
  "  sky = mix(sky, face, body * 0.92);\n" +
  "  sky += face * halo * 0.09;\n" +
  "\n" +
  "  // A skyline of peaks standing on the horizon, dark against the sun.\n" +
  "  float peaks = horizon + ridge(uv.x * aspect, 3.5, 0.055) + ridge(uv.x * aspect, 8.0, 0.022);\n" +
  "  float ground = smoothstep(peaks + 0.004, peaks - 0.004, uv.y);\n" +
  "  sky = mix(sky, vec3(0.10, 0.03, 0.16), ground * step(uv.y, horizon + 0.14));\n" +
  "\n" +
  "  // Below the horizon the floor is nearly black, so the drawn grid can glow.\n" +
  "  sky = mix(sky, vec3(0.045, 0.010, 0.075), smoothstep(horizon + 0.005, horizon - 0.02, uv.y));\n" +
  "\n" +
  "  // A line of light where the ground meets the sky, lifted by the playing.\n" +
  "  sky += vec3(1.0, 0.25, 0.62) * smoothstep(0.020, 0.0, abs(uv.y - horizon)) * (0.22 + energy * 0.30);\n" +
  "\n" +
  "  float field = stars(gl_FragCoord.xy, 40.0, 0.82, 0.30)\n" +
  "              + stars(gl_FragCoord.xy, 22.0, 0.89, 0.45) * 0.55;\n" +
  "  sky += vec3(0.86, 0.90, 1.0) * field * 0.5 * up * step(horizon + 0.16, uv.y);\n" +
  "\n" +
  "  colour = vec4(sky * gain, 1.0);\n" +
  "}";

background({
  name: "Horizon",
  blurb:
    "A neon grid running out to a sliced sun over a dark skyline. Each key struck fires a beam up off the floor on that key's line, so the distance reads as a second keyboard.",
  directions: ["down"],
  shader: { source: horizonSource, gain: 1 },

  create() {
    const beams = new Particles(48);
    let energy = 0;

    return {
      mood(frame, view) {
        const now = moodOf(frame, view);
        energy += (now.energy - energy) * (now.energy > energy ? 0.3 : 0.03);
        return { tone: now.tone, energy };
      },

      paint(ctx, view, frame) {
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

        /* A beam stands on the horizon under the key that was struck and sinks
           back into it. */
        beams.sweep(
          frame.step,
          view,
          () => {},
          (particle) => {
            const reach = deep * 0.9 * particle.life;
            const glow = ctx.createLinearGradient(0, line - reach, 0, line);
            glow.addColorStop(0, "rgba(120,240,255,0)");
            glow.addColorStop(1, "rgba(120,240,255," + particle.life * 0.42 + ")");
            ctx.fillStyle = glow;
            ctx.fillRect(particle.x - 1.5, line - reach, 3, reach);
          },
        );
        ctx.restore();

        /* The floor. Verticals fan out of the vanishing point; the horizontals
           bunch toward it, so the spacing itself carries the distance. Drawn
           twice, wide and soft under thin and bright, which is what makes a
           line read as neon rather than as a stroke. */
        const middle = view.width / 2;
        const creep = (frame.elapsed * roll) % 1;
        const traceFloor = () => {
          ctx.beginPath();
          for (let column = -columns; column <= columns; column += 1) {
            ctx.moveTo(middle + column * 7, line);
            ctx.lineTo(middle + column * (view.width / 4.5), floor + 60);
          }
          for (let row = 0; row < rows; row += 1) {
            const depth = (row + creep) / rows;
            const y = line + deep * depth * depth;
            ctx.moveTo(0, y);
            ctx.lineTo(view.width, y);
          }
          ctx.stroke();
        };

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        /* The floor fades out toward the horizon, so the grid does not fight
           the sun sitting on it. */
        ctx.beginPath();
        ctx.rect(0, line, view.width, view.height - line);
        ctx.clip();

        ctx.strokeStyle = "rgba(226,70,255," + (0.16 + energy * 0.12) + ")";
        ctx.lineWidth = 5;
        traceFloor();
        ctx.strokeStyle = "rgba(255,150,255," + (0.3 + energy * 0.2) + ")";
        ctx.lineWidth = 1.1;
        traceFloor();
        ctx.restore();
      },
    };
  },
});
`;
