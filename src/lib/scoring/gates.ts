import type { Song, SongNote } from "@/lib/midi/song";
import { holdFrom } from "@/lib/scoring/hold";
import { lateWindow } from "@/lib/scoring/judge";

const chordWindow = 0.03;

/** When a gate stops being the one being played: the song carries on past it so
 * it can still be answered, but never past the gate behind it. Two gates open at
 * once would judge a note struck on time against the one before it, and would
 * leave learn resuming from a point the next note had already gone by. */
export function gateDeadline(start: number, nextStart: number | null): number {
  const late = start + lateWindow;
  return nextStart === null ? late : Math.min(late, nextStart);
}

export type Gate = {
  readonly start: number;
  readonly pitches: readonly number[];
  /** How long each pitch of this gate is meant to sound for, carried only for
   * the ones long enough to be held. A pitch missing from here is struck and
   * let go, and nothing is asked of the release. */
  readonly holds: ReadonlyMap<number, number>;
};

/** Notes struck together become one gate, so a chord is judged as a unit
 * rather than as notes the player has to hit in a particular order. */
export function buildGates(notes: readonly SongNote[]): Gate[] {
  const gates: Gate[] = [];
  for (const note of notes) {
    const length = note.end - note.start;
    const last = gates[gates.length - 1];
    if (last !== undefined && note.start - last.start <= chordWindow) {
      const holds = new Map(last.holds);
      if (length >= holdFrom) {
        holds.set(note.pitch, length);
      }
      gates[gates.length - 1] = {
        start: last.start,
        pitches: [...last.pitches, note.pitch],
        holds,
      };
      continue;
    }
    gates.push({
      start: note.start,
      pitches: [note.pitch],
      holds: length >= holdFrom ? new Map([[note.pitch, length]]) : new Map(),
    });
  }
  return gates;
}

export function gateIndexAt(gates: readonly Gate[], position: number): number {
  let index = 0;
  while (index < gates.length && (gates[index]?.start ?? 0) < position) {
    index += 1;
  }
  return index;
}

export function busiestTrack(song: Song): number {
  let best = song.tracks[0]?.index ?? 0;
  let bestCount = -1;
  for (const track of song.tracks) {
    if (track.noteCount > bestCount) {
      best = track.index;
      bestCount = track.noteCount;
    }
  }
  return best;
}
