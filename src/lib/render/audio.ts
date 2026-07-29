import {
  audioBufferToWav16,
  type NoteEvent,
  type Scheduler,
  type StopFn,
} from "smplr";
import { soundfontFor } from "@/lib/audio/general-midi";
import { InstrumentBank } from "@/lib/audio/instruments";
import {
  instrumentPitches,
  playedNote,
  SampleVoices,
} from "@/lib/audio/sample-voices";
import { programFor, scheduledNote } from "@/lib/audio/voicing";
import type { RenderConfig } from "@/lib/render/export";
import { renderDuration } from "@/lib/render/export";

/** What the soundfont recordings are cut at. Rendering at any other rate resamples
 * every voice for the whole song on top of the shift its pitch already asks for. */
const sampleRate = 44100;

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

/** Told which step is running and how far through it is, so a caller can show
 * a real figure rather than a spinner. */
export type RenderStep = (stage: string, progress: number | null) => void;

/** How far ahead of the render notes are put in place. Long enough that every
 * note is scheduled well before it sounds, short enough that the graph only
 * ever holds a passage rather than a song. */
const lookAhead = 2;

/** Schedules every note offline through the same voicing the live engine uses,
 * so the export sounds like what plays on screen. */
export async function renderSongAudio(
  config: RenderConfig,
  onStep?: RenderStep,
): Promise<AudioBuffer> {
  const { song, voicing, hiddenTracks, rate } = config;
  const byIndex = new Map(song.tracks.map((track) => [track.index, track]));
  const audible = song.tracks.filter((track) => !hiddenTracks.has(track.index));
  const duration = renderDuration(config);
  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.ceil(duration * sampleRate),
    sampleRate,
  });

  onStep?.("Loading instruments", null);
  const bank = new InstrumentBank(context, immediateScheduler);
  // The same voices the live engine plays, so a bend, an attack and a note held
  // past its recording all survive into the file.
  const voices = new SampleVoices(context);
  const wanted = audible.map((track) => ({
    program: programFor(voicing.get(track.index) ?? null, track.program),
    percussion: track.percussion,
  }));
  await Promise.all([
    bank.warm(wanted.filter((entry) => entry.percussion)),
    ...[...instrumentPitches(song, voicing, hiddenTracks)].map(
      ([instrument, pitches]) => voices.load(instrument, pitches),
    ),
  ]);

  const ordered = [...song.notes].sort(
    (first, next) => first.start - next.start,
  );
  let placed = 0;
  const placeUntil = (until: number): void => {
    while (placed < ordered.length) {
      const note = ordered[placed];
      if (note === undefined || note.start / rate >= until) {
        return;
      }
      placed += 1;
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
    }
  };

  onStep?.("Rendering sound", 0);
  placeUntil(lookAhead);
  feedWhilePlaying(context, duration, placeUntil, onStep);
  return context.startRendering();
}

/** Hands the render its notes a slice at a time, and reads back where it has
 * got to while it is stopped anyway.
 *
 * A note scheduled early is not free: the graph walks every node it holds on
 * every block it renders, whether or not that node has started, so building a
 * whole song up front makes the cost the note count times the song length
 * rather than the notes actually sounding. Feeding it keeps the graph the size
 * of the passage.
 *
 * A stop that cannot be booked falls back to placing the rest at once, which is
 * slow but complete; a stop that failed to resume would hang the render, so
 * resuming is the last thing each one does. */
function feedWhilePlaying(
  context: OfflineAudioContext,
  duration: number,
  placeUntil: (until: number) => void,
  onStep?: RenderStep,
): void {
  const quantum = 128 / context.sampleRate;
  for (let stop = 1; stop * lookAhead < duration; stop += 1) {
    const at = Math.floor((stop * lookAhead) / quantum) * quantum;
    if (at <= 0 || at >= duration) {
      continue;
    }
    context
      .suspend(at)
      .then(() => {
        placeUntil(at + lookAhead);
        onStep?.("Rendering sound", at / duration);
        void context.resume();
      })
      .catch(() => placeUntil(duration + lookAhead));
  }
}

export function audioToWav(buffer: AudioBuffer): Blob {
  return audioBufferToWav16(buffer);
}
