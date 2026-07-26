/** One triangle covering the viewport, which is the whole of the geometry any
 * of these backgrounds needs. Each supplies its own fragment source; the
 * compiling, linking and buffer setup are the same every time. */
export type Fullscreen = {
  draw(size: readonly [number, number], time: number, gain: number): void;
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

  const sizeAt = gl.getUniformLocation(program, "size");
  const timeAt = gl.getUniformLocation(program, "time");
  const gainAt = gl.getUniformLocation(program, "gain");

  return {
    draw([width, height], time, gain) {
      // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is a WebGL call, not a React hook
      gl.useProgram(program);
      gl.uniform2f(sizeAt, width, height);
      gl.uniform1f(timeAt, time);
      gl.uniform1f(gainAt, gain);
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

/** The gas both space backgrounds sit in. `drift` decides how fast it is being
 * travelled through, which is the only thing that separates them. */
export function nebulaSource(drift: number): string {
  return `#version 300 es
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

  colour = vec4(sky * gain, 1.0);
}`;
}
