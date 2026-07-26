import type {
  Skin,
  SkinFrame,
  SkinInstance,
  SkinSurface,
} from "@/lib/skins/types";

/** Kept well under the roll's own brightness, so a note always reads against
 * it. The skin sits behind the notes, and this keeps it behind them in tone. */
const nebulaGain = 0.66;

const vertex = `#version 300 es
in vec2 place;
void main() { gl_Position = vec4(place, 0.0, 1.0); }`;

/** Two drifting layers of value noise stand in for gas, with a starfield hashed
 * from the pixel so it costs nothing to keep. Everything is scaled down at the
 * end: the roll is read against this, so it can never compete. */
const fragment = `#version 300 es
precision highp float;
out vec4 colour;
uniform vec2 size;
uniform float time;
uniform float gain;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

float clouds(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += noise(p) * amp;
    p *= 2.02;
    amp *= 0.5;
  }
  return sum;
}

void main() {
  vec2 uv = gl_FragCoord.xy / size;
  vec2 p = uv * vec2(size.x / size.y, 1.0);

  float drift = time * 0.015;
  float a = clouds(p * 2.4 + vec2(drift, drift * 0.4));
  float b = clouds(p * 3.7 - vec2(drift * 0.7, drift * 0.2));

  vec3 deep = vec3(0.015, 0.02, 0.05);
  vec3 violet = vec3(0.34, 0.13, 0.60);
  vec3 teal = vec3(0.05, 0.34, 0.42);
  vec3 rose = vec3(0.42, 0.12, 0.28);
  vec3 sky = deep
    + violet * pow(a, 1.7) * 0.72
    + teal * pow(b, 2.1) * 0.55
    + rose * pow(a * b, 2.6) * 0.75;

  // Stars are a sparse hash, twinkling on their own phase so the field never
  // pulses as one.
  vec2 cell = floor(gl_FragCoord.xy / 3.0);
  float star = hash(cell);
  if (star > 0.9955) {
    float twinkle = 0.6 + 0.4 * sin(time * 2.0 + star * 90.0);
    sky += vec3(0.9, 0.95, 1.0) * (star - 0.9955) * 300.0 * twinkle;
  }

  colour = vec4(sky * gain, 1.0);
}`;

type Rock = {
  x: number;
  y: number;
  drift: number;
  fall: number;
  spin: number;
  angle: number;
  radius: number;
  hit: number;
};

type Shard = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
};

const maxRocks = 14;
const maxShards = 260;

function compile(
  gl: WebGL2RenderingContext,
  kind: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(kind);
  if (shader === null) {
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** The gas and stars are a shader on one quad; the rocks are drawn over it on a
 * 2D layer, because they are a handful of shapes that have to answer to where
 * the notes are and that is not worth a second pipeline. */
function createStarfield({ base, overlay }: SkinSurface): SkinInstance | null {
  const gl = base.getContext("webgl2", {
    alpha: false,
    antialias: false,
    powerPreference: "low-power",
  });
  if (gl === null) {
    return null;
  }
  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  if (program === null || vs === null || fs === null) {
    return null;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    return null;
  }
  // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is a WebGL call, not a React hook
  gl.useProgram(program);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  const place = gl.getAttribLocation(program, "place");
  gl.enableVertexAttribArray(place);
  gl.vertexAttribPointer(place, 2, gl.FLOAT, false, 0, 0);

  const sizeAt = gl.getUniformLocation(program, "size");
  const timeAt = gl.getUniformLocation(program, "time");
  const gainAt = gl.getUniformLocation(program, "gain");

  const rocksCtx = overlay.getContext("2d");

  const rocks: Rock[] = [];
  const shards: Shard[] = [];
  let width = 0;
  let height = 0;
  let ratio = 1;

  function spawnRock(): void {
    if (rocks.length >= maxRocks || width === 0) {
      return;
    }
    rocks.push({
      x: Math.random() * width,
      y: -30 - Math.random() * 90,
      drift: (Math.random() - 0.5) * 0.4,
      fall: 0.9 + Math.random() * 1.1,
      spin: (Math.random() - 0.5) * 0.02,
      angle: Math.random() * Math.PI * 2,
      radius: 11 + Math.random() * 17,
      hit: 0,
    });
  }

  function burst(rock: Rock, color: string): void {
    for (let index = 0; index < 14 && shards.length < maxShards; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.6 + Math.random() * 2.4;
      shards.push({
        x: rock.x,
        y: rock.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.4,
        life: 1,
        color: Math.random() < 0.45 ? color : "#c9b9a4",
      });
    }
  }

  return {
    resize(nextWidth, nextHeight, nextRatio) {
      width = nextWidth;
      height = nextHeight;
      ratio = nextRatio;
      base.width = Math.round(nextWidth * nextRatio);
      base.height = Math.round(nextHeight * nextRatio);
      overlay.width = base.width;
      overlay.height = base.height;
      gl.viewport(0, 0, base.width, base.height);
    },

    draw(frame: SkinFrame) {
      // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is a WebGL call, not a React hook
      gl.useProgram(program);
      gl.uniform2f(sizeAt, base.width, base.height);
      gl.uniform1f(timeAt, frame.elapsed);
      gl.uniform1f(gainAt, nebulaGain);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (rocksCtx === null) {
        return;
      }
      rocksCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
      rocksCtx.clearRect(0, 0, width, height);

      if (Math.random() < 0.045) {
        spawnRock();
      }

      // A note head reaching a rock breaks it. The notes are never touched:
      // the rock is what gives way.
      for (let index = rocks.length - 1; index >= 0; index -= 1) {
        const rock = rocks[index];
        if (rock === undefined) {
          continue;
        }
        rock.y += rock.fall;
        rock.x += rock.drift;
        rock.angle += rock.spin;
        if (rock.hit > 0) {
          rock.hit -= 0.08;
        }
        if (rock.y - rock.radius > frame.keyboardTop) {
          rocks.splice(index, 1);
          continue;
        }
        const struck = frame.travellers.find(
          (traveller) =>
            Math.abs(traveller.x - rock.x) < rock.radius + traveller.radius &&
            Math.abs(traveller.y - rock.y) < rock.radius + traveller.radius,
        );
        if (struck !== undefined) {
          burst(rock, struck.color);
          rocks.splice(index, 1);
          continue;
        }
        rocksCtx.save();
        rocksCtx.translate(rock.x, rock.y);
        rocksCtx.rotate(rock.angle);
        rocksCtx.beginPath();
        for (let point = 0; point < 7; point += 1) {
          const around = (point / 7) * Math.PI * 2;
          const reach = rock.radius * (0.72 + ((point * 37) % 11) / 34);
          rocksCtx.lineTo(Math.cos(around) * reach, Math.sin(around) * reach);
        }
        rocksCtx.closePath();
        rocksCtx.fillStyle = "#241f1b";
        rocksCtx.fill();
        rocksCtx.strokeStyle = rock.hit > 0 ? "#8d7f6b" : "#4a4038";
        rocksCtx.lineWidth = 1.4;
        rocksCtx.stroke();
        rocksCtx.restore();
      }

      for (let index = shards.length - 1; index >= 0; index -= 1) {
        const shard = shards[index];
        if (shard === undefined) {
          continue;
        }
        shard.x += shard.vx;
        shard.y += shard.vy;
        shard.vy += 0.04;
        shard.life -= 0.02;
        if (shard.life <= 0) {
          shards.splice(index, 1);
          continue;
        }
        rocksCtx.globalAlpha = Math.max(0, shard.life) * 0.85;
        rocksCtx.fillStyle = shard.color;
        rocksCtx.fillRect(shard.x, shard.y, 2.2, 2.2);
      }
      rocksCtx.globalAlpha = 1;
    },

    dispose() {
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(quad);
    },
  };
}

export const starfield: Skin = {
  id: "starfield",
  name: "Deep space",
  blurb:
    "Drifting gas and stars. In free roam the notes you play break the asteroids they reach.",
  // The rocks are flown into, so they only read while notes leave the keys.
  directions: ["up"],
  create: createStarfield,
};
