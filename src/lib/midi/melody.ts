import type { Song, SongNote } from "@/lib/midi/song";

export const melodyRates = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export type MelodyRate = (typeof melodyRates)[number];

export const melodyRateRange = { min: 1, max: 12 } as const;
export const defaultMelodyRate: MelodyRate = 8;

/** Notes struck within this window are one chord, so a rolled chord or a grace
 * note collapses to a single melody note rather than a flurry. */
const chordWindow = 0.075;

/** Hands that alternate in time never share a chord, so taking the top of each
 * chord would weave the left hand into the tune. Notes are kept only near the
 * top of their neighbourhood, which is the right hand. */
const handSpan = 14;
const neighbourhood = 1;

export type MelodyOptions = {
  readonly tracks: ReadonlySet<number>;
  readonly maxNotesPerSecond: MelodyRate;
};

export function clampMelodyRate(value: number): MelodyRate {
  const whole = Math.round(value);
  return (
    melodyRates.find((rate) => rate === whole) ??
    (whole < melodyRateRange.min ? melodyRateRange.min : melodyRateRange.max)
  );
}

/** Reduces a song to one note at a time: the top of the right hand, thinned to
 * a rate a thumb can follow. Pure and deterministic, because both players in a
 * match derive this line separately and must agree on it exactly. */
export function reduceToMelody(song: Song, options: MelodyOptions): SongNote[] {
  const source = playable(song, options.tracks);
  if (source.length === 0) {
    return [];
  }
  const top = topOfEachChord(rightHand(source));
  return clipToMonophonic(
    thin(top, clampMelodyRate(options.maxNotesPerSecond)),
  );
}

function playable(song: Song, tracks: ReadonlySet<number>): SongNote[] {
  const percussion = new Set(
    song.tracks.filter((each) => each.percussion).map((each) => each.index),
  );
  // Choosing only drums leaves nothing to reduce, which is not the same as
  // choosing nothing at all and taking the whole song.
  const wanted = new Set([...tracks].filter((index) => !percussion.has(index)));
  if (tracks.size > 0 && wanted.size === 0) {
    return [];
  }
  return song.notes
    .filter((note) => {
      if (percussion.has(note.track)) {
        return false;
      }
      return wanted.size === 0 || wanted.has(note.track);
    })
    .sort((left, right) =>
      left.start === right.start
        ? left.pitch - right.pitch
        : left.start - right.start,
    );
}

function rightHand(notes: readonly SongNote[]): SongNote[] {
  let low = 0;
  let high = 0;
  return notes.filter((note) => {
    while (
      low < notes.length &&
      (notes[low]?.start ?? 0) < note.start - neighbourhood
    ) {
      low += 1;
    }
    while (
      high < notes.length &&
      (notes[high]?.start ?? 0) <= note.start + neighbourhood
    ) {
      high += 1;
    }
    let ceiling = note.pitch;
    for (let index = low; index < high; index += 1) {
      ceiling = Math.max(ceiling, notes[index]?.pitch ?? 0);
    }
    return note.pitch >= ceiling - handSpan;
  });
}

/** The highest note of each chord carries the melody. A note still sounding
 * never hides the notes struck after it, or a held pedal tone would swallow
 * the tune underneath it. */
function topOfEachChord(notes: readonly SongNote[]): SongNote[] {
  const line: SongNote[] = [];
  let index = 0;
  while (index < notes.length) {
    const first = notes[index];
    if (first === undefined) {
      break;
    }
    let best = first;
    let next = index + 1;
    while (next < notes.length) {
      const candidate = notes[next];
      if (
        candidate === undefined ||
        candidate.start - first.start > chordWindow
      ) {
        break;
      }
      if (candidate.pitch > best.pitch) {
        best = candidate;
      }
      next += 1;
    }
    line.push(best);
    index = next;
  }
  return line;
}

/** Keeps the line under the rate the player asked for by taking the highest
 * note of each window. An arpeggio spells its tune across time rather than in
 * one chord, so a slower rate walks its peaks instead of its inner voices. */
function thin(notes: readonly SongNote[], rate: number): SongNote[] {
  const gap = 1 / rate;
  const kept: SongNote[] = [];
  for (const note of notes) {
    const previous = kept[kept.length - 1];
    if (previous === undefined || note.start - previous.start >= gap) {
      kept.push(note);
      continue;
    }
    if (
      note.pitch > previous.pitch ||
      (note.pitch === previous.pitch && duration(note) > duration(previous))
    ) {
      kept[kept.length - 1] = note;
    }
  }
  return kept;
}

function duration(note: SongNote): number {
  return note.end - note.start;
}

function clipToMonophonic(notes: readonly SongNote[]): SongNote[] {
  return notes.map((note, index) => {
    const next = notes[index + 1];
    if (next === undefined || next.start >= note.end) {
      return note;
    }
    return { ...note, end: next.start };
  });
}
