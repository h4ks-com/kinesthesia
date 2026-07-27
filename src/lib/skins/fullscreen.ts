/** One triangle covering the viewport, which is the whole of the geometry any
 * of these backgrounds needs. Each supplies its own fragment source; the
 * compiling, linking and buffer setup are the same every time. */
/** One context per canvas, for the life of that canvas. Asking twice returns
 * the same one, because a skin is torn down and rebuilt on the very same canvas
 * whenever React re-runs the effect that owns it, and a canvas only ever hands
 * out one context anyway. Losing it instead would poison the canvas: every
 * later request returns the dead one. */
const contexts = new WeakMap<HTMLCanvasElement, WebGL2RenderingContext>();

export function shaderContext(
  canvas: HTMLCanvasElement,
): WebGL2RenderingContext | null {
  const known = contexts.get(canvas);
  if (known !== undefined) {
    return known;
  }
  const made = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    powerPreference: "low-power",
  });
  if (made !== null) {
    contexts.set(canvas, made);
  }
  return made;
}

export type ShaderInputs = {
  readonly time: number;
  readonly gain: number;
  /** Where the sound sits across the keyboard, 0 low and 1 high. */
  readonly tone: number;
  /** How much is sounding, 0 to 1. */
  readonly energy: number;
};

export type Fullscreen = {
  draw(size: readonly [number, number], inputs: ShaderInputs): void;
  dispose(): void;
};

const vertex = `#version 300 es
in vec2 place;
void main() { gl_Position = vec4(place, 0.0, 1.0); }`;

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
    // A background that silently fails to appear is indistinguishable from one
    // the device cannot run, so say which it was.
    console.error("skin shader failed to compile", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** Null where the shader will not build, which is the same answer a device
 * without WebGL gives, so a skin can hand it straight back. */
export function createFullscreen(
  gl: WebGL2RenderingContext,
  fragmentSource: string,
): Fullscreen | null {
  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
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

  // A shader that does not declare one gets null here, and setting a null
  // uniform is a no-op, so every shader takes the same inputs and uses what it
  // needs.
  const sizeAt = gl.getUniformLocation(program, "size");
  const timeAt = gl.getUniformLocation(program, "time");
  const gainAt = gl.getUniformLocation(program, "gain");
  const toneAt = gl.getUniformLocation(program, "tone");
  const energyAt = gl.getUniformLocation(program, "energy");

  return {
    draw([width, height], inputs) {
      // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is a WebGL call, not a React hook
      gl.useProgram(program);
      gl.uniform2f(sizeAt, width, height);
      gl.uniform1f(timeAt, inputs.time);
      gl.uniform1f(gainAt, inputs.gain);
      gl.uniform1f(toneAt, inputs.tone);
      gl.uniform1f(energyAt, inputs.energy);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(quad);
    },
  };
}

/** What every one of these shaders is built out of: the uniforms the host sets
 * and value noise to shape them with. Prepended so a new background is only its
 * own `void main`. */
export const shaderPrelude = `#version 300 es
precision highp float;
out vec4 colour;
uniform vec2 size;
uniform float time;
uniform float gain;
uniform float tone;
uniform float energy;

/* No sine: sin(dot(p, big)) loses its precision once the coordinates are a few
   hundred pixels out, which degenerates into diagonal banding and leaves one
   side of the screen bare. This mixes the bits instead, so it holds up across a
   whole canvas. */
float hash(vec2 p) {
  vec3 mixed = fract(vec3(p.xyx) * 0.1031);
  mixed += dot(mixed, mixed.yzx + 33.33);
  return fract((mixed.x + mixed.y) * mixed.z);
}

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

/* Stars on a grid of cells, one per cell, placed and sized by the cell's own
   hash, so the field is dense without any of them being sampled twice. The cut
   decides how many cells hold one, the twinkle how much they breathe. */
float stars(vec2 pixel, float cell, float cut, float twinkle) {
  vec2 grid = floor(pixel / cell);
  vec2 within = fract(pixel / cell);
  float pick = hash(grid);
  if (pick < cut) {
    return 0.0;
  }
  // Placed anywhere in its cell, so the grid the field is built on never shows.
  vec2 at = vec2(hash(grid + 1.7), hash(grid + 4.3));
  float bright = (pick - cut) / (1.0 - cut);
  // Mostly faint with a few standing out, which is what a real field looks like.
  float weight = pow(bright, 2.2);
  float near = 1.0 - smoothstep(0.0, 0.055 + weight * 0.10, length(within - at));
  float breathe = 1.0 - twinkle + twinkle * sin(time * 1.4 + pick * 40.0);
  return near * weight * breathe;
}
`;

/** The gas both space backgrounds sit in. `drift` decides how fast it is being
 * travelled through, which is the only thing that separates them. */
export function nebulaSource(drift: number): string {
  return `${shaderPrelude}
void main() {
  vec2 uv = gl_FragCoord.xy / size;
  vec2 p = uv * vec2(size.x / size.y, 1.0);

  float drift = time * ${drift.toFixed(3)};
  float a = clouds(p * 2.4 + vec2(drift * 0.3, drift));
  float b = clouds(p * 3.7 - vec2(drift * 0.2, drift * 0.7));

  vec3 deep = vec3(0.015, 0.02, 0.05);
  vec3 violet = vec3(0.34, 0.13, 0.60);
  vec3 teal = vec3(0.05, 0.34, 0.42);
  vec3 rose = vec3(0.42, 0.12, 0.28);
  vec3 sky = deep
    + violet * pow(a, 1.7) * 0.72
    + teal * pow(b, 2.1) * 0.55
    + rose * pow(a * b, 2.6) * 0.75;

  // Three layers at different densities, so the field has depth rather than
  // reading as one sheet of dots. The gas thins them where it is thickest.
  float behind = 1.0 - clamp(a * 0.55, 0.0, 0.6);
  float field = stars(gl_FragCoord.xy, 34.0, 0.86, 0.35) * 0.85
              + stars(gl_FragCoord.xy, 19.0, 0.90, 0.5) * 0.5
              + stars(gl_FragCoord.xy, 11.0, 0.94, 0.6) * 0.3;
  sky += vec3(0.85, 0.90, 1.0) * field * behind;

  colour = vec4(sky * gain, 1.0);
}`;
}
