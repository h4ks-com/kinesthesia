/** The worker every background runs inside. Served from our own route so it
 * arrives with a policy of its own, then it takes away everything a background
 * has no business reaching before any background code runs.
 *
 * Kept as source rather than a module because it is served, not imported: the
 * header that forbids the network only exists on a response. */
export const runtimeSource = String.raw`

/* Kept before the lockdown takes it away: this is how the worker answers, and a
   background must not be able to forge an answer of its own. */
const answer = self.postMessage.bind(self);

/* Nothing a background can call its way out with.

   Taken off the prototypes as well as shadowed on the global, and the order
   matters. Only interface objects are own properties of the worker global;
   fetch, importScripts, navigator, indexedDB, caches, performance and crypto
   live on WorkerGlobalScope.prototype. Shadowing alone answers a bare name and
   a self.x lookup, and leaves the real one sitting one link up where
   Object.getPrototypeOf(self) reaches it and a stolen accessor hands back a
   live object. That matters more than the policy on the response: no header
   covers IndexedDB, and the roll's own database is sitting in this origin
   holding whatever the listener has uploaded. */
const denied = [
  "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts",
  "indexedDB", "caches", "Notification", "SharedWorker", "Worker",
  "BroadcastChannel", "navigator", "Response", "Request", "Headers",
  "performance", "crypto", "openDatabase", "sessionStorage", "localStorage",
  "postMessage",
];
for (const name of denied) {
  for (let scope = Object.getPrototypeOf(self); scope !== null;
       scope = Object.getPrototypeOf(scope)) {
    try {
      delete scope[name];
    } catch (_) { /* non-configurable, which the shadow below still covers */ }
  }
  try {
    Object.defineProperty(self, name, {
      value: undefined,
      writable: false,
      configurable: false,
      enumerable: false,
    });
  } catch (_) { /* already non-configurable, which is the same answer */ }
}

/* A render must come out the same every time, so nothing may read a clock or an
   unseeded random. Backgrounds are given frame.elapsed and random() instead.
   The constructor is replaced whole, not just Date.now: new Date() reads the
   same clock and was the way around the old patch. */
const RealDate = Date;
function FrozenDate() {
  return new RealDate(0);
}
FrozenDate.now = function () { return 0; };
FrozenDate.parse = RealDate.parse;
FrozenDate.UTC = RealDate.UTC;
FrozenDate.prototype = RealDate.prototype;
/* The prototype's constructor is the way back to the real one, and it is the
   short way: Date.prototype.constructor and (new Date()).constructor both land
   here. Replacing the binding without replacing this leaves the clock one
   expression away. */
RealDate.prototype.constructor = FrozenDate;
try {
  Object.defineProperty(self, "Date", {
    value: FrozenDate,
    writable: false,
    configurable: false,
  });
} catch (_) {}
/* A formatter with no argument reads the clock, so it is the same hole wearing
   a different name. Nothing drawn behind notes needs to format a date. */
try {
  Object.defineProperty(self, "Intl", {
    value: undefined,
    writable: false,
    configurable: false,
  });
} catch (_) {}
Math.random = function () {
  throw new Error("Math.random is not available; use the random() given to you");
};

let seed = 0x2f6e2b1 >>> 0;
function random() {
  /* xorshift32: the same sequence for the same background on every run, which
     is what lets a render of one song come out identical twice. */
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5;  seed >>>= 0;
  return seed / 4294967296;
}
self.random = random;

const vertexSource =
  "#version 300 es\nin vec2 place;\nvoid main() { gl_Position = vec4(place, 0.0, 1.0); }";

let spec = null;
self.background = function (given) { spec = given; };

let composite = null, out = null;
let base = null, gl = null, shader = null;
let overlay = null, ctx = null;
let scene = null;
let ratio = 1;
const view = { width: 0, height: 0, keyboardTop: 0 };
const frame = {
  elapsed: 0, position: 0, step: 0,
  notes: [], strikes: [], pressed: [],
  chord: null, key: null,
};

function compile(kind, source) {
  const it = gl.createShader(kind);
  gl.shaderSource(it, source);
  gl.compileShader(it);
  if (!gl.getShaderParameter(it, gl.COMPILE_STATUS)) {
    const why = gl.getShaderInfoLog(it);
    gl.deleteShader(it);
    throw new Error("shader failed to compile: " + why);
  }
  return it;
}

function buildShader(source) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, source));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error("shader failed to link: " + gl.getProgramInfoLog(program));
  }
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  const place = gl.getAttribLocation(program, "place");
  gl.enableVertexAttribArray(place);
  gl.vertexAttribPointer(place, 2, gl.FLOAT, false, 0, 0);
  const at = {
    size: gl.getUniformLocation(program, "size"),
    time: gl.getUniformLocation(program, "time"),
    gain: gl.getUniformLocation(program, "gain"),
    tone: gl.getUniformLocation(program, "tone"),
    energy: gl.getUniformLocation(program, "energy"),
  };
  return function (width, height, inputs) {
    gl.useProgram(program);
    gl.uniform2f(at.size, width, height);
    gl.uniform1f(at.time, inputs.time);
    gl.uniform1f(at.gain, inputs.gain);
    gl.uniform1f(at.tone, inputs.tone);
    gl.uniform1f(at.energy, inputs.energy);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}

function resize(width, height, nextRatio) {
  ratio = nextRatio;
  view.width = width;
  view.height = height;
  const pixels = [Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio))];
  composite.width = pixels[0];
  composite.height = pixels[1];
  overlay.width = pixels[0];
  overlay.height = pixels[1];
  if (gl !== null) {
    base.width = pixels[0];
    base.height = pixels[1];
    gl.viewport(0, 0, base.width, base.height);
  }
}

/* Named apart from the stdlib's own, since the two are concatenated. */
const restingMood = { tone: 0.5, energy: 0 };

function draw(given) {
  frame.elapsed = given.elapsed;
  frame.position = given.position;
  frame.step = given.step;
  frame.notes = given.notes;
  frame.strikes = given.strikes;
  frame.pressed = given.pressed;
  frame.chord = given.chord;
  frame.key = given.key;
  view.keyboardTop = given.keyboardTop;

  out.clearRect(0, 0, composite.width, composite.height);

  if (shader !== null) {
    const mood = (scene.mood ? scene.mood(frame, view) : null) || restingMood;
    shader(base.width, base.height, {
      time: frame.elapsed,
      gain: spec.shader.gain,
      tone: mood.tone,
      energy: mood.energy,
    });
    out.drawImage(base, 0, 0);
  }

  if (scene.paint && view.width > 0) {
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    scene.paint(ctx, view, frame);
    ctx.globalAlpha = 1;
    out.drawImage(overlay, 0, 0);
  }
}

self.onmessage = function (event) {
  const message = event.data;
  try {
    if (message.kind === "start") {
      /* The background's own code, run once. It calls background() and nothing
         else reaches out of here. Strict is prepended rather than inherited: a
         Function body is sloppy however strict the code that built it, and
         sloppy means an undeclared assignment quietly becomes a global. */
      new Function('"use strict";\n' + message.source)();
      if (spec === null) {
        throw new Error("the script never called background()");
      }
      composite = new OffscreenCanvas(1, 1);
      out = composite.getContext("2d");
      overlay = new OffscreenCanvas(1, 1);
      ctx = overlay.getContext("2d");
      if (spec.shader) {
        base = new OffscreenCanvas(1, 1);
        gl = base.getContext("webgl2");
        if (gl === null) {
          throw new Error("this device has no WebGL2, which this background needs");
        }
        shader = buildShader(spec.shader.source);
      }
      scene = spec.create();
      answer({
        kind: "started",
        name: spec.name,
        blurb: spec.blurb,
        directions: spec.directions || ["up", "down"],
      });
      return;
    }
    if (message.kind === "resize") {
      resize(message.width, message.height, message.ratio);
      answer({ kind: "resized" });
      return;
    }
    if (message.kind === "frame") {
      draw(message.frame);
      const painted = composite.transferToImageBitmap();
      answer({ kind: "painted", painted: painted }, [painted]);
      return;
    }
    if (message.kind === "stop") {
      if (scene && scene.dispose) { scene.dispose(); }
      self.close();
      return;
    }
  } catch (reason) {
    answer({
      kind: "broke",
      /* Trimmed of nulls: a driver's shader log is a C string, and the
         terminator comes along with it into anything that stores the reason. */
      why: String((reason && reason.message) || reason)
        .replace(/\0/g, "")
        .trim()
        .slice(0, 400),
    });
  }
};
`;
