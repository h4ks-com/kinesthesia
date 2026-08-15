import type { SongNote } from "@/lib/midi/song";

export const hands = ["left", "right"] as const;

export type Hand = (typeof hands)[number];

/** Which hand plays each note, by note id. */
export type HandMap = ReadonlyMap<number, Hand>;

/** Notes struck within this window are one chord: a rolled chord or a grace
 * note splits hands as a unit rather than note by note. */
const chordWindow = 0.04;

const octaveSpan = 12;
const wideSpan = 14;
const mediumSpanCost = 20;
const wideSpanCost = 100;

/** A side left empty while the other holds a real chord is a hair less
 * natural than an even split, so a tied split favours two hands over one. */
const strandedSideCost = 5;

type Chord = {
  readonly notes: readonly SongNote[];
  readonly pitches: readonly number[];
};

function groupChords(sorted: readonly SongNote[]): Chord[] {
  const chords: Chord[] = [];
  let index = 0;
  while (index < sorted.length) {
    const first = sorted[index];
    if (first === undefined) {
      break;
    }
    let next = index + 1;
    while (
      next < sorted.length &&
      (sorted[next]?.start ?? 0) - first.start <= chordWindow
    ) {
      next += 1;
    }
    const members = [...sorted.slice(index, next)].sort(
      (left, right) => left.pitch - right.pitch,
    );
    chords.push({ notes: members, pitches: members.map((note) => note.pitch) });
    index = next;
  }
  return chords;
}

function sideCost(side: readonly number[]): number {
  if (side.length <= 1) {
    return 0;
  }
  const span = (side[side.length - 1] ?? 0) - (side[0] ?? 0);
  if (span <= octaveSpan) {
    return 0;
  }
  return span <= wideSpan ? mediumSpanCost : wideSpanCost;
}

/** Integer cost of splitting a chord's pitches at `split`: `[0, split)` left,
 * `[split, size)` right. */
function emissionCost(pitches: readonly number[], split: number): number {
  const left = pitches.slice(0, split);
  const right = pitches.slice(split);
  const stranded =
    (left.length === 0 && right.length >= 2) ||
    (right.length === 0 && left.length >= 2)
      ? strandedSideCost
      : 0;
  return sideCost(left) + sideCost(right) + stranded;
}

/** The cut point between the hands at a split, doubled so the boundary
 * between two adjacent pitches never needs rounding. A split with an empty
 * side reads as the cut sitting one semitone beyond the notes it excludes. */
function boundaryX2(pitches: readonly number[], split: number): number {
  const size = pitches.length;
  if (size === 0) {
    return 0;
  }
  if (split <= 0) {
    return (pitches[0] ?? 0) * 2 - 2;
  }
  if (split >= size) {
    return (pitches[size - 1] ?? 0) * 2 + 2;
  }
  return (pitches[split - 1] ?? 0) + (pitches[split] ?? 0);
}

/** Penalises the cut point moving between consecutive chords, which is what
 * keeps a hand committed to a wide run rather than flipping at a fixed pitch:
 * the chord that pairs it against the other hand anchors where the cut sits,
 * and only a cheaper cut elsewhere moves it. */
function transitionCost(
  fromPitches: readonly number[],
  fromSplit: number,
  toPitches: readonly number[],
  toSplit: number,
): number {
  return Math.abs(
    boundaryX2(toPitches, toSplit) - boundaryX2(fromPitches, fromSplit),
  );
}

/** Splits a part's notes between the two hands with a Viterbi search over
 * each chord's playable split points, so a wide arpeggio stays with the hand
 * that started it rather than flipping at a fixed pitch line. Pure and
 * integer only: both sides of a match derive this from the same file and
 * must land on the identical split. */
export function assignHands(notes: readonly SongNote[]): HandMap {
  const map = new Map<number, Hand>();
  if (notes.length === 0) {
    return map;
  }
  const sorted = [...notes].sort(
    (left, right) => left.start - right.start || left.pitch - right.pitch,
  );
  const chords = groupChords(sorted);

  const cost: number[][] = [];
  const back: number[][] = [];
  for (let i = 0; i < chords.length; i += 1) {
    const pitches = chords[i]?.pitches ?? [];
    const size = pitches.length;
    const rowCost: number[] = new Array(size + 1);
    const rowBack: number[] = new Array(size + 1);
    const previous = chords[i - 1];
    const previousCost = cost[i - 1];
    for (let split = 0; split <= size; split += 1) {
      const emission = emissionCost(pitches, split);
      if (previous === undefined || previousCost === undefined) {
        rowCost[split] = emission;
        rowBack[split] = -1;
        continue;
      }
      let bestCost = Number.POSITIVE_INFINITY;
      let bestPrevious = 0;
      for (
        let previousSplit = 0;
        previousSplit <= previous.pitches.length;
        previousSplit += 1
      ) {
        const total =
          (previousCost[previousSplit] ?? Number.POSITIVE_INFINITY) +
          transitionCost(previous.pitches, previousSplit, pitches, split);
        if (total < bestCost) {
          bestCost = total;
          bestPrevious = previousSplit;
        }
      }
      rowCost[split] = bestCost + emission;
      rowBack[split] = bestPrevious;
    }
    cost.push(rowCost);
    back.push(rowBack);
  }

  const lastCost = cost[cost.length - 1] ?? [0];
  let split = 0;
  let bestFinal = Number.POSITIVE_INFINITY;
  for (let candidate = 0; candidate < lastCost.length; candidate += 1) {
    const candidateCost = lastCost[candidate] ?? Number.POSITIVE_INFINITY;
    if (candidateCost < bestFinal) {
      bestFinal = candidateCost;
      split = candidate;
    }
  }

  const splits: number[] = new Array(chords.length);
  for (let i = chords.length - 1; i >= 0; i -= 1) {
    splits[i] = split;
    split = back[i]?.[split] ?? 0;
  }

  for (let i = 0; i < chords.length; i += 1) {
    const chord = chords[i];
    const chordSplit = splits[i] ?? 0;
    if (chord === undefined) {
      continue;
    }
    for (let index = 0; index < chord.notes.length; index += 1) {
      const note = chord.notes[index];
      if (note !== undefined) {
        map.set(note.id, index < chordSplit ? "left" : "right");
      }
    }
  }
  return map;
}

/** Hands are assigned per track, never across tracks: two tracks sounding
 * together are two different instrumental lines, not one pair of hands. */
export function assignHandsForSong(notes: readonly SongNote[]): HandMap {
  const byTrack = new Map<number, SongNote[]>();
  for (const note of notes) {
    const forTrack = byTrack.get(note.track);
    if (forTrack === undefined) {
      byTrack.set(note.track, [note]);
    } else {
      forTrack.push(note);
    }
  }
  const merged = new Map<number, Hand>();
  for (const trackNotes of byTrack.values()) {
    for (const [id, hand] of assignHands(trackNotes)) {
      merged.set(id, hand);
    }
  }
  return merged;
}

/** Whether splitting this track's notes into hands would give two real
 * parts rather than stranding a handful of outliers on one side. */
export function looksTwoHanded(notes: readonly SongNote[]): boolean {
  if (notes.length < 8) {
    return false;
  }
  const assigned = assignHands(notes);
  let left = 0;
  let right = 0;
  for (const hand of assigned.values()) {
    if (hand === "left") {
      left += 1;
    } else {
      right += 1;
    }
  }
  const minShare = Math.max(4, Math.floor(notes.length * 0.15));
  return left >= minShare && right >= minShare;
}
