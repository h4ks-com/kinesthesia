/** All the split reads of a note, so it can be run over a file that has not
 * been through the whole parser yet. A `SongNote` already answers to this. */
export type PlacedNote = {
  readonly id: number;
  readonly pitch: number;
  readonly start: number;
  readonly track: number;
};

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

/** What a hand pays to move, per half semitone, since pitches are carried
 * doubled. Measured against engraved scores, this one term is worth nine
 * points of accuracy: without it the search has no memory of where a hand
 * was, and lands no better than a fixed line through middle C. */
const travelPerHalfSemitone = 1;

/** A hand resting this long pays half as much to move, because a hand with
 * time to spare crosses the keyboard freely and one on the beat does not. */
const idleHalfLifeMs = 500;

/** Notes closer together than this are an interval one hand holds, so pulling
 * them apart is charged for the gap it leaves. Priced just above the cost of
 * giving a whole chord to one hand, so a third with nothing around it to argue
 * from stays whole: measured against engraved scores that costs a tenth of a
 * point of accuracy and buys every small interval in the piece. */
const minGap = 5;
const gapCost = 6;

/** A chord played entirely by one hand is ordinary; the left reaching up for
 * all of it is rarer than the right reaching down. */
const strandedLeftCost = 5;
const strandedRightCost = 10;

/** Hands do cross, and the search has to be able to say so, at a price. */
const crossCost = 40;

/** Middle C, doubled like every pitch the search carries. */
const middleCX2 = 120;

/** What a hand pays to first arrive on the far side of middle C, per half
 * semitone. It settles only the question nothing else can answer, which is
 * which hand a part with no company at all belongs to: a line of low chords
 * is the left hand's even when the right is idle. */
const homeCost = 2;

/** How many hand positions stay in play between chords. Accuracy saturates
 * around sixteen and most of it is there at one, so this is the cheap end of
 * a flat curve. */
const beamWidth = 8;

/** A hand that has not played yet has no position to travel from. */
const unset = -1;

/** Packs the two hand positions into one key. Wider than the range a doubled
 * pitch can take, so no two pairs of positions ever collide on it. */
const positionStride = 512;

/** Groups struck-together notes into chords, low to high. Shared with
 * `staff-split.ts`, which reads a chord's own span rather than a whole part's,
 * to tell a wide moment from a part that merely ranges widely over time. */
export function groupChords(sorted: readonly PlacedNote[]): PlacedNote[][] {
  const chords: PlacedNote[][] = [];
  let index = 0;
  while (index < sorted.length) {
    const first = sorted[index];
    if (first === undefined) {
      break;
    }
    const group: PlacedNote[] = [];
    // Measured from the first note of the group rather than the last, so a
    // long roll cannot chain one window into another without end.
    while (
      index < sorted.length &&
      (sorted[index]?.start ?? 0) - first.start <= chordWindow
    ) {
      group.push(sorted[index] as PlacedNote);
      index += 1;
    }
    // Rolled, the notes arrive in the order they were struck; everything below
    // reads a chord low to high, down to which side of the split a note falls.
    chords.push(group.sort((left, right) => left.pitch - right.pitch));
  }
  return chords;
}

function spanCost(low: number, high: number): number {
  const span = high - low;
  if (span <= octaveSpan) {
    return 0;
  }
  return span <= wideSpan ? mediumSpanCost : wideSpanCost;
}

function travelCost(refX2: number, lastRefX2: number, idleMs: number): number {
  const distance = Math.abs(refX2 - lastRefX2);
  return Math.floor(
    (distance * travelPerHalfSemitone * idleHalfLifeMs) /
      (idleHalfLifeMs + idleMs),
  );
}

/** Where the two hands stand, and when each last played. A hand that sits out
 * a chord keeps its place and pays nothing, which is what holds it over the
 * line it was playing rather than dragging it to wherever the notes are. */
type HandState = {
  readonly leftX2: number;
  readonly rightX2: number;
  readonly leftMs: number;
  readonly rightMs: number;
  readonly cost: number;
  readonly back: number;
  readonly split: number;
};

/**
 * Splits a part's notes between the two hands, chord by chord, with a
 * beam-pruned search over where each hand stands. Carrying a position per hand
 * is what lets a hand stay with the line it is playing, and what lets the two
 * of them cross.
 *
 * Pure and integer only: both sides of a match derive this from the same file
 * and must land on the identical split.
 */
export function assignHands(notes: readonly PlacedNote[]): HandMap {
  const map = new Map<number, Hand>();
  if (notes.length === 0) {
    return map;
  }
  const sorted = [...notes].sort(
    (left, right) => left.start - right.start || left.pitch - right.pitch,
  );
  const chords = groupChords(sorted);

  let layer: HandState[] = [
    {
      leftX2: unset,
      rightX2: unset,
      leftMs: 0,
      rightMs: 0,
      cost: 0,
      back: -1,
      split: -1,
    },
  ];
  const layers: HandState[][] = [];

  for (const chord of chords) {
    const pitches = chord.map((note) => note.pitch);
    const size = pitches.length;
    const nowMs = Math.round((chord[0]?.start ?? 0) * 1000);
    const reached = new Map<number, HandState>();

    for (let back = 0; back < layer.length; back += 1) {
      const previous = layer[back];
      if (previous === undefined) {
        continue;
      }
      for (let split = 0; split <= size; split += 1) {
        let cost = previous.cost;
        let leftX2 = previous.leftX2;
        let rightX2 = previous.rightX2;
        let leftMs = previous.leftMs;
        let rightMs = previous.rightMs;

        if (split > 0) {
          const low = pitches[0] ?? 0;
          const high = pitches[split - 1] ?? 0;
          cost += spanCost(low, high);
          const refX2 = low + high;
          if (previous.leftX2 === unset) {
            cost += homeCost * Math.max(0, refX2 - middleCX2);
          } else {
            cost += travelCost(refX2, previous.leftX2, nowMs - previous.leftMs);
          }
          leftX2 = refX2;
          leftMs = nowMs;
        }

        if (split < size) {
          const low = pitches[split] ?? 0;
          const high = pitches[size - 1] ?? 0;
          cost += spanCost(low, high);
          const refX2 = low + high;
          if (previous.rightX2 === unset) {
            cost += homeCost * Math.max(0, middleCX2 - refX2);
          } else {
            cost += travelCost(
              refX2,
              previous.rightX2,
              nowMs - previous.rightMs,
            );
          }
          rightX2 = refX2;
          rightMs = nowMs;
        }

        if (split > 0 && split < size) {
          const gap = (pitches[split] ?? 0) - (pitches[split - 1] ?? 0);
          if (gap < minGap) {
            cost += gapCost * (minGap - gap);
          }
        }
        if (size >= 2 && split === 0) {
          cost += strandedLeftCost;
        }
        if (size >= 2 && split === size) {
          cost += strandedRightCost;
        }
        if (leftX2 !== unset && rightX2 !== unset && leftX2 > rightX2) {
          cost += crossCost;
        }

        const key = leftX2 * positionStride + rightX2;
        const held = reached.get(key);
        if (held === undefined || cost < held.cost) {
          reached.set(key, {
            leftX2,
            rightX2,
            leftMs,
            rightMs,
            cost,
            back,
            split,
          });
        }
      }
    }

    layer = [...reached.values()]
      .sort(
        (one, other) =>
          one.cost - other.cost ||
          one.leftX2 - other.leftX2 ||
          one.rightX2 - other.rightX2,
      )
      .slice(0, beamWidth);
    layers.push(layer);
  }

  let best = 0;
  for (let index = 1; index < layer.length; index += 1) {
    if ((layer[index]?.cost ?? 0) < (layer[best]?.cost ?? 0)) {
      best = index;
    }
  }

  for (let index = chords.length - 1; index >= 0; index -= 1) {
    const state = layers[index]?.[best];
    const chord = chords[index];
    if (state === undefined || chord === undefined) {
      continue;
    }
    for (let position = 0; position < chord.length; position += 1) {
      const note = chord[position];
      if (note !== undefined) {
        map.set(note.id, position < state.split ? "left" : "right");
      }
    }
    best = state.back;
  }
  return map;
}

/** Hands are assigned per track, never across tracks: two tracks sounding
 * together are two different instrumental lines, not one pair of hands. */
export function assignHandsForSong(notes: readonly PlacedNote[]): HandMap {
  const byTrack = new Map<number, PlacedNote[]>();
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

/** How much of a part has to be out of one hand's reach before it reads as
 * written for two, so an occasional stretch does not make a melody a duet. */
const twoHandedShare = 0.15;

/** Whether a part is written for two hands, asked of the music rather than of
 * the assignment: what needs two hands is sound that arrives at once from
 * further apart than one hand reaches. A single line is a single line however
 * the search chooses to share it out. */
export function looksTwoHanded(notes: readonly PlacedNote[]): boolean {
  if (notes.length < 8) {
    return false;
  }
  const sorted = [...notes].sort(
    (left, right) => left.start - right.start || left.pitch - right.pitch,
  );
  const chords = groupChords(sorted);
  const wide = chords.filter((chord) => {
    const low = chord[0]?.pitch ?? 0;
    const high = chord[chord.length - 1]?.pitch ?? 0;
    return high - low > wideSpan;
  }).length;
  return wide >= Math.max(2, Math.ceil(chords.length * twoHandedShare));
}
