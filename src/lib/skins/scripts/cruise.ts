/** Cruise, as a background script. Source rather than a module because it is
 * evaluated inside the worker, the same way one somebody wrote is. Planets is
 * used by no other background, so it is inlined here rather than made a
 * shared global. */
export const cruiseScript = String.raw`
/** Muted on purpose: a planet is scenery, and the notes have to stay the
 * brightest thing on screen. */
const palettes = [
  { low: [42, 32, 24], high: [176, 142, 100], air: "rgba(196,166,120,0.16)" },
  { low: [22, 36, 50], high: [128, 176, 202], air: "rgba(150,190,215,0.18)" },
  { low: [46, 24, 20], high: [184, 106, 72], air: "rgba(200,130,96,0.14)" },
  { low: [24, 36, 28], high: [124, 168, 130], air: "rgba(150,190,160,0.14)" },
  { low: [32, 26, 42], high: [140, 126, 182], air: "rgba(170,158,210,0.15)" },
];

/** The sun that lights every one of them, so a whole field agrees on where the
 * light is coming from. Normalised. */
const light = { x: -0.52, y: -0.58, z: 0.63 };
/** How much of the dark side still shows. Not zero: a planet cut to a hard
 * crescent reads as a logo. */
const ambient = 0.1;

function hash(x, y) {
  const mixed = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return mixed - Math.floor(mixed);
}

function noise(x, y) {
  const gridX = Math.floor(x);
  const gridY = Math.floor(y);
  const fx = x - gridX;
  const fy = y - gridY;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(gridX, gridY);
  const b = hash(gridX + 1, gridY);
  const c = hash(gridX, gridY + 1);
  const d = hash(gridX + 1, gridY + 1);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

function clouds(x, y) {
  let sum = 0;
  let amp = 0.5;
  let scale = 1;
  for (let octave = 0; octave < 4; octave += 1) {
    sum += noise(x * scale, y * scale) * amp;
    scale *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

/** Shaded per pixel off the sphere's own normal, which is what separates a
 * planet from a circle with a gradient in it: the terminator curves, the limb
 * darkens, and the surface wraps rather than sliding. */
function renderPlanet(size, banded) {
  const sprite = new OffscreenCanvas(size, size);
  const ctx = sprite.getContext("2d");
  if (ctx === null) {
    return null;
  }
  const palette = palettes[Math.floor(random() * palettes.length)];
  if (palette === undefined) {
    return null;
  }

  const middle = size / 2;
  // A ringed world gives most of its sprite over to the rings, so the body sits
  // smaller inside the same square.
  const ringed = random() < 0.38;
  const radius = size * (ringed ? 0.25 : 0.42);
  const ringInner = radius * 1.35;
  const ringOuter = radius * 2.0;
  const tilt = 0.16 + random() * 0.24;
  const seed = random() * 90;
  const bandCount = 5 + random() * 7;
  const image = ctx.createImageData(size, size);
  const pixels = image.data;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const nx = (px + 0.5 - middle) / radius;
      const ny = (py + 0.5 - middle) / radius;
      const flat = nx * nx + ny * ny;
      if (flat > 1) {
        continue;
      }
      const nz = Math.sqrt(1 - flat);
      const lit = Math.max(0, nx * light.x + ny * light.y + nz * light.z);

      // Longitude and latitude off the normal, so the pattern wraps around the
      // body and crowds toward the limb the way a real surface does.
      const lon = Math.atan2(nx, nz);
      const lat = Math.asin(Math.max(-1, Math.min(1, ny)));
      // Bands wander rather than ringing the body evenly, which is the whole
      // difference between a gas giant and a striped ball.
      const face = banded
        ? 0.5 +
          0.5 *
            Math.sin(
              lat * bandCount +
                (clouds(lon * 1.5 + seed, lat * 2.2 + seed) - 0.5) * 4.2,
            )
        : clouds(lon * 2.6 + seed, lat * 2.6 + seed);
      // Stretched over the palette, so the surface has contrast of its own
      // without the whole body being brighter.
      const spread = Math.min(1, Math.max(0, (face - 0.32) * 2.1));
      const grain = 0.88 + 0.24 * noise(lon * 13 + seed, lat * 13);
      const tone = Math.min(1, spread * grain);

      // Darker toward the limb, which is what makes it read as a ball.
      const edge = 0.5 + 0.5 * nz;
      const shade = (ambient + lit ** 0.85 * 0.95) * edge;
      const at = (py * size + px) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const low = palette.low[channel] ?? 0;
        const high = palette.high[channel] ?? 0;
        pixels[at + channel] = (low + (high - low) * tone) * shade;
      }
      // Softened right at the rim, so the disc has no stair edge.
      pixels[at + 3] = 255 * Math.min(1, (1 - Math.sqrt(flat)) * radius * 0.8);
    }
  }
  // The far side of the rings goes down first, so the body sits in front of it
  // and the near side is laid over the top afterwards.
  if (ringed) {
    drawRings(ctx, middle, ringInner, ringOuter, tilt, palette, Math.PI, 0);
  }
  // Composited rather than assigned, so the rings already down are kept.
  const body = new OffscreenCanvas(size, size);
  const bodyCtx = body.getContext("2d");
  if (bodyCtx === null) {
    return null;
  }
  bodyCtx.putImageData(image, 0, 0);
  ctx.drawImage(body, 0, 0);

  // A thin skin of air, brightest where the light grazes it.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const air = ctx.createRadialGradient(
    middle + light.x * radius * 0.35,
    middle + light.y * radius * 0.35,
    radius * 0.72,
    middle,
    middle,
    radius * 1.06,
  );
  air.addColorStop(0, "rgba(0,0,0,0)");
  air.addColorStop(0.86, palette.air);
  air.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = air;
  ctx.beginPath();
  ctx.arc(middle, middle, radius * 1.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (ringed) {
    drawRings(ctx, middle, ringInner, ringOuter, tilt, palette, 0, Math.PI);
  }

  return sprite;
}

/** Half a ring system, as a stack of thin bands with gaps cut through them.
 * Drawn twice per world, once behind the body and once in front, so the body
 * sits inside the rings the way it does from anywhere but edge on. */
function drawRings(ctx, middle, inner, outer, tilt, palette, from, to) {
  const bands = 26;
  ctx.save();
  for (let band = 0; band < bands; band += 1) {
    const along = band / bands;
    const reach = inner + (outer - inner) * along;
    // Gaps and thin patches, so it reads as a ring system and not a disc.
    const density =
      (0.35 + 0.65 * noise(along * 9, 4.2)) *
      (noise(along * 21, 8.7) > 0.28 ? 1 : 0.15);
    const lit = palette.high;
    ctx.globalAlpha = 0.5 * density;
    ctx.strokeStyle = "rgb(" + lit[0] + "," + lit[1] + "," + lit[2] + ")";
    ctx.lineWidth = ((outer - inner) / bands) * 1.4;
    ctx.beginPath();
    ctx.ellipse(middle, middle, reach, reach * tilt, 0, from, to);
    ctx.stroke();
  }
  ctx.restore();
}

/** How often one comes past, in worlds a second. Far rarer than the rocks: a
 * planet is an event, not weather. */
const planetRate = 0.024;
const spriteSize = 168;

class Planets {
  constructor() {
    this.live = null;
  }

  /** Drawn before everything else in the scene, since it is the furthest thing
   * out there and nothing in front of it should be dimmed by it. */
  paint(ctx, view, away, step) {
    if (this.live === null && random() < planetRate * step) {
      const sprite = renderPlanet(spriteSize, random() < 0.5);
      if (sprite !== null) {
        // Off the line of travel, so it drifts out of the distance rather than
        // swelling in the middle of the screen.
        const around = random() * Math.PI * 2;
        const out = 0.22 + random() * 0.5;
        this.live = {
          sprite,
          x: Math.cos(around) * out,
          y: Math.sin(around) * out,
          z: 1,
          reach: 5 + random() * 5,
          approach: 0.012 + random() * 0.012,
        };
      }
    }

    const planet = this.live;
    if (planet === null) {
      return;
    }
    planet.z -= planet.approach * step;
    const radius = planet.reach / planet.z;
    const x = away.x + (planet.x / planet.z) * away.reach * 0.5;
    const y = away.y + (planet.y / planet.z) * away.reach * 0.5;
    // Gone once it has passed the keys or swung out of the view entirely.
    if (
      planet.z <= 0.05 ||
      y - radius > view.keyboardTop ||
      x + radius < 0 ||
      x - radius > view.width
    ) {
      this.live = null;
      return;
    }
    // Held back a touch, so it never competes with the notes crossing it.
    ctx.globalAlpha = 0.72;
    ctx.drawImage(
      planet.sprite,
      x - radius,
      y - radius,
      radius * 2,
      radius * 2,
    );
    ctx.globalAlpha = 1;
  }
}

/** Dimmer than the still field, because streaking stars are already carrying
 * the eye and the notes still have to win. */
const nebulaGain = 0.5;

/** Stars are held in a space with depth and projected, so they spread out of
 * the point being travelled toward and streak more the nearer they come. A
 * column of falling lines reads as rain; this reads as motion. */
const starCount = 200;
/** How fast depth is eaten. The whole field crosses in a few seconds. */
const approach = 0.55;
const nearest = 0.06;

/** Real starlight is not white. A few warm and blue ones stop the field looking
 * like static. */
const starColours = [
  "#ffffff",
  "#dce8ff",
  "#bcd4ff",
  "#ffe9c8",
  "#ffd3a8",
];

function place(star, fresh) {
  star.x = (random() - 0.5) * 2.4;
  star.y = (random() - 0.5) * 2.4;
  star.z = fresh ? random() : 1;
  star.color = starColours[Math.floor(random() * starColours.length)] ?? "#ffffff";
  star.twinkle = random() * Math.PI * 2;
}

function seed() {
  const stars = [];
  for (let count = 0; count < starCount; count += 1) {
    const star = { x: 0, y: 0, z: 1, color: "#ffffff", twinkle: 0 };
    place(star, true);
    stars.push(star);
  }
  return stars;
}

/** Travelling toward the top of the roll, so the field spreads out of a point
 * above it and pours down past the keys. */
function vanishing(view) {
  return {
    x: view.width / 2,
    y: -view.height * 0.25,
    reach: Math.max(view.width, view.height),
  };
}

background({
  name: "Cruising",
  blurb:
    "The keys fly through space. Stars streak past, a world drifts by now and then, and the rocks your notes reach break apart.",
  directions: ["up"],
  shader: { source: nebulaSource(0.06), gain: nebulaGain },

  create() {
    const stars = seed();
    const planets = new Planets();
    const field = new RockField({
      max: 9,
      rate: 1.2,
      smallest: 13,
      largest: 30,
    });

    return {
      paint(ctx, view, frame) {
        const away = vanishing(view);
        // Furthest thing out there, so everything else is drawn over it.
        planets.paint(ctx, view, away, frame.step);

        for (const star of stars) {
          const was = star.z;
          star.z -= approach * frame.step;
          if (star.z <= nearest) {
            place(star, false);
            continue;
          }
          const x = away.x + (star.x / star.z) * away.reach * 0.5;
          const y = away.y + (star.y / star.z) * away.reach * 0.5;
          if (y > view.keyboardTop + 40 || x < -60 || x > view.width + 60) {
            continue;
          }
          const wasX = away.x + (star.x / was) * away.reach * 0.5;
          const wasY = away.y + (star.y / was) * away.reach * 0.5;
          const closeness = 1 - star.z;
          const shine =
            (0.25 + closeness * 0.75) *
            (0.75 + 0.25 * Math.sin(frame.elapsed * 3 + star.twinkle));

          ctx.globalAlpha = Math.min(1, shine);
          ctx.strokeStyle = star.color;
          ctx.lineWidth = 0.5 + closeness * 2.1;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(wasX, wasY);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.lineCap = "butt";

        field.paint(ctx, view.width, view.height, frame.step, frame);
      },
    };
  },
});
`;
