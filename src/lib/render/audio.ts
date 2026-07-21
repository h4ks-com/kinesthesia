import {
  audioBufferToWav16,
  type NoteEvent,
  renderOffline,
  type Scheduler,
  type StopFn,
} from "smplr";
import { InstrumentBank } from "@/lib/audio/instruments";
import { programFor, scheduledNote } from "@/lib/audio/voicing";
import type { RenderConfig } from "@/lib/render/export";
import { renderDuration } from "@/lib/render/export";

const sampleRate = 48000;

const noStop: StopFn = () => {};

/** smplr's default scheduler only plays notes within a lookahead window of the
 * wall clock, dispatching the rest from a timer that never fires while an
 * OfflineAudioContext renders instantly. This dispatches every note at once, so
 * each source node lands at its own absolute time in the rendered buffer. */
const immediateScheduler: Scheduler = {
  schedule(event: NoteEvent, callback: (event: NoteEvent) => void): StopFn {
    callback(event);
    return noStop;
  },
  stop() {},
};

/** Schedules every note offline through the same voicing the live engine uses,
 * so the export sounds like what plays on screen. */
export async function renderSongAudio(
  config: RenderConfig,
): Promise<AudioBuffer> {
  const { song, voicing, hiddenTracks, rate } = config;
  const byIndex = new Map(song.tracks.map((track) => [track.index, track]));
  const audible = song.tracks.filter((track) => !hiddenTracks.has(track.index));

  const result = await renderOffline(
    async (context) => {
      const bank = new InstrumentBank(context, immediateScheduler);
      await bank.warm(
        audible.map((track) => ({
          program: programFor(voicing.get(track.index) ?? null, track.program),
          percussion: track.percussion,
        })),
      );
      for (const note of song.notes) {
        const track = byIndex.get(note.track);
        if (track === undefined || hiddenTracks.has(note.track)) {
          continue;
        }
        const shaped = voicing.get(note.track) ?? null;
        const voice = bank.voiceFor({
          program: programFor(shaped, track.program),
          percussion: track.percussion,
        });
        voice?.start({
          ...scheduledNote(note, shaped, rate),
          time: note.start / rate,
        });
      }
    },
    { duration: renderDuration(config), sampleRate, channels: 2 },
  );
  return result.audioBuffer;
}

export function audioToWav(buffer: AudioBuffer): Blob {
  return audioBufferToWav16(buffer);
}
