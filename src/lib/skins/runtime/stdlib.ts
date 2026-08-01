/** Globals a background script runs against inside the render worker. Scripts
 * cannot `import`, so this is the same particle pool, rock field, mood
 * function and shader source that the bundled skins use, ported to plain JS
 * and installed on `self`. `Math.random()` is replaced by the runtime's seeded
 * `random()` everywhere it appears, so a render is reproducible. */
export const stdlibSource = String.raw`
class Particles {
  constructor(ceiling) {
    this.pool = [];
    this.ceiling = ceiling;
  }

  get count() {
    return this.pool.length;
  }

  add(spark) {
    if (this.pool.length >= this.ceiling) {
      return;
    }
    this.pool.push({ ...spark, life: spark.life ?? 1 });
  }

  sweep(step, view, move, draw) {
    const edge = Math.max(view.width, view.height) * 0.25;
    for (let index = this.pool.length - 1; index >= 0; index -= 1) {
      const particle = this.pool[index];
      if (particle === undefined) {
        continue;
      }
      move(particle, step);
      particle.life -= particle.fade * step;
      if (
        particle.life <= 0 ||
        particle.y < -edge ||
        particle.y > view.height + edge ||
        particle.x < -edge ||
        particle.x > view.width + edge
      ) {
        const last = this.pool.pop();
        if (last !== undefined && index < this.pool.length) {
          this.pool[index] = last;
        }
        continue;
      }
      draw(particle);
    }
  }
}
self.Particles = Particles;

function drift(particle, step) {
  particle.x += particle.vx * step;
  particle.y += particle.vy * step;
}
self.drift = drift;

const rockShades = ["#3d4045", "#2b2d31", "#4d5157", "#212326"];

const corners = 11;
const maxChunks = 320;
const maxFlashes = 12;
const maxDust = 90;

function makeRock(x, y, radius) {
  const shape = [];
  for (let corner = 0; corner < corners; corner += 1) {
    shape.push(0.62 + random() * 0.45);
  }
  const craters = [];
  for (let count = 0; count < 3; count += 1) {
    const around = random() * Math.PI * 2;
    const out = random() * radius * 0.45;
    craters.push({
      x: Math.cos(around) * out,
      y: Math.sin(around) * out,
      r: radius * (0.11 + random() * 0.16),
    });
  }
  return {
    x,
    y,
    drift: (random() - 0.5) * 30,
    fall: 60 + random() * 70,
    spin: (random() - 0.5) * 1.4,
    angle: random() * Math.PI * 2,
    radius,
    shape,
    craters,
  };
}

function struckBy(rock, travellers) {
  if (rock.y + rock.radius < 0) {
    return null;
  }
  return (
    travellers.find(
      (traveller) =>
        Math.abs(traveller.x - rock.x) < rock.radius + traveller.radius &&
        Math.abs(traveller.y - rock.y) < rock.radius + traveller.radius,
    ) ?? null
  );
}

function traceRock(ctx, rock, scale) {
  ctx.beginPath();
  rock.shape.forEach((reach, corner) => {
    const around = (corner / rock.shape.length) * Math.PI * 2;
    const out = rock.radius * reach * scale;
    ctx.lineTo(Math.cos(around) * out, Math.sin(around) * out);
  });
  ctx.closePath();
}

function drawRock(ctx, rock) {
  ctx.save();
  ctx.translate(rock.x, rock.y);
  ctx.rotate(rock.angle);

  const body = ctx.createLinearGradient(
    -rock.radius,
    -rock.radius,
    rock.radius,
    rock.radius,
  );
  body.addColorStop(0, "#43474d");
  body.addColorStop(0.45, "#292b30");
  body.addColorStop(1, "#131417");
  traceRock(ctx, rock, 1);
  ctx.fillStyle = body;
  ctx.fill();

  for (const crater of rock.craters) {
    ctx.beginPath();
    ctx.ellipse(
      crater.x,
      crater.y,
      crater.r,
      crater.r * 0.78,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = "#1b1d21";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(
      crater.x - crater.r * 0.2,
      crater.y - crater.r * 0.2,
      crater.r * 0.7,
      crater.r * 0.55,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = "#26292e";
    ctx.fill();
  }

  // Barely there, so the rock reads as a dense body rather than an outline.
  ctx.save();
  traceRock(ctx, rock, 1);
  ctx.clip();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = "#565b62";
  ctx.lineWidth = 1.6;
  traceRock(ctx, rock, 0.985);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();

  ctx.restore();
}

class Rubble {
  constructor() {
    this.chunks = [];
    this.flashes = [];
    this.dust = [];
  }

  burst(x, y, radius, color) {
    if (this.flashes.length < maxFlashes) {
      this.flashes.push({ x, y, life: 1, reach: radius * 1.6, color });
    }
    for (let puff = 0; puff < 4 && this.dust.length < maxDust; puff += 1) {
      const around = random() * Math.PI * 2;
      const out = random() * radius * 0.7;
      this.dust.push({
        x: x + Math.cos(around) * out,
        y: y + Math.sin(around) * out,
        life: 1,
        reach: radius * (1.1 + random()),
      });
    }
    const pieces = 16 + Math.floor(random() * 10);
    for (let index = 0; index < pieces; index += 1) {
      if (this.chunks.length >= maxChunks) {
        break;
      }
      const around = random() * Math.PI * 2;
      const speed = 0.8 + random() * 3.4;
      this.chunks.push({
        x,
        y,
        vx: Math.cos(around) * speed,
        vy: Math.sin(around) * speed,
        spin: (random() - 0.5) * 0.3,
        angle: random() * Math.PI * 2,
        size: radius * (0.08 + random() * 0.24),
        life: 1,
        fade: 0.014 + random() * 0.016,
        color:
          rockShades[Math.floor(random() * rockShades.length)] ??
          "#2b2d31",
      });
    }
  }

  static drop(pool, index) {
    const last = pool.pop();
    if (last !== undefined && index < pool.length) {
      pool[index] = last;
    }
  }

  paint(ctx, width, height) {
    // The dust sits under everything, so the bright parts read against it.
    for (let index = this.dust.length - 1; index >= 0; index -= 1) {
      const puff = this.dust[index];
      if (puff === undefined) {
        continue;
      }
      puff.life -= 0.011;
      if (puff.life <= 0) {
        Rubble.drop(this.dust, index);
        continue;
      }
      const spread = puff.reach * (1.6 - puff.life);
      const cloud = ctx.createRadialGradient(
        puff.x,
        puff.y,
        0,
        puff.x,
        puff.y,
        Math.max(1, spread),
      );
      cloud.addColorStop(0, "rgba(120,126,134,0.5)");
      cloud.addColorStop(1, "rgba(38,40,44,0)");
      ctx.globalAlpha = puff.life * 0.7;
      ctx.fillStyle = cloud;
      ctx.beginPath();
      ctx.arc(puff.x, puff.y, Math.max(1, spread), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let index = this.flashes.length - 1; index >= 0; index -= 1) {
      const flash = this.flashes[index];
      if (flash === undefined) {
        continue;
      }
      flash.life -= 0.055;
      if (flash.life <= 0) {
        Rubble.drop(this.flashes, index);
        continue;
      }
      // A short dull bloom in the note's colour, gone almost at once, so the
      // hit is felt without a flash competing with the roll.
      const grown = flash.reach * (1 - flash.life);
      const halo = ctx.createRadialGradient(
        flash.x,
        flash.y,
        0,
        flash.x,
        flash.y,
        Math.max(1, grown),
      );
      halo.addColorStop(0, flash.color);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = flash.life * flash.life * 0.22;
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(flash.x, flash.y, Math.max(1, grown), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    for (let index = this.chunks.length - 1; index >= 0; index -= 1) {
      const chunk = this.chunks[index];
      if (chunk === undefined) {
        continue;
      }
      chunk.x += chunk.vx;
      chunk.y += chunk.vy;
      chunk.vy += 0.05;
      chunk.vx *= 0.995;
      chunk.angle += chunk.spin;
      chunk.life -= chunk.fade;
      if (
        chunk.life <= 0 ||
        chunk.y - chunk.size > height ||
        chunk.x + chunk.size < 0 ||
        chunk.x - chunk.size > width
      ) {
        Rubble.drop(this.chunks, index);
        continue;
      }
      ctx.save();
      ctx.translate(chunk.x, chunk.y);
      ctx.rotate(chunk.angle);
      ctx.globalAlpha = Math.min(1, chunk.life * 1.2);
      ctx.fillStyle = chunk.color;
      ctx.beginPath();
      ctx.moveTo(-chunk.size, chunk.size * 0.6);
      ctx.lineTo(0, -chunk.size);
      ctx.lineTo(chunk.size, chunk.size * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}

const splitAbove = 16;
const smallestPiece = 6;
const pieceRoom = 8;

class RockField {
  constructor(options) {
    this.rocks = [];
    this.rubble = new Rubble();
    this.options = options;
  }

  paint(ctx, width, height, step, frame) {
    const { max, rate, smallest, largest } = this.options;
    if (this.rocks.length < max && random() < rate * step) {
      this.rocks.push(
        makeRock(
          random() * width,
          -40,
          smallest + random() * (largest - smallest),
        ),
      );
    }

    for (let index = this.rocks.length - 1; index >= 0; index -= 1) {
      const rock = this.rocks[index];
      if (rock === undefined) {
        continue;
      }
      rock.y += rock.fall * step;
      rock.x += rock.drift * step;
      rock.angle += rock.spin * step;
      // Pieces are thrown in every direction, so leaving by any edge counts.
      if (
        rock.y - rock.radius > frame.keyboardTop ||
        rock.y + rock.radius < -400 ||
        rock.x + rock.radius < -200 ||
        rock.x - rock.radius > width + 200
      ) {
        this.rocks.splice(index, 1);
        continue;
      }
      const struck = struckBy(rock, frame.notes);
      if (struck !== null) {
        this.rubble.burst(rock.x, rock.y, rock.radius, struck.color);
        this.rocks.splice(index, 1);
        this.split(rock);
        continue;
      }
      drawRock(ctx, rock);
    }

    this.rubble.paint(ctx, width, height);
  }

  split(rock) {
    if (rock.radius < splitAbove) {
      return;
    }
    const pieces = 2 + Math.floor(random() * 2);
    for (let index = 0; index < pieces; index += 1) {
      if (this.rocks.length >= this.options.max + pieceRoom) {
        return;
      }
      const around = (index / pieces) * Math.PI * 2 + random();
      const piece = makeRock(
        rock.x,
        rock.y,
        Math.max(smallestPiece, rock.radius / (pieces * 0.7)),
      );
      piece.drift = rock.drift + Math.cos(around) * 110;
      // Kept falling, so a piece thrown upward still comes back down the roll
      // rather than hanging above it.
      piece.fall = Math.max(25, rock.fall * 0.75 + Math.sin(around) * 80);
      piece.spin = (random() - 0.5) * 3.4;
      this.rocks.push(piece);
    }
  }
}
self.RockField = RockField;

const still = { tone: 0.5, energy: 0 };

function moodOf(frame, view) {
  const marks = frame.notes.length > 0 ? frame.notes : frame.strikes;
  if (marks.length === 0 || view.width === 0) {
    return still;
  }
  let across = 0;
  for (const mark of marks) {
    across += mark.x;
  }
  return {
    tone: Math.min(1, Math.max(0, across / marks.length / view.width)),
    energy: Math.min(1, marks.length / 6),
  };
}
self.moodOf = moodOf;

const shaderPrelude = [
  "#version 300 es",
  "precision highp float;",
  "out vec4 colour;",
  "uniform vec2 size;",
  "uniform float time;",
  "uniform float gain;",
  "uniform float tone;",
  "uniform float energy;",
  "",
  "/* No sine: sin(dot(p, big)) loses its precision once the coordinates are a few",
  "   hundred pixels out, which degenerates into diagonal banding and leaves one",
  "   side of the screen bare. This mixes the bits instead, so it holds up across a",
  "   whole canvas. */",
  "float hash(vec2 p) {",
  "  vec3 mixed = fract(vec3(p.xyx) * 0.1031);",
  "  mixed += dot(mixed, mixed.yzx + 33.33);",
  "  return fract((mixed.x + mixed.y) * mixed.z);",
  "}",
  "",
  "float noise(vec2 p) {",
  "  vec2 i = floor(p);",
  "  vec2 f = fract(p);",
  "  vec2 u = f * f * (3.0 - 2.0 * f);",
  "  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),",
  "             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);",
  "}",
  "",
  "float clouds(vec2 p) {",
  "  float sum = 0.0;",
  "  float amp = 0.5;",
  "  for (int i = 0; i < 5; i++) {",
  "    sum += noise(p) * amp;",
  "    p *= 2.02;",
  "    amp *= 0.5;",
  "  }",
  "  return sum;",
  "}",
  "",
  "/* Stars on a grid of cells, one per cell, placed and sized by the cell's own",
  "   hash, so the field is dense without any of them being sampled twice. The cut",
  "   decides how many cells hold one, the twinkle how much they breathe. */",
  "float stars(vec2 pixel, float cell, float cut, float twinkle) {",
  "  vec2 grid = floor(pixel / cell);",
  "  vec2 within = fract(pixel / cell);",
  "  float pick = hash(grid);",
  "  if (pick < cut) {",
  "    return 0.0;",
  "  }",
  "  // Placed anywhere in its cell, so the grid the field is built on never shows.",
  "  vec2 at = vec2(hash(grid + 1.7), hash(grid + 4.3));",
  "  float bright = (pick - cut) / (1.0 - cut);",
  "  // Mostly faint with a few standing out, which is what a real field looks like.",
  "  float weight = pow(bright, 2.2);",
  "  float near = 1.0 - smoothstep(0.0, 0.055 + weight * 0.10, length(within - at));",
  "  float breathe = 1.0 - twinkle + twinkle * sin(time * 1.4 + pick * 40.0);",
  "  return near * weight * breathe;",
  "}",
  "",
].join("\n");
self.shaderPrelude = shaderPrelude;

function nebulaSource(drift) {
  return (
    shaderPrelude +
    "\n" +
    [
      "void main() {",
      "  vec2 uv = gl_FragCoord.xy / size;",
      "  vec2 p = uv * vec2(size.x / size.y, 1.0);",
      "",
      "  float drift = time * " + drift.toFixed(3) + ";",
      "  float a = clouds(p * 2.4 + vec2(drift * 0.3, drift));",
      "  float b = clouds(p * 3.7 - vec2(drift * 0.2, drift * 0.7));",
      "",
      "  vec3 deep = vec3(0.015, 0.02, 0.05);",
      "  vec3 violet = vec3(0.34, 0.13, 0.60);",
      "  vec3 teal = vec3(0.05, 0.34, 0.42);",
      "  vec3 rose = vec3(0.42, 0.12, 0.28);",
      "  vec3 sky = deep",
      "    + violet * pow(a, 1.7) * 0.72",
      "    + teal * pow(b, 2.1) * 0.55",
      "    + rose * pow(a * b, 2.6) * 0.75;",
      "",
      "  // Three layers at different densities, so the field has depth rather than",
      "  // reading as one sheet of dots. The gas thins them where it is thickest.",
      "  float behind = 1.0 - clamp(a * 0.55, 0.0, 0.6);",
      "  float field = stars(gl_FragCoord.xy, 34.0, 0.86, 0.35) * 0.85",
      "              + stars(gl_FragCoord.xy, 19.0, 0.90, 0.5) * 0.5",
      "              + stars(gl_FragCoord.xy, 11.0, 0.94, 0.6) * 0.3;",
      "  sky += vec3(0.85, 0.90, 1.0) * field * behind;",
      "",
      "  colour = vec4(sky * gain, 1.0);",
      "}",
    ].join("\n")
  );
}
self.nebulaSource = nebulaSource;
`;
