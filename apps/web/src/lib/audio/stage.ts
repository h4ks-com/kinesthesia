import { InstrumentBank } from "@/lib/audio/instruments";
import { unmuteWebAudio } from "@/lib/audio/ios-unmute";
import { SampleVoices } from "@/lib/audio/sample-voices";

/** The audio device and everything decoded onto it, held for as long as the
 * page lives.
 *
 * One context, never a second: each one reserves its own realtime audio thread,
 * and two competing for a busy machine is heard as dropouts. Browsers also cap
 * how many a page may hold, so building one per song walks into that ceiling.
 *
 * The recordings ride along for the same reason. An instrument is around a
 * hundred megabytes decoded, so a stage per song both re-fetches what it
 * already had and holds several copies at once. */
export type AudioStage = {
  readonly context: AudioContext;
  readonly bank: InstrumentBank;
  readonly voices: SampleVoices;
};

let stage: AudioStage | null = null;

/** The stage as it is, or null before anything has asked to make sound. Reading
 * it never creates a context, so nothing here runs during render. */
export function currentStage(): AudioStage | null {
  return stage;
}

/** The stage, built but not started. Opening the audio device costs the better
 * part of a second, and it may be done at any time, so anything that only needs
 * somewhere to decode into asks for this and leaves the first play that much
 * shorter. */
export function buildStage(): AudioStage {
  if (stage === null) {
    const context = new AudioContext({ latencyHint: 0 });
    stage = {
      context,
      bank: new InstrumentBank(context),
      voices: new SampleVoices(context),
    };
  }
  return stage;
}

/** The stage, running. Starting it is the part a gesture is required for:
 * Firefox parks the promise of a resume it did not allow and never settles it,
 * so calling this outside a gesture hangs whatever awaits it, for good. */
export async function wakeStage(): Promise<AudioStage> {
  unmuteWebAudio();
  const built = buildStage();
  if (built.context.state !== "running") {
    await built.context.resume();
  }
  return built;
}

/** Silences everything the stage is sounding, without taking the device down.
 * A player leaving the page ends its own notes; the next one to arrive wants
 * the context and the recordings still there. */
export function silenceStage(): void {
  stage?.bank.stopAll();
  stage?.voices.stopAll();
}
