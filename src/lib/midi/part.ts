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

/** Slack against a small clock jitter before a lower reading counts as moving
 * back, rather than the scheduler's normal forward wobble. */
const rewindSlack = 0.05;

/** The furthest ahead one frame of playback can carry the clock, however slow
 * that frame was. */
const stepSeconds = 1;

/** Which ids come next at a moving position, without allocating on every step:
 * the Set is mutated in place, which is what lets a per-frame highlight stay a
 * lookup rather than a scan. */
export type NoteSweep = {
  /** The very next attack after the current position, several ids where it
   * is a chord. Empty past the last one. */
  readonly next: ReadonlySet<number>;
  /**
   * Moves to a position, forward or back, and answers whether the step was one
   * playback could not have taken: the listener asked to be somewhere else.
   *
   * Everything that follows a moment across the score reads that one answer, so
   * the panel and the render cannot disagree about what counts as a jump.
   */
  moveTo(position: number): boolean;
};

export function createNoteSweep(notes: readonly SongNote[]): NoteSweep {
  const attackTimes = [...new Set(notes.map((note) => note.start))].sort(
    (left, right) => left - right,
  );

  const next = new Set<number>();
  let attackIndex = 0;
  let lastPosition = Number.NEGATIVE_INFINITY;

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
  fillNext();

  function advance(position: number): void {
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
    next,
    moveTo(position: number): boolean {
      // Playback only ever carries the clock forward, and only so far in one
      // frame, so a step back past the jitter slack and a long step ahead are
      // both somebody asking to be somewhere else.
      const rewound = position + rewindSlack < lastPosition;
      const jumped =
        lastPosition === Number.NEGATIVE_INFINITY ||
        rewound ||
        position - lastPosition > stepSeconds;
      if (rewound) {
        attackIndex = 0;
        fillNext();
      }
      advance(position);
      lastPosition = position;
      return jumped;
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
