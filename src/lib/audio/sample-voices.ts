import { soundfontFor } from "@/lib/audio/general-midi";
import { loadSoundfont, type Samples } from "@/lib/audio/soundfont-samples";
import {
  brightnessRange,
  programFor,
  type SongVoicing,
  scheduledNote,
} from "@/lib/audio/voicing";
import {
  bendSemitones,
  type ExpressionTrail,
  vibratoHz,
} from "@/lib/midi/expression";
import type { Song, SongNote } from "@/lib/midi/song";

/** Melodic notes, each on a voice held from its start to its silence, so a
 * bend, an envelope and a pause can all reach a note already sounding. The
 * recordings are the ones the sampler loads, from the same soundfont. */

/** How far full modulation swings the pitch. Deep enough to hear, shallow
 * enough to read as vibrato rather than a second bend. */
const vibratoCents = 50;
/** Wheel movement arrives as steps; ramping between them over this long stops
 * each step being a click without smearing the shape. */
const glide = 0.012;

/** The sampler lifts its soundfonts by this much, and its output stage takes
 * the whole instrument back down to a default volume. A voice going straight
 * out carries both, so it sits at the level the rest of the song sits at. */
const soundfontGain = 5;
const defaultVolume = 100;
/** What a note fades over when nothing asks for longer, so the end of a
 * recording is never a step. */
export const defaultRelease = 0.3;
/** Silencing still takes a moment: cutting a waveform mid cycle is a click, so
 * a pause fades over this instead. */
const panicFade = 0.012;

/** One hundred cents to the semitone. */
const centsPerSemitone = 100;

export type PlayedNote = {
  readonly pitch: number;
  /** As written, 0 to 127. */
  readonly velocity: number;
  /** Context time the note sounds at. */
  readonly time: number;
  /** Context seconds until the key is let go. */
  readonly duration: number;
  readonly ampAttack: number;
  readonly ampRelease: number;
  readonly lpfCutoffHz: number;
  /** Song seconds the note covers, for reading the wheels. */
  readonly from: number;
  readonly to: number;
  readonly track: number;
  /** Playback speed, so song seconds become context seconds. */
  readonly rate: number;
};

/** A voice sounding or about to, kept so it can be silenced. */
type Live = {
  readonly source: AudioBufferSourceNode;
  readonly envelope: GainNode;
  readonly lfo: OscillatorNode;
};

/** The sampler's own curve, so both sound equally loud. */
function velocityGain(velocity: number): number {
  return (velocity * velocity) / 16129;
}

/** What a melodic note asks of the voice, from the song and the shaping the
 * player chose. The live engine and the offline render both build it here, so
 * an export cannot drift from what was heard. Null where the drums own the note
 * and the sampler should take it. */
export function playedNote(
  song: Song,
  voicing: SongVoicing,
  note: SongNote,
  startAt: number,
  rate: number,
): {
  instrument: string;
  played: PlayedNote;
  trail: ExpressionTrail | null;
} | null {
  const definition = song.tracks.find((entry) => entry.index === note.track);
  if (definition === undefined || definition.percussion) {
    return null;
  }
  const shaped = voicing.get(note.track) ?? null;
  const options = scheduledNote(note, shaped, rate);
  const trail = song.expression;
  return {
    instrument: soundfontFor(programFor(shaped, definition.program)),
    played: {
      pitch: note.pitch,
      velocity: options.velocity,
      time: startAt,
      duration: options.duration,
      ampAttack: options.ampAttack ?? 0,
      ampRelease: options.ampRelease ?? defaultRelease,
      lpfCutoffHz: options.lpfCutoffHz ?? brightnessRange.max,
      from: note.start,
      to: note.release,
      track: note.track,
      rate,
    },
    trail: trail.touched(note.track) ? trail : null,
  };
}

export class SampleVoices {
  private readonly context: BaseAudioContext;
  private readonly loading = new Map<string, Promise<Samples | null>>();
  private readonly ready = new Map<string, Samples>();
  private readonly live = new Set<Live>();

  constructor(context: BaseAudioContext) {
    this.context = context;
  }

  /** Null where the recordings could not be had, which the caller answers by
   * falling back to the sampler. A failure is forgotten rather than kept, so a
   * later song can try again over a network that has come back. */
  load(instrument: string): Promise<Samples | null> {
    const known = this.loading.get(instrument);
    if (known !== undefined) {
      return known;
    }
    const started = loadSoundfont(this.context, instrument)
      .catch(() => null)
      .then((samples) => {
        if (samples === null) {
          this.loading.delete(instrument);
        } else {
          this.ready.set(instrument, samples);
        }
        return samples;
      });
    this.loading.set(instrument, started);
    return started;
  }

  /** Plays one note. Returns the time it falls silent, or null where the
   * recordings are not here yet and the caller should fall back. */
  start(
    instrument: string,
    note: PlayedNote,
    trail: ExpressionTrail | null,
    destination: AudioNode,
  ): number | null {
    const samples = this.ready.get(instrument);
    if (samples === undefined) {
      return null;
    }
    const nearest = closest(samples.pitches, note.pitch);
    const sample = nearest === null ? undefined : samples.byPitch.get(nearest);
    if (nearest === null || sample === undefined) {
      return null;
    }

    const context = this.context;
    const source = context.createBufferSource();
    source.buffer = sample.buffer;
    const base = (note.pitch - nearest) * centsPerSemitone;
    source.detune.value = base;

    const releaseAt = note.time + note.duration;
    const silent = releaseAt + note.ampRelease;
    // A recording that would run out before the note is let go has to loop, or
    // it stops partway through at whatever volume it had reached.
    if (
      note.time + sample.buffer.duration < silent &&
      sample.sustained &&
      sample.buffer.duration > 0
    ) {
      source.loop = true;
      source.loopStart = sample.loopStart;
      source.loopEnd = sample.loopEnd;
    }

    const level = context.createGain();
    level.gain.value =
      velocityGain(note.velocity) * soundfontGain * velocityGain(defaultVolume);

    const envelope = context.createGain();
    // Automation is played in time order whatever order it is written in, so an
    // attack reaching past the note has to be cut to fit rather than left to
    // sort behind the release, which would hold the note silent and then step
    // it to full.
    const attack = Math.min(note.ampAttack, note.duration);
    const opened = note.time + attack;
    if (attack > 0) {
      envelope.gain.setValueAtTime(0, note.time);
      envelope.gain.linearRampToValueAtTime(1, opened);
    } else {
      envelope.gain.setValueAtTime(1, note.time);
    }
    envelope.gain.setValueAtTime(1, Math.max(opened, releaseAt));
    envelope.gain.linearRampToValueAtTime(0, silent);

    let tail: AudioNode = source;
    if (note.lpfCutoffHz < brightnessRange.max) {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = note.lpfCutoffHz;
      source.connect(filter);
      tail = filter;
    }
    tail.connect(level);
    level.connect(envelope);
    envelope.connect(destination);

    const lfo = context.createOscillator();
    lfo.frequency.value = vibratoHz;
    const depth = context.createGain();
    depth.gain.value = 0;
    lfo.connect(depth);
    depth.connect(source.detune);
    if (trail !== null) {
      writeWheels(source.detune, depth.gain, base, note, trail);
    }

    source.start(note.time);
    source.stop(silent);
    lfo.start(note.time);
    lfo.stop(silent);

    const held: Live = { source, envelope, lfo };
    this.live.add(held);
    source.onended = () => {
      this.live.delete(held);
      envelope.disconnect();
      level.disconnect();
    };
    return silent;
  }

  /** Silences everything at once, which is what a pause has to do: a note held
   * for fifteen seconds would otherwise carry on over a stopped song. Faded
   * rather than cut, because stopping a waveform mid cycle is a click. */
  stopAll(): void {
    const now = this.context.currentTime;
    const until = now + panicFade;
    for (const held of this.live) {
      const gain = held.envelope.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(0, until);
      held.source.stop(until);
      held.lfo.stop(until);
    }
  }
}

/** Every wheel movement inside the note becomes a step, ramped so it glides
 * rather than clicks. */
function writeWheels(
  detune: AudioParam,
  depth: AudioParam,
  base: number,
  note: PlayedNote,
  trail: ExpressionTrail,
): void {
  const ends = note.time + note.duration;
  const opening = trail.at(note.track, note.from);
  detune.setValueAtTime(
    base + opening.bend * bendSemitones * centsPerSemitone,
    note.time,
  );
  depth.setValueAtTime(opening.depth * vibratoCents, note.time);

  for (const sample of trail.between(note.track, note.from, note.to)) {
    const when = note.time + (sample.at - note.from) / note.rate;
    if (when <= note.time || when >= ends) {
      continue;
    }
    detune.linearRampToValueAtTime(
      base + sample.bend * bendSemitones * centsPerSemitone,
      when + glide,
    );
    depth.linearRampToValueAtTime(sample.depth * vibratoCents, when + glide);
  }
}

function closest(pitches: readonly number[], pitch: number): number | null {
  if (pitches.length === 0) {
    return null;
  }
  let best = pitches[0] ?? null;
  let gap = Number.POSITIVE_INFINITY;
  for (const candidate of pitches) {
    const distance = Math.abs(candidate - pitch);
    if (distance < gap) {
      gap = distance;
      best = candidate;
    }
  }
  return best;
}
