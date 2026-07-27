import { shaderPrelude } from "@/lib/skins/fullscreen";
import { defineSkin, moodOf } from "@/lib/skins/scene";

/** Curtains of light hanging over a black sky. They are folded rather than
 * waved: the noise is sampled along one drifting horizontal band and smeared
 * upward, which is what gives a real aurora its vertical grain.
 *
 * The shader draws bottom-up, so `uv.y` near 1 is the top of the roll and the
 * keys are at 0. A curtain is brightest along its lower hem and fades out
 * overhead, the way one actually hangs.
 *
 * `tone` swings the colour from blue at the bass end to magenta at the top,
 * and `energy` lifts the hem. Blue and magenta rather than the usual green,
 * because the notes are green and have to win. */
const source = `${shaderPrelude}
vec3 curtain(vec2 uv, float band, float speed, float hue, float lift) {
  float fold = clouds(vec2(uv.x * 2.1 + time * speed, band));
  float hem = 0.36 + fold * 0.20 + lift;
  float head = hem + 0.26 + fold * 0.20;
  float body = smoothstep(hem - 0.06, hem + 0.03, uv.y)
             * (1.0 - smoothstep(hem + 0.02, head, uv.y));
  // The grain: fine vertical rays running the height of the curtain.
  float rays = 0.55 + 0.45 * noise(vec2(uv.x * 64.0 + time * speed * 2.0, band * 7.0));
  vec3 cool = vec3(0.18, 0.45, 0.95);
  vec3 hot = vec3(0.85, 0.25, 0.80);
  return mix(cool, hot, clamp(hue, 0.0, 1.0)) * body * rays;
}

void main() {
  vec2 uv = gl_FragCoord.xy / size;

  // Darkest overhead, so the curtains have somewhere to hang.
  vec3 sky = mix(vec3(0.013, 0.015, 0.030), vec3(0.004, 0.005, 0.012), uv.y);

  float hue = clamp(tone, 0.0, 1.0);
  float lift = energy * 0.10;
  vec3 light = curtain(uv, 1.3, 0.050, hue, lift) * 0.30
             + curtain(uv, 5.7, 0.033, hue + 0.22, lift * 0.7) * 0.21
             + curtain(uv, 11.9, 0.021, hue - 0.18, lift * 0.4) * 0.15;

  // Four fields at different densities and sizes, so the sky has depth rather
  // than one even scatter, and thinner toward the horizon where the curtains are.
  float depth = 0.35 + uv.y * 0.65;
  float field = stars(gl_FragCoord.xy, 46.0, 0.80, 0.30) * 1.0
              + stars(gl_FragCoord.xy, 27.0, 0.86, 0.45) * 0.62
              + stars(gl_FragCoord.xy, 15.0, 0.91, 0.55) * 0.38
              + stars(gl_FragCoord.xy, 9.0, 0.95, 0.65) * 0.22;
  // Not white: a real field runs from cold blue to warm.
  vec3 starLight = mix(vec3(0.72, 0.80, 1.0), vec3(1.0, 0.93, 0.80),
                       hash(floor(gl_FragCoord.xy * 0.11)));
  sky += starLight * field * 0.55 * depth;

  colour = vec4(sky + light * gain, 1.0);
}`;

/** How fast the eased mood catches up, per frame. Rising fast and falling slow
 * is what makes a chord lift the curtains instead of flickering them. */
const swellUp = 0.25;
const swellDown = 0.02;
const drift = 0.04;

export const aurora = defineSkin({
  id: "aurora",
  name: "Aurora",
  blurb:
    "Curtains of light over a black sky. They lift as you play, and the colour follows the register: blue at the bass end, magenta at the top.",
  shader: { source, gain: 0.75 },

  createScene() {
    let tone = 0.5;
    let energy = 0;
    return {
      mood(frame, view) {
        const now = moodOf(frame, view);
        tone += (now.tone - tone) * drift;
        energy +=
          (now.energy - energy) * (now.energy > energy ? swellUp : swellDown);
        return { tone, energy };
      },
    };
  },
});
