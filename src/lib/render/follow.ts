import type { Song, SongNote } from "@/lib/midi/song";

/** How far ahead to look for the note the view should be sitting on. */
export const followLookAhead = 4;

/** The pitch the player is next asked for: whatever is still sounding, else the
 * next one along. Ghosted notes are the accompaniment and are nobody's to reach
 * for, and a hidden track is not on screen to reach for either. Null leaves the
 * view where it is. */
export function nextToPlay(
  song: Song,
  position: number,
  hiddenTracks: ReadonlySet<number>,
  yours: ReadonlySet<number> | null,
  from: number,
): number | null {
  const notes: readonly SongNote[] = song.notes;
  const horizon = position + followLookAhead;
  for (let index = from; index < notes.length; index += 1) {
    const note = notes[index];
    if (note === undefined || note.start > horizon) {
      return null;
    }
    if (
      note.release >= position &&
      !hiddenTracks.has(note.track) &&
      (yours === null || yours.has(note.id))
    ) {
      return note.pitch;
    }
  }
  return null;
}
