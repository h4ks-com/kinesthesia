import type { Song, SongNote } from "@/lib/midi/song";

const chordWindow = 0.03;

export type Gate = {
  readonly start: number;
  readonly pitches: readonly number[];
};

/** Notes struck together become one gate, so a chord is judged as a unit
 * rather than as notes the player has to hit in a particular order. */
export function buildGates(notes: readonly SongNote[]): Gate[] {
  const gates: Gate[] = [];
  for (const note of notes) {
    const last = gates[gates.length - 1];
    if (last !== undefined && note.start - last.start <= chordWindow) {
      gates[gates.length - 1] = {
        start: last.start,
        pitches: [...last.pitches, note.pitch],
      };
      continue;
    }
    gates.push({ start: note.start, pitches: [note.pitch] });
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
