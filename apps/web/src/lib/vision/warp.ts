"use client";

import { findHomography } from "keybed";
import type { Point, Size } from "@/lib/vision/placement";

/** Lays a flat picture onto four corners of another one, keeping the
 * perspective. The roll is drawn once, as the app draws it everywhere else, and
 * this is what puts it on the plane the camera sees. */
export type Warp = {
  /** `taken` is the part of the picture to lay down, measured from its top left;
   * `whole` is the picture it was cut from. The roll draws its own keyboard at
   * the bottom of its canvas and the stage has a real one, so what is laid down
   * is only ever the part above it. */
  readonly onto: (
    source: TexImageSource,
    taken: Size,
    whole: Size,
    corners: readonly Point[],
    output: Size,
  ) => HTMLCanvasElement | null;
  /** Hands the GPU context back. A browser keeps only so many of them, and a
   * page opened and left a dozen times would take them all. */
  readonly dispose: () => void;
};

/** How much of the far end of the picture is given over to thinning out. */
const farFade = 0.14;

const vertexShader = `#version 300 es
in vec2 corner;
uniform vec2 output_size;
out vec2 landed;
void main() {
  landed = corner;
  vec2 clip = (corner / output_size) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

/** Every pixel of the quad is carried back through the homography on its own,
 * which is what makes this a perspective and not four stretched triangles. */
const fragmentShader = `#version 300 es
precision mediump float;
in vec2 landed;
uniform mat3 back;
uniform vec2 taken_size;
uniform vec2 whole_size;
uniform sampler2D picture;
uniform float fade_far;
out vec4 colour;
void main() {
  vec3 found = back * vec3(landed, 1.0);
  vec2 at = found.xy / found.z;
  if (at.x < 0.0 || at.y < 0.0 || at.x > taken_size.x || at.y > taken_size.y) {
    discard;
  }
  // The far end of what is laid down thins out rather than stopping at a line,
  // so a note arrives out of the distance instead of appearing at a seam.
  float thinned = smoothstep(0.0, fade_far, at.y / taken_size.y);
  colour = texture(picture, at / whole_size) * thinned;
}`;

function compile(
  gl: WebGL2RenderingContext,
  kind: number,
  code: string,
): WebGLShader {
  const shader = gl.createShader(kind);
  if (shader === null) {
    throw new Error("the warp has no shader to compile into");
  }
  gl.shaderSource(shader, code);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    throw new Error(`the warp shader failed: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

function buildProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram();
  if (program === null) {
    throw new Error("the warp has no program to build into");
  }
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexShader));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentShader));
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    throw new Error(
      `the warp failed to link: ${gl.getProgramInfoLog(program)}`,
    );
  }
  // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram is not a React hook
  gl.useProgram(program);
  return program;
}

/** Null where the browser has no WebGL2 to lay a picture with, which leaves the
 * stage its camera and its keys and no roll on top. */
export function createWarp(): Warp | null {
  const sheet = document.createElement("canvas");
  const gl = sheet.getContext("webgl2", {
    premultipliedAlpha: true,
    antialias: true,
  });
  if (gl === null) {
    console.info("stage: no warp, this browser has no WebGL2");
    return null;
  }
  let program: WebGLProgram;
  try {
    program = buildProgram(gl);
  } catch (reason) {
    console.info(`stage: no warp, ${reason}`);
    return null;
  }

  const buffer = gl.createBuffer();
  const corner = gl.getAttribLocation(program, "corner");
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  // The blend below expects colours already multiplied by their alpha, which is
  // what a canvas holds; without this every clear pixel of the roll arrives as
  // opaque white and washes the picture out.
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const outputSize = gl.getUniformLocation(program, "output_size");
  const takenSize = gl.getUniformLocation(program, "taken_size");
  const fadeFar = gl.getUniformLocation(program, "fade_far");
  const wholeSize = gl.getUniformLocation(program, "whole_size");
  const back = gl.getUniformLocation(program, "back");

  return {
    onto: (source, taken, whole, corners, output) => {
      const [one, two, three, four] = corners;
      if (
        one === undefined ||
        two === undefined ||
        three === undefined ||
        four === undefined
      ) {
        return null;
      }
      if (sheet.width !== output.width || sheet.height !== output.height) {
        sheet.width = output.width;
        sheet.height = output.height;
      }
      gl.viewport(0, 0, output.width, output.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      // The picture's own rectangle, mapped onto where it landed, then read
      // backwards so each pixel of the landing knows where it came from.
      const flat = [
        { x: 0, y: 0 },
        { x: taken.width, y: 0 },
        { x: taken.width, y: taken.height },
        { x: 0, y: taken.height },
      ];
      const forward = findHomography([one, two, three, four], flat);
      gl.uniformMatrix3fv(back, true, new Float32Array(forward));
      gl.uniform2f(outputSize, output.width, output.height);
      gl.uniform2f(takenSize, taken.width, taken.height);
      gl.uniform1f(fadeFar, farFade);
      gl.uniform2f(wholeSize, whole.width, whole.height);

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source,
      );
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([
          one.x,
          one.y,
          two.x,
          two.y,
          four.x,
          four.y,
          three.x,
          three.y,
        ]),
        gl.DYNAMIC_DRAW,
      );
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return sheet;
    },
    dispose: () => {
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      sheet.width = 0;
      sheet.height = 0;
    },
  };
}
