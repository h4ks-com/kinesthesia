/** Turning a midi-js soundfont file into decoded buffers, each annotated with
 * where it loops. Nothing here touches the audio graph. */

/** A recording still this loud at its end was never going to fade on its own,
 * so a note longer than it has to loop rather than stop dead. */
const sustainedTail = 0.25;
/** The steady part of a recording, past the onset and short of the end. */
const loopFrom = 0.4;
const loopTo = 0.92;
/** How far the loop points may be nudged to land on a zero crossing. Wide
 * enough to find one at any pitch, short enough not to move the loop. */
const snapSeconds = 0.03;

/** Long enough for a slow connection, short enough that a dead one does not
 * hold the song open. */
const loadTimeoutMs = 15000;

export type Sample = {
  readonly buffer: AudioBuffer;
  /** Whether it ends loud enough that looping is the only way to hold it. */
  readonly sustained: boolean;
  /** Where a held note repeats from and to, in seconds. */
  readonly loopStart: number;
  readonly loopEnd: number;
};

export type Samples = {
  readonly byPitch: Map<number, Sample>;
  readonly pitches: readonly number[];
};

const noteLetters: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/** `A0`, `C#4`, `Db4`. The soundfont names every sample this way. */
function toMidi(name: string): number | null {
  const parts = /^([A-G])([#b]?)(-?\d+)$/.exec(name);
  if (parts === null) {
    return null;
  }
  const [, letter, accidental, octave] = parts;
  const base = noteLetters[letter ?? ""];
  if (base === undefined || octave === undefined) {
    return null;
  }
  const shift = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  return (Number(octave) + 1) * 12 + base + shift;
}

/** The soundfont file is JavaScript, not JSON: it opens with guard statements
 * carrying braces of their own, and the object it assigns ends on a trailing
 * comma. Cutting from the assignment and dropping that comma leaves something
 * JSON can read. */
export function readSoundfontFile(source: string): Record<string, string> {
  const assigned = source.lastIndexOf("= {");
  const open = source.indexOf("{", assigned < 0 ? 0 : assigned);
  const close = source.lastIndexOf("}");
  if (open < 0 || close <= open) {
    return {};
  }
  const body = source.slice(open, close + 1).replace(/,\s*}$/, "}");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // A captive portal or an error page answers with 200 and its own braces.
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) {
    return {};
  }
  const named: Record<string, string> = {};
  for (const [name, uri] of Object.entries(parsed)) {
    if (typeof uri === "string") {
      named[name] = uri;
    }
  }
  return named;
}

function decodeBase64(uri: string): ArrayBuffer {
  const comma = uri.indexOf(",");
  const binary = atob(comma < 0 ? uri : uri.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) {
    bytes[at] = binary.charCodeAt(at);
  }
  return bytes.buffer;
}

/** How loud a recording ends against how loud it began. An organ holds its
 * level and stops dead; a piano has faded to nothing by then. */
function endsLoud(buffer: AudioBuffer): boolean {
  const data = buffer.getChannelData(0);
  const window = Math.min(data.length, Math.round(buffer.sampleRate * 0.05));
  const level = (from: number, to: number): number => {
    let sum = 0;
    for (let at = from; at < to; at += 1) {
      sum += (data[at] ?? 0) ** 2;
    }
    return Math.sqrt(sum / Math.max(1, to - from));
  };
  const opening = level(0, Math.min(data.length, buffer.sampleRate));
  const closing = level(data.length - window, data.length);
  return opening > 0 && closing / opening > sustainedTail;
}

/** Joining two points of a waveform that are not both at zero is a step, and a
 * step is a click, heard once every time round the loop. Both ends are moved to
 * the nearest rising crossing so the join is continuous. */
function risingZeroNear(
  data: Float32Array,
  target: number,
  window: number,
): number {
  const from = Math.max(1, target - window);
  const to = Math.min(data.length - 1, target + window);
  let best = target;
  let nearest = Number.POSITIVE_INFINITY;
  for (let at = from; at < to; at += 1) {
    const previous = data[at - 1] ?? 0;
    const current = data[at] ?? 0;
    if (previous <= 0 && current > 0 && Math.abs(at - target) < nearest) {
      nearest = Math.abs(at - target);
      best = at;
    }
  }
  return best;
}

function loopPoints(buffer: AudioBuffer): { start: number; end: number } {
  const data = buffer.getChannelData(0);
  const window = Math.round(buffer.sampleRate * snapSeconds);
  const start = risingZeroNear(
    data,
    Math.round(data.length * loopFrom),
    window,
  );
  const end = risingZeroNear(data, Math.round(data.length * loopTo), window);
  return end > start
    ? { start: start / buffer.sampleRate, end: end / buffer.sampleRate }
    : { start: buffer.duration * loopFrom, end: buffer.duration * loopTo };
}

/** The kit and format the sampler loads by default. A different kit is a
 * different set of recordings, and a different format is a second download of
 * the same ones, so both are matched to what it asks for. */
const defaultKit = "MusyngKite";
const defaultFormat = "mp3";

function soundfontUrl(instrument: string): string {
  return `https://gleitz.github.io/midi-js-soundfonts/${defaultKit}/${instrument}-${defaultFormat}.js`;
}

/** Null where the recordings could not be had, whatever the reason: the
 * caller answers by falling back to the sampler. */
export async function loadSoundfont(
  context: BaseAudioContext,
  instrument: string,
): Promise<Samples | null> {
  const response = await fetch(soundfontUrl(instrument), {
    // A hung connection would otherwise leave the song waiting on it forever.
    signal: AbortSignal.timeout(loadTimeoutMs),
  });
  if (!response.ok) {
    return null;
  }
  const byName = readSoundfontFile(await response.text());
  const byPitch = new Map<number, Sample>();
  await Promise.all(
    Object.entries(byName).map(async ([name, uri]) => {
      const pitch = toMidi(name);
      if (pitch === null) {
        return;
      }
      try {
        const buffer = await context.decodeAudioData(decodeBase64(uri));
        const loop = loopPoints(buffer);
        byPitch.set(pitch, {
          buffer,
          sustained: endsLoud(buffer),
          loopStart: loop.start,
          loopEnd: loop.end,
        });
      } catch {
        // A recording that will not decode is simply absent, and the nearest
        // neighbour covers for it.
      }
    }),
  );
  if (byPitch.size === 0) {
    return null;
  }
  const samples: Samples = {
    byPitch,
    pitches: [...byPitch.keys()].sort((a, b) => a - b),
  };
  return samples;
}
