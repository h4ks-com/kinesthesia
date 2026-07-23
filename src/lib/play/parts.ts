import { instrumentName } from "@/lib/audio/general-midi";
import type { SongTrack } from "@/lib/midi/song";

/** One voice you play into during free roam. A part answers to one MIDI
 * channel, or to the computer keyboard and touch when `channel` is null. Its
 * `id` is stable and keys its colour, its voicing and its engine voice. */
export type PlayPart = {
  readonly id: number;
  readonly channel: number | null;
  readonly program: number;
  readonly percussion: boolean;
};

/** General MIDI reserves channel 10 (index 9) for the drum kit. */
export const drumChannel = 9;

export function partLabel(part: PlayPart): string {
  if (part.channel === null) {
    return "Keys";
  }
  return `Channel ${part.channel + 1}`;
}

export function partInstrument(part: PlayPart): string {
  return part.percussion ? "Drums" : instrumentName(part.program);
}

export function partToTrack(part: PlayPart): SongTrack {
  return {
    index: part.id,
    name: partLabel(part),
    instrument: partInstrument(part),
    program: part.program,
    percussion: part.percussion,
    noteCount: 0,
  };
}

export function keyboardPart(id: number): PlayPart {
  return { id, channel: null, program: 0, percussion: false };
}

export function channelPart(
  id: number,
  channel: number,
  program: number,
): PlayPart {
  return { id, channel, program, percussion: channel === drumChannel };
}
