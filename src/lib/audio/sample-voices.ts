import { soundfontFor } from "@/lib/audio/general-midi";
import {
  closest,
  loadSoundfont,
  type Sample,
  type Samples,
} from "@/lib/audio/soundfont-samples";
import {
  brightnessRange,
  programFor,
  type SongVoicing,
  scheduledNote,
} from "@/lib/audio/voicing";
import {
  bendSemitones,
  type Expression,
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

/** Everything known about one instrument: what has been sent for, the fetch
 * carrying it, and what has arrived so far. */
type Held = {
  readonly asked: Set<number>;
  readonly loading: Promise<Samples | null>;
  ready: Samples | null;
};

/** A voice sounding or about to, kept so it can be silenced. */
type Live = {
  readonly source: AudioBufferSourceNode;
  readonly envelope: GainNode;
  /** Null on a note with no modulation, which never needed an oscillator. */
  readonly lfo: OscillatorNode | null;
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
  /** One record per instrument, so dropping one is a single delete and the
   * three facts about it can never disagree. `asked` is what has been sent for,
   * which outruns `ready` while a fetch is in flight and is what a top-up is
   * measured against. */
  private readonly held = new Map<string, Held>();
  private readonly live = new Set<Live>();

  constructor(context: BaseAudioContext) {
    this.context = context;
  }

  /** Null where the recordings could not be had, which the caller answers by
   * falling back to the sampler. A failure is forgotten rather than kept, so a
   * later song can try again over a network that has come back. */
  load(
    instrument: string,
    pitches: ReadonlySet<number>,
  ): Promise<Samples | null> {
    const record = this.held.get(instrument) ?? null;
    const missing = new Set(
      [...pitches].filter((pitch) => record?.asked.has(pitch) !== true),
    );
    if (record !== null && missing.size === 0) {
      return record.loading;
    }
    const asked = record?.asked ?? new Set<number>();
    for (const pitch of missing) {
      asked.add(pitch);
    }
    // Chained behind whatever is already in flight, so two songs asking at once
    // cannot both decide the same recordings are missing.
    const loading = (record?.loading ?? Promise.resolve(null))
      .then(() => loadSoundfont(this.context, instrument, missing))
      .catch(() => null)
      .then((arrived) => this.merge(instrument, arrived, missing));
    this.held.set(instrument, { asked, loading, ready: record?.ready ?? null });
    return loading;
  }

  /** Folds newly decoded recordings in beside the ones already here. A failure
   * is forgotten rather than kept, so a later song can try again over a network
   * that has come back. */
  private merge(
    instrument: string,
    arrived: Samples | null,
    wanted: ReadonlySet<number>,
  ): Samples | null {
    // Let go of while it was still arriving: the song that wanted it is gone,
    // so holding it would put back exactly what was just dropped.
    const record = this.held.get(instrument);
    if (record === undefined) {
      return null;
    }
    if (arrived === null) {
      // A failure is forgotten rather than kept, so a later song can try again
      // over a network that has come back. The pitches this attempt claimed go
      // back too, or a single dropped request would leave them answered by a
      // neighbouring recording for the rest of the session.
      for (const pitch of wanted) {
        record.asked.delete(pitch);
      }
      if (record.ready === null) {
        this.held.delete(instrument);
      }
      return record.ready;
    }
    const byPitch = record.ready?.byPitch ?? new Map<number, Sample>();
    for (const [pitch, sample] of arrived.byPitch) {
      byPitch.set(pitch, sample);
    }
    record.ready = {
      byPitch,
      pitches: [...byPitch.keys()].sort((first, next) => first - next),
    };
    return record.ready;
  }

  /** Lets go of every instrument outside this set. The recordings outlive the
   * song that wanted them, which is what makes a second song cheap, but a
   * session that wanders through a dozen files would otherwise hold every
   * instrument it ever touched: near forty megabytes decoded each. What is
   * shared with the next song survives; what it never asks for does not.
   *
   * Buffers still feeding a sounding note are held by their source nodes, so
   * dropping them here never cuts anything off. */
  retain(instruments: ReadonlySet<string>): void {
    for (const instrument of [...this.held.keys()]) {
      if (!instruments.has(instrument)) {
        this.held.delete(instrument);
      }
    }
  }

  /** Plays one note. Returns the time it falls silent, or null where the
   * recordings are not here yet and the caller should fall back. */
  start(
    instrument: string,
    note: PlayedNote,
    trail: ExpressionTrail | null,
    destination: AudioNode,
  ): number | null {
    const samples = this.held.get(instrument)?.ready ?? null;
    if (samples === null) {
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

    // Velocity is folded into the envelope rather than given a gain of its own.
    // A dense song is tens of thousands of these, so a node saved on every note
    // is worth more than the tidier graph.
    const peak =
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
      envelope.gain.linearRampToValueAtTime(peak, opened);
    } else {
      envelope.gain.setValueAtTime(peak, note.time);
    }
    envelope.gain.setValueAtTime(peak, Math.max(opened, releaseAt));
    envelope.gain.linearRampToValueAtTime(0, silent);

    let tail: AudioNode = source;
    if (note.lpfCutoffHz < brightnessRange.max) {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = note.lpfCutoffHz;
      source.connect(filter);
      tail = filter;
    }
    tail.connect(envelope);
    envelope.connect(destination);

    // Anything connected to detune makes the source work out its playback rate
    // sample by sample, and an oscillator per note is a voice per note on top of
    // that. A note whose wheels never move gets neither, which is most of them.
    const wheels = trail === null ? null : wheelsIn(note, trail);
    let lfo: OscillatorNode | null = null;
    if (wheels !== null) {
      writeBend(source.detune, base, note, wheels);
      if (wheels.vibrato) {
        lfo = context.createOscillator();
        lfo.frequency.value = vibratoHz;
        const depth = context.createGain();
        writeDepth(depth.gain, note, wheels);
        lfo.connect(depth);
        depth.connect(source.detune);
        lfo.start(note.time);
        lfo.stop(silent);
      }
    }

    source.start(note.time);
    source.stop(silent);

    const held: Live = { source, envelope, lfo };
    this.live.add(held);
    source.onended = () => {
      this.live.delete(held);
      envelope.disconnect();
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
      held.lfo?.stop(until);
    }
  }
}

/** What the wheels do across one note. Null where neither moved, which is the
 * answer for most notes even on a track that bends somewhere. */
type Wheels = {
  readonly opening: Expression;
  readonly steps: readonly (Expression & { readonly at: number })[];
  readonly vibrato: boolean;
};

function wheelsIn(note: PlayedNote, trail: ExpressionTrail): Wheels | null {
  const opening = trail.at(note.track, note.from);
  const steps = trail.between(note.track, note.from, note.to);
  const vibrato = opening.depth > 0 || steps.some((step) => step.depth > 0);
  const bent = opening.bend !== 0 || steps.some((step) => step.bend !== 0);
  return vibrato || bent ? { opening, steps, vibrato } : null;
}

/** Every wheel movement inside the note becomes a step, ramped so it glides
 * rather than clicks. */
function writeBend(
  detune: AudioParam,
  base: number,
  note: PlayedNote,
  wheels: Wheels,
): void {
  detune.setValueAtTime(
    base + wheels.opening.bend * bendSemitones * centsPerSemitone,
    note.time,
  );
  for (const step of insideNote(note, wheels)) {
    detune.linearRampToValueAtTime(
      base + step.bend * bendSemitones * centsPerSemitone,
      step.when + glide,
    );
  }
}

function writeDepth(depth: AudioParam, note: PlayedNote, wheels: Wheels): void {
  depth.setValueAtTime(wheels.opening.depth * vibratoCents, note.time);
  for (const step of insideNote(note, wheels)) {
    depth.linearRampToValueAtTime(step.depth * vibratoCents, step.when + glide);
  }
}

function* insideNote(
  note: PlayedNote,
  wheels: Wheels,
): Generator<{ when: number; bend: number; depth: number }> {
  const ends = note.time + note.duration;
  for (const step of wheels.steps) {
    const when = note.time + (step.at - note.from) / note.rate;
    if (when > note.time && when < ends) {
      yield { when, bend: step.bend, depth: step.depth };
    }
  }
}

/** Which recordings each instrument has to bring for this song: the pitches its
 * tracks actually play, and nothing else. Hidden tracks are left out, since a
 * part nobody hears still costs its whole instrument to load. */
export function instrumentPitches(
  song: Song,
  voicing: SongVoicing,
  hiddenTracks: ReadonlySet<number>,
): Map<string, Set<number>> {
  const playing = new Map<number, string>();
  for (const track of song.tracks) {
    if (!track.percussion && !hiddenTracks.has(track.index)) {
      playing.set(
        track.index,
        soundfontFor(
          programFor(voicing.get(track.index) ?? null, track.program),
        ),
      );
    }
  }
  const wanted = new Map<string, Set<number>>();
  for (const note of song.notes) {
    const instrument = playing.get(note.track);
    if (instrument === undefined) {
      continue;
    }
    const pitches = wanted.get(instrument) ?? new Set<number>();
    pitches.add(note.pitch);
    wanted.set(instrument, pitches);
  }
  return wanted;
}
