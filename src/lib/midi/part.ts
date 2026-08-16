import type { Hand } from "@/lib/midi/hands";
import { type MelodyRate, reduceToMelody } from "@/lib/midi/melody";
import type { Song, SongNote } from "@/lib/midi/song";

/** One player's share of a song: which tracks they owe, whether that share is
 * reduced to a single line, and which hand of it, where a track holds both.
 * Both sides of a match derive their roll from this, so a co-op can hand each
 * side a different one. */
export type Part = {
  readonly simplified: boolean;
  readonly melodyRate: MelodyRate;
  readonly tracks: readonly number[];
  /** Null plays both hands of the chosen tracks. */
  readonly hand: Hand | null;
};

export function partLine(song: Song, part: Part): readonly SongNote[] {
  const tracks = new Set(part.tracks);
  const line = part.simplified
    ? reduceToMelody(song, { tracks, maxNotesPerSecond: part.melodyRate })
    : song.notes.filter((note) => tracks.has(note.track));
  return part.hand === null
    ? line
    : line.filter((note) => song.hands.get(note.id) === part.hand);
}

export function soundingPitches(
  notes: readonly SongNote[],
  position: number,
): ReadonlySet<number> {
  const pitches = new Set<number>();
  for (const note of notes) {
    if (note.start <= position && position < note.end) {
      pitches.add(note.pitch);
    }
  }
  return pitches;
}

/** Which ids sound at a moving position, and which come next, without
 * allocating on every step: both Sets are mutated in place, which is what
 * lets a per-frame highlight stay a lookup rather than a scan. */
export type NoteSweep = {
  readonly sounding: ReadonlySet<number>;
  /** The very next attack after the current position, several ids where it
   * is a chord. Empty past the last one. */
  readonly next: ReadonlySet<number>;
  /** Moves ahead to a position no earlier than the last one seen. */
  advance(position: number): void;
  /** Jumps to an arbitrary position, forward or back. */
  seek(position: number): void;
};

type SweepEvent = {
  readonly at: number;
  readonly id: number;
  readonly starts: boolean;
};

export function createNoteSweep(notes: readonly SongNote[]): NoteSweep {
  const events: SweepEvent[] = [];
  for (const note of notes) {
    events.push({ at: note.start, id: note.id, starts: true });
    events.push({ at: note.end, id: note.id, starts: false });
  }
  events.sort((left, right) => left.at - right.at);
  const attackTimes = [...new Set(notes.map((note) => note.start))].sort(
    (left, right) => left - right,
  );

  const sounding = new Set<number>();
  const next = new Set<number>();
  let eventIndex = 0;
  let attackIndex = 0;

  function fillNext(): void {
    next.clear();
    const at = attackTimes[attackIndex];
    if (at === undefined) {
      return;
    }
    for (const note of notes) {
      if (note.start === at) {
        next.add(note.id);
      }
    }
  }

  function reset(): void {
    sounding.clear();
    eventIndex = 0;
    attackIndex = 0;
    fillNext();
  }
  reset();

  function advance(position: number): void {
    while ((events[eventIndex]?.at ?? Number.POSITIVE_INFINITY) <= position) {
      const event = events[eventIndex];
      if (event === undefined) {
        break;
      }
      if (event.starts) {
        sounding.add(event.id);
      } else {
        sounding.delete(event.id);
      }
      eventIndex += 1;
    }
    let advanced = false;
    while ((attackTimes[attackIndex] ?? Number.POSITIVE_INFINITY) <= position) {
      attackIndex += 1;
      advanced = true;
    }
    if (advanced) {
      fillNext();
    }
  }

  return {
    sounding,
    next,
    advance,
    seek(position: number): void {
      reset();
      advance(position);
    },
  };
}

/** Which channels have a note sounding at the position, skipping hidden ones,
 * so the track list can light what is playing. */
export function soundingTracks(
  notes: readonly SongNote[],
  position: number,
  hidden: ReadonlySet<number>,
): ReadonlySet<number> {
  const tracks = new Set<number>();
  for (const note of notes) {
    if (
      note.start <= position &&
      position < note.end &&
      !hidden.has(note.track)
    ) {
      tracks.add(note.track);
    }
  }
  return tracks;
}

/** Where a set of notes sits on the keyboard, so a roll opens on them instead
 * of the lowest keys. */
export function medianPitch(notes: readonly SongNote[]): number | null {
  const pitches = notes
    .map((note) => note.pitch)
    .sort((left, right) => left - right);
  return pitches[Math.floor(pitches.length / 2)] ?? null;
}

/** A side shows the line it owes and hides the rest, which is what makes both
 * halves of a match frame the same stretch. */
export function tracksToHide(
  song: Song,
  mine: ReadonlySet<number>,
): ReadonlySet<number> {
  return new Set(
    song.tracks.map((track) => track.index).filter((index) => !mine.has(index)),
  );
}

export function toggleHidden(
  current: ReadonlySet<number>,
  index: number,
): ReadonlySet<number> {
  const next = new Set(current);
  if (next.has(index)) {
    next.delete(index);
  } else {
    next.add(index);
  }
  return next;
}

/** Soloing twice puts everything back, so the same key both isolates a track
 * and restores the rest. */
export function soloHidden(
  all: readonly number[],
  current: ReadonlySet<number>,
  index: number,
): ReadonlySet<number> {
  const shown = all.filter((other) => !current.has(other));
  const already = shown.length === 1 && !current.has(index);
  return already ? new Set() : new Set(all.filter((other) => other !== index));
}
