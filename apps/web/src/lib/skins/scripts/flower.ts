/** A meadow that answers to the harmony. Source rather than a module because it
 * is evaluated inside the worker, the same way one somebody wrote is. */
export const flowerScript = String.raw`
/* How far the meadow can come up and how far back it can fall. Both ends are
   held, because a background that can run away is one that ends up either white
   or black and stays there. */
/* Where each chord wants the meadow, rather than what it adds: a song that sits
   on one chord settles somewhere and stays, which is what makes the meadow read
   as answering the music rather than counting it. Everything nameable but not
   plainly one or the other sits in the middle, since a seventh is not sad. */
const majorLife = 1;
const minorLife = 0.12;
const colourfulLife = 0.55;

/* How fast it gets there. Rising beats falling, so a song that mixes the two
   remembers its majors instead of grinding down to grey. Both are slow enough
   that the change is something you watch happen. */
const opening = 0.8;
const closing = 0.35;

/* Nothing here is brighter than this. The notes are the thing being read, and a
   meadow that competes with them is a worse background however pretty it is.
   Petals overlap, and overlapping fills compound toward opaque however low each
   one is, so the ceiling has to sit in the colours as well as the alpha. */
const mostAlpha = 0.42;
const brightestPetal = 46;
const brightestBlade = 34;

const stemCount = 46;
const petalCeiling = 90;

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

/* The meadow does not get brighter as it comes up, it gets colourful. Lightness
   is held where it is and the change is all in the colour: drained and all one
   cold hue when the music is dark, saturated and many hues when it is not. A
   background that answered by turning up its brightness would just be competing
   with the notes. */
const sadHue = 214;

/* How far a blade or a petal is allowed to wander from the sad hue, which is
   what turns one colour into many. */
function spreadHue(seed, life) {
  const own = seed * 360;
  let apart = own - sadHue;
  /* The short way round, so a hue near the wrap does not sweep the whole wheel
     on its way home. */
  if (apart > 180) { apart -= 360; }
  if (apart < -180) { apart += 360; }
  return Math.round((sadHue + apart * life + 360) % 360);
}

function meadowColour(life, shade, alpha) {
  const saturation = Math.round(lerp(6, 58, life));
  const light = Math.round(brightestBlade * (0.72 + shade * 0.28));
  return (
    "hsla(" + spreadHue(0.28 + shade * 0.12, life) + "," + saturation + "%," +
    light + "%," + alpha + ")"
  );
}

function petalColour(life, seed, alpha) {
  const saturation = Math.round(lerp(4, 78, life));
  const light = brightestPetal;
  return (
    "hsla(" + spreadHue(seed, life) + "," + saturation + "%," + light + "%," +
    alpha + ")"
  );
}

/* The air the meadow stands in. Without one the flowers hang in the black and
   the whole thing reads as a strip along the bottom rather than a field.
   It answers the same way the flowers do, in hue: the two dusks it mixes
   between are matched for how bright they look, so a meadow coming up changes
   colour without lifting the light off the notes in front of it. */
const skySource = shaderPrelude + [
  "void main() {",
  "  vec2 uv = gl_FragCoord.xy / size;",
  "  float up = uv.y;",
  "",
  /* Grey when the music is dark and warm when it is not, added rather than
     mixed toward: crossing from one hue to another passes through grey on the
     way, which would leave the sky least colourful exactly halfway up. The cold
     end of the meadow is carried by the flowers, which can hold a hue without
     the whole sky having to. */
  "  vec3 grey = vec3(0.070, 0.071, 0.073);",
  "  vec3 dusk = vec3(0.034, 0.021, -0.029);",
  "  vec3 air = grey + dusk * energy;",
  "",
  /* Slow banding so the gradient is weather rather than a ramp. */
  "  float weather = clouds(vec2(uv.x * 2.1 + time * 0.02, up * 1.4));",
  "  air += vec3(0.030, 0.026, 0.034) * weather * (0.35 + energy * 0.65);",
  "",
  /* Light gathered where the keys are, since that is where the meadow stands. */
  "  float horizon = pow(1.0 - up, 3.0);",
  "  vec3 glow = vec3(0.088, 0.086, 0.082) + vec3(0.110, 0.056, -0.024) * energy;",
  "  air += glow * horizon;",
  "",
  /* Which way the sound sits, spent on a tint rather than on brightness, and
     kept small enough that it cannot stand in for the meadow's own answer. */
  "  air *= mix(vec3(0.96, 0.99, 1.04), vec3(1.04, 1.00, 0.95), tone);",
  "",
  "  colour = vec4(air * gain, 1.0);",
  "}",
].join("\n");

background({
  name: "Flower",
  blurb:
    "A grey meadow that colours as the music turns major and fades back when it turns minor. Struck keys open flowers; the wind carries their petals off.",
  directions: ["up", "down"],
  shader: { source: skySource, gain: 1 },

  create() {
    /* The one thing this background accumulates. Everything drawn reads it. */
    let life = 0;
    let wind = 0;

    const stems = [];
    for (let i = 0; i < stemCount; i += 1) {
      stems.push({
        at: random(),
        height: 0.18 + random() * 0.5,
        lean: (random() - 0.5) * 0.5,
        sway: random() * Math.PI * 2,
        speed: 0.5 + random() * 0.8,
        shade: random(),
      });
    }

    const blooms = [];
    const petals = new Particles(petalCeiling);

    return {
      mood(frame, view) {
        const base = moodOf(frame, view);
        /* The shader is told how alive the meadow is rather than how busy the
           playing is, so the light behind it agrees with the flowers. */
        return { tone: base.tone, energy: life };
      },

      paint(ctx, view, frame) {
        const chord = frame.chord;
        const quality = chord === null ? "" : chord.quality;
        /* Silence is not sadness. With nothing sounding the meadow drifts to
           wherever the song's own key sits, so a bright piece does not go grey
           every time it takes a breath. */
        const resting =
          frame.key === null ? 0.2 : frame.key.mode === "major" ? 0.3 : 0.1;
        const target =
          quality === "major" || quality === "augmented"
            ? majorLife
            : quality === "minor" || quality === "diminished"
              ? minorLife
              : chord === null
                ? resting
                : colourfulLife;
        const rate = target > life ? opening : closing;
        life += (target - life) * Math.min(1, frame.step * rate);
        wind += frame.step * (0.3 + life * 0.5);

        const ground = view.keyboardTop;
        const reach = view.height * 0.42;

        /* The stems, drawn as one path per shade band so a full meadow is a
           handful of strokes rather than one per blade. */
        ctx.lineCap = "round";
        for (const stem of stems) {
          const x = stem.at * view.width;
          const tall = stem.height * reach * lerp(0.55, 1, life);
          const bend =
            Math.sin(wind * stem.speed + stem.sway) * (6 + life * 14) +
            stem.lean * 18;
          ctx.strokeStyle = meadowColour(life, stem.shade, mostAlpha * 0.7);
          ctx.lineWidth = 1 + stem.shade * 1.6;
          ctx.beginPath();
          ctx.moveTo(x, ground);
          ctx.quadraticCurveTo(x + bend * 0.4, ground - tall * 0.6, x + bend, ground - tall);
          ctx.stroke();

          /* A bud at the tip, opening only as the meadow comes up. */
          if (life > 0.25) {
            const open = (life - 0.25) / 0.75;
            ctx.fillStyle = petalColour(life, stem.at, mostAlpha * open * 0.8);
            ctx.beginPath();
            ctx.arc(x + bend, ground - tall, 1.5 + open * 3.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        /* A key struck opens a flower where it landed, and throws petals. */
        for (const strike of frame.strikes) {
          if (blooms.length >= 26) {
            blooms.shift();
          }
          blooms.push({
            x: strike.x,
            y: ground - reach * (0.2 + random() * 0.5),
            age: 0,
            size: 5 + strike.velocity * 10,
            seed: random(),
            petals: 5 + Math.floor(random() * 3),
          });
          const throwing = Math.round(1 + life * 3);
          for (let i = 0; i < throwing; i += 1) {
            petals.add({
              x: strike.x,
              y: ground - reach * 0.35,
              vx: (random() - 0.5) * 26 + wind * 2,
              vy: -12 - random() * 26,
              fade: 0.32,
              size: 2 + random() * 3,
              seed: random(),
            });
          }
        }

        for (let i = blooms.length - 1; i >= 0; i -= 1) {
          const bloom = blooms[i];
          bloom.age += frame.step;
          const open = Math.min(1, bloom.age * 2.2);
          const fading = Math.max(0, 1 - (bloom.age - 2.4) / 2.2);
          if (fading <= 0) {
            blooms.splice(i, 1);
            continue;
          }
          const alpha = mostAlpha * fading * (0.35 + life * 0.65);
          ctx.fillStyle = petalColour(life, bloom.seed, alpha);
          const spread = bloom.size * open;
          for (let petal = 0; petal < bloom.petals; petal += 1) {
            const around =
              (petal / bloom.petals) * Math.PI * 2 + bloom.seed * 6 + wind * 0.2;
            ctx.beginPath();
            ctx.ellipse(
              bloom.x + Math.cos(around) * spread,
              bloom.y + Math.sin(around) * spread * 0.7,
              spread * 0.62,
              spread * 0.36,
              around,
              0,
              Math.PI * 2,
            );
            ctx.fill();
          }
        }

        petals.sweep(
          frame.step,
          view,
          (petal, step) => {
            /* Caught by the same wind the stems lean in, so the whole meadow
               moves as one thing. */
            petal.vx += Math.sin(wind * 1.4 + petal.seed * 6) * 22 * step;
            petal.vy += 14 * step;
            drift(petal, step);
          },
          (petal) => {
            ctx.fillStyle = petalColour(
              life,
              petal.seed,
              mostAlpha * petal.life * 0.7,
            );
            ctx.beginPath();
            ctx.ellipse(
              petal.x,
              petal.y,
              petal.size,
              petal.size * 0.5,
              petal.seed * 6 + wind,
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
