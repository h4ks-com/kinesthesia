import { audioBufferToWav16, renderOffline } from "smplr";
import { InstrumentBank } from "@/lib/audio/instruments";
import { shapingFor, velocityFor } from "@/lib/audio/voicing";
import type { RenderConfig } from "@/lib/render/export";
import { renderDuration } from "@/lib/render/export";

const sampleRate = 48000;

/** Renders the song's sound offline, as fast as the CPU allows, scheduling
 * every note with the same voicing the live engine uses so the export sounds
 * like what plays on screen. */
export async function renderSongAudio(
  config: RenderConfig,
): Promise<AudioBuffer> {
  const { song, voicing, hiddenTracks, rate } = config;
  const programs = new Map(
    song.tracks.map((track) => [track.index, track.program]),
  );
  const percussion = new Map(
    song.tracks.map((track) => [track.index, track.percussion]),
  );
  const audible = song.tracks.filter((track) => !hiddenTracks.has(track.index));

  const result = await renderOffline(
    async (context) => {
      const bank = new InstrumentBank(context);
      await bank.warm(
        audible.map((track) => ({
          program: voicing.get(track.index)?.program ?? track.program,
          percussion: track.percussion,
        })),
      );
      for (const note of song.notes) {
        if (hiddenTracks.has(note.track)) {
          continue;
        }
        const shaped = voicing.get(note.track) ?? null;
        const voice = bank.voiceFor({
          program: shaped?.program ?? programs.get(note.track) ?? 0,
          percussion: percussion.get(note.track) ?? false,
        });
        voice?.start({
          note: note.pitch,
          time: note.start / rate,
          duration: Math.max(0.05, (note.end - note.start) / rate),
          velocity: velocityFor(note.velocity, shaped),
          ...shapingFor(shaped),
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
