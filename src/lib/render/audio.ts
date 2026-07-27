import {
  audioBufferToWav16,
  type NoteEvent,
  renderOffline,
  type Scheduler,
  type StopFn,
} from "smplr";
import { soundfontFor } from "@/lib/audio/general-midi";
import { InstrumentBank } from "@/lib/audio/instruments";
import { playedNote, SampleVoices } from "@/lib/audio/sample-voices";
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
 * so the export sounds like what plays on screen. onStage names the slow parts,
 * neither of which reports progress, so the caller can show which is running. */
export async function renderSongAudio(
  config: RenderConfig,
  onStage?: (stage: string) => void,
): Promise<AudioBuffer> {
  const { song, voicing, hiddenTracks, rate } = config;
  const byIndex = new Map(song.tracks.map((track) => [track.index, track]));
  const audible = song.tracks.filter((track) => !hiddenTracks.has(track.index));

  const result = await renderOffline(
    async (context) => {
      onStage?.("Loading instruments");
      const bank = new InstrumentBank(context, immediateScheduler);
      // The same voices the live engine plays, so a bend, an attack and a note
      // held past its recording all survive into the file.
      const voices = new SampleVoices(context);
      const wanted = audible.map((track) => ({
        program: programFor(voicing.get(track.index) ?? null, track.program),
        percussion: track.percussion,
      }));
      await Promise.all([
        bank.warm(wanted.filter((entry) => entry.percussion)),
        ...wanted
          .filter((entry) => !entry.percussion)
          .map((entry) => voices.load(soundfontFor(entry.program))),
      ]);
      onStage?.("Rendering sound");
      let placed = 0;
      for (const note of song.notes) {
        const track = byIndex.get(note.track);
        if (track === undefined || hiddenTracks.has(note.track)) {
          continue;
        }
        const shaped = voicing.get(note.track) ?? null;
        const startAt = note.start / rate;
        const asked = playedNote(song, voicing, note, startAt, rate);
        const played =
          asked === null
            ? null
            : voices.start(
                asked.instrument,
                asked.played,
                asked.trail,
                context.destination,
              );
        if (played === null) {
          bank
            .voiceFor({
              program: programFor(shaped, track.program),
              percussion: track.percussion,
            })
            ?.start({ ...scheduledNote(note, shaped, rate), time: startAt });
        }
        // A dense song is thousands of nodes built up front; yielding keeps the
        // scheduling from blocking the main thread in one burst.
        placed += 1;
        if (placed % 256 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    },
    { duration: renderDuration(config), sampleRate, channels: 2 },
  );
  return result.audioBuffer;
}

export function audioToWav(buffer: AudioBuffer): Blob {
  return audioBufferToWav16(buffer);
}
