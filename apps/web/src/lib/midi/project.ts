import { Midi } from "@tonejs/midi";
import { Chord, Interval, Note } from "tonal";
import {
  type Digest,
  detectMeter,
  detectTempo,
  digest,
  type HarmonySpan,
  type KeyEstimate,
} from "@/lib/midi/analysis";
import { chordMidi, font, glyphWidth, whiteKeyFrom } from "@/lib/midi/compose";
import { highestPitch, isBlackKey, lowestPitch } from "@/lib/midi/song";

export type ProjectNote = {
  pitch: number;
  startBeat: number;
  durationBeats: number;
  velocity: number;
};

export type ProjectTrack = {
  channel: number;
  program: number;
  percussion: boolean;
  notes: ProjectNote[];
};

/** A song being edited: notes live in beats so a tempo change or a bar-aligned
 * copy stays exact, and each track carries its own channel and instrument. */
export type Project = {
  id: string;
  name: string;
  bpm: number;
  beatsPerBar: number;
  beatValue: number;
  tracks: ProjectTrack[];
};

export type ChordStyle = "block" | "up" | "down";

export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditError";
  }
}

const minBpm = 20;
const maxBpm = 300;

function clampBpm(bpm: number): number {
  return Math.min(maxBpm, Math.max(minBpm, Math.round(bpm)));
}

function clone(project: Project): Project {
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      notes: track.notes.map((note) => ({ ...note })),
    })),
  };
}

export function createProject(
  id: string,
  options: { name?: string; bpm?: number; beatsPerBar?: number } = {},
): Project {
  return {
    id,
    name: options.name ?? "project",
    bpm: clampBpm(options.bpm ?? 120),
    beatsPerBar: options.beatsPerBar ?? 4,
    beatValue: 4,
    tracks: [],
  };
}

export function importProject(id: string, midi: Midi, name: string): Project {
  const bpm = detectTempo(midi).bpm;
  const meter = detectMeter(midi);
  const perBeat = 60 / bpm;
  const tracks: ProjectTrack[] = [];
  for (const track of midi.tracks) {
    if (track.notes.length === 0) {
      continue;
    }
    tracks.push({
      channel: track.channel,
      program: track.instrument.number,
      percussion: track.instrument.percussion,
      notes: track.notes.map((note) => ({
        pitch: note.midi,
        startBeat: note.time / perBeat,
        durationBeats: note.duration / perBeat,
        velocity: note.velocity,
      })),
    });
  }
  return {
    id,
    name,
    bpm,
    beatsPerBar: meter.beats,
    beatValue: meter.value,
    tracks,
  };
}

function ensureTrack(
  project: Project,
  track: number | "new" | undefined,
  channel: number | undefined,
): number {
  if (track === "new" || (track === undefined && project.tracks.length === 0)) {
    const nextChannel = channel ?? project.tracks.length % 16;
    project.tracks.push({
      channel: nextChannel,
      program: 0,
      percussion: nextChannel === 9,
      notes: [],
    });
    return project.tracks.length - 1;
  }
  const index = track ?? 0;
  if (project.tracks[index] === undefined) {
    throw new EditError(`track ${index} does not exist`);
  }
  return index;
}

function guardPitches(
  notes: readonly ProjectNote[],
  percussion: boolean,
): void {
  if (percussion) {
    return;
  }
  for (const note of notes) {
    if (note.pitch < lowestPitch || note.pitch > highestPitch) {
      throw new EditError("that lands off the 88 keys");
    }
  }
}

function chordNotes(
  chords: readonly string[],
  style: ChordStyle,
  octave: number,
  atBar: number,
  beatsPerBar: number,
): ProjectNote[] {
  const unknown = chords.filter((symbol) => Chord.get(symbol).empty);
  if (unknown.length > 0) {
    throw new EditError(`unknown chord(s): ${unknown.join(", ")}`);
  }
  const notes: ProjectNote[] = [];
  chords.forEach((symbol, bar) => {
    const start = (atBar - 1 + bar) * beatsPerBar;
    const tones = chordMidi(symbol, octave);
    if (style === "block") {
      for (const pitch of tones) {
        notes.push({
          pitch,
          startBeat: start,
          durationBeats: beatsPerBar,
          velocity: 0.8,
        });
      }
      return;
    }
    // Each tone rings to the end of the bar, so the arpeggio settles into the
    // held chord.
    const order = style === "down" ? [...tones].reverse() : tones;
    for (let step = 0; step < beatsPerBar; step += 1) {
      const pitch = order[step % order.length];
      if (pitch !== undefined) {
        notes.push({
          pitch,
          startBeat: start + step,
          durationBeats: beatsPerBar - step,
          velocity: 0.8,
        });
      }
    }
  });
  return notes;
}

export function addChords(
  project: Project,
  args: {
    track?: number | "new";
    channel?: number;
    chords: readonly string[];
    style?: ChordStyle;
    octave?: number;
    atBar?: number;
  },
): Project {
  const next = clone(project);
  const index = ensureTrack(next, args.track, args.channel);
  const notes = chordNotes(
    args.chords,
    args.style ?? "block",
    args.octave ?? 3,
    args.atBar ?? endBar(next),
    next.beatsPerBar,
  );
  const track = next.tracks[index];
  if (track === undefined) {
    throw new EditError("track vanished");
  }
  guardPitches(notes, track.percussion);
  track.notes.push(...notes);
  return next;
}

function whiteKeyCount(from: number): number {
  let whites = 0;
  for (let pitch = from; pitch <= highestPitch; pitch += 1) {
    if (!isBlackKey(pitch)) {
      whites += 1;
    }
  }
  return whites;
}

/** How many glyphs fit across the keys from `from` up, so a line of text can be
 * wrapped to what the keyboard actually shows. */
function charsPerLine(from: number): number {
  return Math.max(1, Math.floor((whiteKeyCount(from) + 1) / (glyphWidth + 1)));
}

/** Greedily packs whole words into lines no wider than `perLine`, hard-splitting
 * a single word that is longer than a line. */
function wrapText(text: string, perLine: number): string[] {
  const words = text
    .toUpperCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > perLine) {
      if (current !== "") {
        lines.push(current);
        current = "";
      }
      for (let index = 0; index < word.length; index += perLine) {
        lines.push(word.slice(index, index + perLine));
      }
      continue;
    }
    const candidate = current === "" ? word : `${current} ${word}`;
    if (candidate.length > perLine) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== "") {
    lines.push(current);
  }
  return lines.length === 0 ? [""] : lines;
}

const glyphRows = 7;
/** Half a beat per glyph row keeps a whole letter inside the roll's look-ahead,
 * so a letter reads at a glance. */
const rowBeats = 0.5;
const lineGapBeats = 1;

export function addText(
  project: Project,
  args: {
    track?: number | "new";
    channel?: number;
    text: string;
    atBar?: number;
  },
): Project {
  const next = clone(project);
  const index = ensureTrack(next, args.track, args.channel);
  const atBar = args.atBar ?? endBar(next);
  const total = whiteKeyCount(lowestPitch);
  const lines = wrapText(args.text, charsPerLine(lowestPitch));
  const lineSpan = glyphRows * rowBeats + lineGapBeats;
  const notes: ProjectNote[] = [];
  lines.forEach((line, lineIndex) => {
    // Centre each line across the whole keyboard so it uses the low keys as well.
    const lineWhites = line.length * (glyphWidth + 1) - 1;
    const leftPad = Math.max(0, Math.floor((total - lineWhites) / 2));
    // Earlier lines start earlier, so a wrapped message falls in reading order.
    const base = (atBar - 1) * next.beatsPerBar + lineIndex * lineSpan;
    let column = 0;
    for (const character of line) {
      const glyph = font[character] ?? font[" "];
      if (glyph === undefined) {
        continue;
      }
      for (let row = 0; row < glyph.length; row += 1) {
        const cells = glyph[row] ?? "";
        for (let cell = 0; cell < cells.length; cell += 1) {
          if (cells[cell] !== "#") {
            continue;
          }
          notes.push({
            pitch: whiteKeyFrom(lowestPitch, leftPad + column + cell),
            startBeat: base + (glyph.length - 1 - row) * rowBeats,
            durationBeats: rowBeats,
            velocity: 0.9,
          });
        }
      }
      column += glyphWidth + 1;
    }
  });
  const track = next.tracks[index];
  if (track === undefined) {
    throw new EditError("track vanished");
  }
  guardPitches(notes, track.percussion);
  track.notes.push(...notes);
  return next;
}

function parseAt(at: string | number, beatsPerBar: number): number {
  if (typeof at === "number") {
    if (!Number.isFinite(at) || at < 0) {
      throw new EditError(`bad position: ${at}`);
    }
    return at;
  }
  const [bar, beat] = at.split(":").map((part) => Number(part));
  if (
    bar === undefined ||
    !Number.isFinite(bar) ||
    (beat !== undefined && !Number.isFinite(beat))
  ) {
    throw new EditError(`bad position: ${at}`);
  }
  const value = (bar - 1) * beatsPerBar + ((beat ?? 1) - 1);
  if (value < 0) {
    throw new EditError(`bad position: ${at}`);
  }
  return value;
}

function parseDuration(duration: string | number): number {
  if (typeof duration === "number") {
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new EditError(`bad duration: ${duration}`);
    }
    return duration;
  }
  const [num, den] = duration.split("/").map((part) => Number(part));
  const value =
    num === undefined || den === undefined ? Number.NaN : (4 * num) / den;
  if (!Number.isFinite(value) || value <= 0) {
    throw new EditError(`bad duration: ${duration}`);
  }
  return value;
}

export function addNotes(
  project: Project,
  args: {
    track?: number | "new";
    channel?: number;
    notes: readonly {
      note: string;
      at: string | number;
      dur: string | number;
      velocity?: number | undefined;
    }[];
  },
): Project {
  const next = clone(project);
  const index = ensureTrack(next, args.track, args.channel);
  const notes: ProjectNote[] = args.notes.map((entry) => {
    const pitch = Note.midi(entry.note);
    if (pitch === null) {
      throw new EditError(`unknown note: ${entry.note}`);
    }
    return {
      pitch,
      startBeat: parseAt(entry.at, next.beatsPerBar),
      durationBeats: parseDuration(entry.dur),
      velocity: entry.velocity ?? 0.8,
    };
  });
  const track = next.tracks[index];
  if (track === undefined) {
    throw new EditError("track vanished");
  }
  guardPitches(notes, track.percussion);
  track.notes.push(...notes);
  return next;
}

export function projectBars(project: Project): number {
  let end = 0;
  for (const track of project.tracks) {
    for (const note of track.notes) {
      end = Math.max(end, note.startBeat + note.durationBeats);
    }
  }
  return Math.ceil(end / project.beatsPerBar);
}

/** The first empty bar, where content lands when no bar is named. */
function endBar(project: Project): number {
  return projectBars(project) + 1;
}

/** Opens `bars` empty bars at `atBar` by shifting every later note along, so
 * content can be prepended (atBar 1) or inserted in the middle. */
export function insertBars(
  project: Project,
  args: { atBar: number; bars: number; track?: number },
): Project {
  if (args.bars < 1) {
    throw new EditError("bars must be at least 1");
  }
  if (args.atBar < 1) {
    throw new EditError("atBar must be at least 1");
  }
  const next = clone(project);
  const cut = (args.atBar - 1) * next.beatsPerBar;
  const shift = args.bars * next.beatsPerBar;
  const indices =
    args.track === undefined
      ? next.tracks.map((_, index) => index)
      : [args.track];
  for (const index of indices) {
    const track = next.tracks[index];
    if (track === undefined) {
      throw new EditError(`track ${index} does not exist`);
    }
    for (const note of track.notes) {
      if (note.startBeat >= cut) {
        note.startBeat += shift;
      }
    }
  }
  return next;
}

export function duplicate(
  project: Project,
  args: {
    track?: number;
    fromBar: number;
    toBar: number;
    atBar: number;
    times?: number;
  },
): Project {
  if (args.fromBar > args.toBar || args.fromBar < 1) {
    throw new EditError("fromBar must be a bar at or before toBar");
  }
  const times = args.times ?? 1;
  if (times < 1) {
    throw new EditError("times must be at least 1");
  }
  const next = clone(project);
  const bpb = next.beatsPerBar;
  const spanBeats = (args.toBar - args.fromBar + 1) * bpb;
  const sourceStart = (args.fromBar - 1) * bpb;
  const pasteStart = (args.atBar - 1) * bpb;
  const indices =
    args.track === undefined
      ? next.tracks.map((_, index) => index)
      : [args.track];
  for (const index of indices) {
    const track = next.tracks[index];
    if (track === undefined) {
      throw new EditError(`track ${index} does not exist`);
    }
    const source = track.notes.filter(
      (note) =>
        note.startBeat >= sourceStart &&
        note.startBeat < sourceStart + spanBeats,
    );
    for (let copy = 0; copy < times; copy += 1) {
      const shift = pasteStart + copy * spanBeats - sourceStart;
      for (const note of source) {
        track.notes.push({ ...note, startBeat: note.startBeat + shift });
      }
    }
  }
  return next;
}

export function transpose(
  project: Project,
  args: { track?: number; by: number | string },
): Project {
  const semitones =
    typeof args.by === "number"
      ? args.by
      : (Interval.get(args.by).semitones ?? 0);
  if (semitones === 0) {
    return clone(project);
  }
  const next = clone(project);
  const indices =
    args.track === undefined
      ? next.tracks.map((_, index) => index)
      : [args.track];
  for (const index of indices) {
    const track = next.tracks[index];
    if (track === undefined) {
      throw new EditError(`track ${index} does not exist`);
    }
    if (track.percussion) {
      continue;
    }
    for (const note of track.notes) {
      const moved = note.pitch + semitones;
      if (moved < lowestPitch || moved > highestPitch) {
        throw new EditError("that transpose would run notes off the 88 keys");
      }
    }
    for (const note of track.notes) {
      note.pitch += semitones;
    }
  }
  return next;
}

export function setTempo(project: Project, bpm: number): Project {
  return { ...clone(project), bpm: clampBpm(bpm) };
}

export function setInstrument(
  project: Project,
  args: { track: number; program: number },
): Project {
  if (args.program < 0 || args.program > 127) {
    throw new EditError("program must be 0 to 127");
  }
  const next = clone(project);
  const track = next.tracks[args.track];
  if (track === undefined) {
    throw new EditError(`track ${args.track} does not exist`);
  }
  track.program = args.program;
  return next;
}

function renderProject(project: Project): Midi {
  const midi = new Midi();
  midi.header.tempos = [{ ticks: 0, bpm: project.bpm }];
  midi.header.timeSignatures = [
    { ticks: 0, timeSignature: [project.beatsPerBar, project.beatValue] },
  ];
  midi.header.update();
  const perBeat = 60 / project.bpm;
  for (const source of project.tracks) {
    const track = midi.addTrack();
    track.channel = source.channel;
    track.instrument.number = source.program;
    for (const note of source.notes) {
      track.addNote({
        midi: note.pitch,
        time: note.startBeat * perBeat,
        duration: note.durationBeats * perBeat,
        velocity: note.velocity,
      });
    }
  }
  return midi;
}

export function projectBytes(project: Project): Uint8Array {
  return renderProject(project).toArray();
}

export type ProjectTrackDigest = {
  readonly index: number;
  readonly channel: number;
  readonly program: number;
  readonly percussion: boolean;
  readonly notes: number;
  readonly range: readonly [string, string];
};

export type ProjectDigest = {
  readonly id: string;
  readonly name: string;
  readonly bpm: number;
  readonly meter: string;
  readonly bars: number;
  readonly key: KeyEstimate | null;
  readonly tracks: readonly ProjectTrackDigest[];
  readonly harmony: readonly HarmonySpan[];
};

function rangeOf(notes: readonly ProjectNote[]): [string, string] {
  if (notes.length === 0) {
    return ["-", "-"];
  }
  const pitches = notes.map((note) => note.pitch);
  return [
    Note.fromMidi(Math.min(...pitches)),
    Note.fromMidi(Math.max(...pitches)),
  ];
}

export function projectDigest(project: Project): ProjectDigest {
  const full: Digest = digest(renderProject(project), project.name);
  return {
    id: project.id,
    name: project.name,
    bpm: project.bpm,
    meter: `${full.meter.beats}/${full.meter.value}`,
    bars: projectBars(project),
    key: full.key,
    harmony: full.harmony,
    tracks: project.tracks.map((track, index) => ({
      index,
      channel: track.channel,
      program: track.program,
      percussion: track.percussion,
      notes: track.notes.length,
      range: rangeOf(track.notes),
    })),
  };
}
