/** What an author is handed when they ask how to write a background. Kept as
 * prose rather than generated from the types, because the types say what the
 * shapes are and this says what to do with them. */
export const backgroundApiDoc = `A background is a script. It runs in a worker
with no network, no document and no page: it is given two drawing layers and
told where the notes are, and that is all it can reach. If it throws, or will
not keep up, it is stopped and the roll goes back to plain.

add_background takes the script and nothing else. The name and the blurb are
read off the background() call below, which is the only place a background is
named; write both as plain strings, since they are read without running
anything. Where the deployment has a render browser the script is also run
there before it is kept, and an add then returns either an id or the reason it
would not draw.

Register once, at the top level:

    background({
      name: "Meadow",
      blurb: "One line for the picker.",
      directions: ["up", "down"],   // optional; which way the notes may travel
      shader: { source: shaderPrelude + myGlsl, gain: 1 },   // optional
      create() {
        let heat = 0;               // state lives here, for as long as it runs
        return {
          paint(ctx, view, frame) { ... },
          mood(frame, view) { return { tone: 0.5, energy: heat }; },
          dispose() {},
        };
      },
    });

paint is called every frame with a 2D context, cleared before each call, so
paint the whole frame every time.

view: { width, height, keyboardTop } in css pixels. keyboardTop is where the
keys begin, which is the line notes travel to or from.

frame, reused every frame, so read it and keep none of it:
  elapsed   seconds since the background started, running whether a song is or not
  position  where the song is; stops when playback stops
  step      seconds since the last frame, already clamped
  notes     [{ x, y, radius, color, pitch, velocity }] in flight. EMPTY while
            notes fall toward the keys, since a falling note never travels
            through the scene. Full only when notes leave the keys.
  strikes   [{ x, color, pitch, velocity }] that landed since the last frame.
            This is the moment worth reacting to in every mode.
  pressed   [60, 64] MIDI numbers held down right now
  chord     { name, root, quality } sounding now, or null. quality is one of
            major, minor, diminished, augmented, other. root is 0 for C.
  key       { root, mode } the song sits in, or null. mode is major or minor.

Given to you, besides the standard library of a worker:
  random()
      Seeded 0..1. Math.random throws, and Date.now returns 0: a render of the
      same song must come out identical every time, so nothing may read a clock
      or an unseeded random.
  new Particles(ceiling)
      A pool that never grows past its ceiling. Oldest out first.
      .add({ x, y, vx, vy, fade, size, seed })  fade is life lost per second.
      Ignored once the pool is full, so a background cannot grow one.
      .sweep(step, view, move, draw)  moves, ages and culls every particle,
      calling move(particle, step) then draw(particle). A particle carries a
      .life falling 1 to 0, and is dropped at 0 or once it leaves the view.
  drift(particle, step)
      The plainest motion there is: position += velocity * step. For move.
  new RockField({ max, rate, smallest, largest })
      The tumbling rocks the shipped space backgrounds use. rate is how many
      arrive per second, smallest and largest are radii.
      .paint(ctx, width, height, step, frame)  draws the whole field, and
      breaks a rock wherever a note in the frame has reached one.
  moodOf(frame, view)
      Returns { tone, energy }, both 0..1: where the sound sits across the
      keyboard, and how busy the playing is.
  shaderPrelude
      The header every shader here is built on. Prepend it to your own source.
  nebulaSource(drift)
      A ready fragment shader, already including the prelude.
  OffscreenCanvas
      For anything drawn once and stamped many times.

A shader draws under the painting. Prepend shaderPrelude to your own void main.
The prelude declares:
  out vec4 colour;      WRITE YOUR RESULT HERE. There is no gl_FragColor and no
                        fragColor; naming either is a compile error.
  uniform vec2 size;    the drawing buffer in pixels
  uniform float time;   seconds, the same clock as frame.elapsed
  uniform float gain;   whatever you passed as shader.gain
  uniform float tone;   and float energy, both from your mood() this frame
  float hash(vec2), float noise(vec2), float clouds(vec2)  value noise, and
                        clouds() is five octaves of it
  float stars(vec2 pixel, float cell, float cut, float twinkle)

Smallest shader that compiles:

    shader: {
      source: shaderPrelude + \`
    void main() {
      vec2 uv = gl_FragCoord.xy / size;
      colour = vec4(vec3(0.05, 0.06, 0.10) * (1.0 + energy) * gain, 1.0);
    }\`,
      gain: 1,
    }

What makes a good one: it sits behind the notes. The notes are what is being
read, and a background that competes with them is worse however pretty it is.
Answer in colour and movement rather than brightness. Hold anything that
accumulates between two ends, so it cannot run away to white or to black.

Read a shipped background with read_background to see all of this in use; ink
is the smallest, flower is the one that answers to the harmony.`;
