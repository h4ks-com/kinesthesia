import { trackColor } from "@/lib/midi/palette";
import type { SongNote } from "@/lib/midi/song";

/** All the map reads of a song, so drawing one needs neither its harmony nor
 * its expression. */
export type MappedSong = {
  readonly duration: number;
  readonly notes: readonly SongNote[];
};

/** How tall a note mark is drawn where the song's range would give it less, so
 * a part that stays within an octave still reads as a line rather than a row of
 * dots. */
const thinnestNote = 1.5;

/** Left free above and below the outermost note, so the highest note in the
 * song is not drawn flush against the edge. */
const verticalPadding = 2;

/** Where the song sits on the keyboard, which is what the height is spent on: a
 * left hand part occupying two octaves would be a flat line if the map always
 * drew all 128 pitches. */
export type PitchSpan = { readonly low: number; readonly high: number };

export function pitchSpan(song: MappedSong): PitchSpan {
  let low = 127;
  let high = 0;
  for (const note of song.notes) {
    low = Math.min(low, note.pitch);
    high = Math.max(high, note.pitch);
  }
  return low > high ? { low: 48, high: 72 } : { low, high };
}

type MapOptions = {
  readonly song: MappedSong;
  readonly span: PitchSpan;
  readonly hiddenTracks: ReadonlySet<number>;
  readonly width: number;
  readonly height: number;
  /** Lit is the material already behind the playhead. Both passes are drawn
   * whole and one is clipped to the played width, so moving the playhead costs
   * two blits rather than a redraw of every note. */
  readonly lit: boolean;
};

/** The whole song as one picture, drawn once per size and per change of what is
 * shown. A note is a horizontal bar at its own pitch, so the shape of the map
 * is the shape of the music and a passage is recognisable by its contour. */
export function drawSongMap(
  ctx: CanvasRenderingContext2D,
  { song, span, hiddenTracks, width, height, lit }: MapOptions,
): void {
  ctx.clearRect(0, 0, width, height);
  const duration = Math.max(song.duration, 0.001);
  const pitches = Math.max(1, span.high - span.low);
  const usable = Math.max(1, height - verticalPadding * 2);
  const noteHeight = Math.max(thinnestNote, usable / (pitches + 1));
  ctx.globalAlpha = lit ? 1 : 0.42;
  for (const note of song.notes) {
    if (hiddenTracks.has(note.track)) {
      continue;
    }
    const color = trackColor(note.track);
    ctx.fillStyle = lit ? color.glow : color.flat;
    const x = (note.start / duration) * width;
    const sounded = ((note.end - note.start) / duration) * width;
    const y =
      verticalPadding +
      (1 - (note.pitch - span.low) / pitches) * (usable - noteHeight);
    ctx.fillRect(x, y, Math.max(1, sounded), noteHeight);
  }
  ctx.globalAlpha = 1;
}
