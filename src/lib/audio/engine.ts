import { InstrumentBank, type Voice } from "@/lib/audio/instruments";
import { unmuteWebAudio } from "@/lib/audio/ios-unmute";
import {
  instrumentPitches,
  playedNote,
  SampleVoices,
} from "@/lib/audio/sample-voices";
import { Transport } from "@/lib/audio/transport";
import {
  programFor,
  type SongVoicing,
  scheduledNote,
  shapingFor,
  velocityFor,
} from "@/lib/audio/voicing";
import type { Song, SongNote } from "@/lib/midi/song";

/** Thrown when a press lands on an engine the player has already replaced, so
 * the owner can carry it to the one that took over. */
export class EngineReplaced extends Error {
  constructor() {
    super("The engine was replaced");
    this.name = "EngineReplaced";
  }
}

/** Every track counts: the engine plays the whole song, hidden or not. */
const noTracks: ReadonlySet<number> = new Set();

const lookAhead = 0.2;
const tickInterval = 25;
/** The polyphony ceiling adapts to the machine. Each voice is a source node
 * built on the main thread, so the count a machine holds while keeping time is
 * its own. The ceiling backs off the moment a tick lands late and climbs only
 * while a passage presses against it, so headroom is earned by real density. An
 * ordinary song sits below the floor, untouched. */
const minVoices = 48;
const maxVoices = 256;
const startVoices = 96;
const growStep = 8;
/** Climb only while within this of the ceiling, so headroom is earned by a
 * passage that is actually dense. */
const growSlack = 8;
/** A tick this much past its interval means the main thread is behind, so the
 * ceiling drops; comfortably inside it means there is room to climb. */
const lateTick = tickInterval * 1.8;
const onTimeTick = tickInterval * 1.4;

/** The ceiling after a pump that ran `gap` ms since the previous one with
 * `active` voices sounding. */
export function adaptedVoiceLimit(
  current: number,
  gap: number,
  active: number,
): number {
  if (gap > lateTick) {
    return Math.max(minVoices, Math.round(current * 0.7));
  }
  if (gap < onTimeTick && active >= current - growSlack) {
    return Math.min(maxVoices, current + growStep);
  }
  return current;
}

export class PlaybackEngine {
  private context: AudioContext | null = null;
  private bank: InstrumentBank | null = null;
  /** Every melodic note is played here: the sampler cannot bend a sounding
   * note, hold one past the end of its recording, or fade one in. */
  private voices: SampleVoices | null = null;
  private transport: Transport | null = null;
  private song: Song | null = null;
  private autoNotes: ReadonlySet<number> = new Set();
  private voicing: SongVoicing = new Map();
  private cursor = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pendingPosition = 0;
  private pendingRate = 1;
  /** Context times at which each scheduled voice falls silent, so the polyphony
   * ceiling counts the voices still sounding. */
  private voiceEnds: number[] = [];
  /** The live polyphony ceiling, adapted to how well this machine keeps time. */
  private voiceLimit = startVoices;
  /** Wall-clock time of the last pump, to measure how late the next one runs.
   * Zero between runs, so a pause does not read as the machine falling behind. */
  private lastPumpAt = 0;
  /** Set once and never cleared: an engine the player has replaced must never
   * come back, whatever was still awaiting inside it. */
  private disposed = false;

  setSong(song: Song, autoNotes: ReadonlySet<number>): void {
    this.song = song;
    this.autoNotes = autoNotes;
    // Notes inside the look ahead window are already with a voice, so the
    // cursor alone would hand them out a second time.
    this.stopVoices();
    this.resetCursor();
  }

  /** Swaps the voices in without cutting what is sounding, for a live setup
   * where parts appear mid-play and stopping every ringing note would be wrong. */
  setTracks(song: Song): void {
    this.song = song;
  }

  /** How each track is made to sound. Tracks left out keep the instrument the
   * file named and the sample's own shape. */
  setVoicing(voicing: SongVoicing): void {
    this.voicing = voicing;
    this.stopVoices();
    // A track handed a new instrument has none of its recordings yet, and would
    // otherwise drop back to the sampler until the next play.
    const song = this.song;
    if (song !== null) {
      for (const [instrument, pitches] of instrumentPitches(
        song,
        voicing,
        noTracks,
      )) {
        void this.voices?.load(instrument, pitches);
      }
    }
  }

  /** A player who owes only the melody still hears the rest of their part. */
  setAutoNotes(autoNotes: ReadonlySet<number>): void {
    this.autoNotes = autoNotes;
    // Notes inside the look ahead window are already with a voice, so the
    // cursor alone would hand them out a second time.
    this.stopVoices();
    this.resetCursor();
  }

  get position(): number {
    return this.transport?.position ?? this.pendingPosition;
  }

  get playing(): boolean {
    return this.transport?.playing ?? false;
  }

  // Browsers only allow an AudioContext to make sound if it was created or
  // resumed inside a user gesture, so every entry point routes through here.
  private async wake(): Promise<Transport> {
    if (this.disposed) {
      throw new EngineReplaced();
    }
    unmuteWebAudio();
    if (this.context === null) {
      this.context = new AudioContext({ latencyHint: 0 });
      this.bank = new InstrumentBank(this.context);
      this.voices = new SampleVoices(this.context);
      this.transport = new Transport(this.context);
      this.transport.seek(this.pendingPosition);
      this.transport.setRate(this.pendingRate);
    }
    if (this.context.state !== "running") {
      await this.context.resume();
    }
    // Resuming yields, and a player rebuild disposes the engine mid-await. A
    // disposed engine is nobody's: building it again would sound a song the
    // page has moved on from, on a context nothing is left to close.
    const transport = this.transport;
    if (transport === null || this.disposed) {
      throw new EngineReplaced();
    }
    return transport;
  }

  async warmInstruments(song: Song): Promise<void> {
    await this.wake();
    const wanted = song.tracks.map((track) => ({
      track: track.index,
      program: programFor(this.voicing.get(track.index) ?? null, track.program),
      percussion: track.percussion,
    }));
    // The sampler owns the drums. Warming it for the melodic tracks as well
    // would fetch and decode a second copy of every instrument the voice player
    // is about to own, so those are left to its own lazy path, which only runs
    // if the recordings never arrive.
    await Promise.all([
      this.bank?.warm(wanted.filter((entry) => entry.percussion)),
      ...[...instrumentPitches(song, this.voicing, noTracks)].map(
        ([instrument, pitches]) => this.voices?.load(instrument, pitches),
      ),
    ]);
  }

  async play(): Promise<void> {
    const transport = await this.wake();
    transport.start();
    if (this.timer === null) {
      this.timer = setInterval(() => this.pump(), tickInterval);
    }
  }

  pause(): void {
    this.transport?.pause();
    this.stopVoices();
  }

  setRate(rate: number): void {
    this.pendingRate = rate;
    this.transport?.setRate(rate);
    this.stopVoices();
    this.resetCursor();
  }

  seek(position: number): void {
    this.pendingPosition = Math.max(0, position);
    this.transport?.seek(this.pendingPosition);
    this.stopVoices();
    this.resetCursor();
  }

  strike(pitch: number, velocity: number, track: number): void {
    const shaped = this.voicing.get(track) ?? null;
    const options = {
      note: pitch,
      velocity: velocityFor(velocity, shaped),
      ...shapingFor(shaped),
    };
    if (this.context === null || this.context.state !== "running") {
      void this.wake().then(() => this.voiceFor(track)?.start(options));
      return;
    }
    this.voiceFor(track)?.start(options);
  }

  /** A live key ends when it is lifted, the same as a scheduled note ends at
   * its written length, so a tap no longer rings for the sample's full run. */
  release(pitch: number, track: number): void {
    this.voiceFor(track)?.stop(pitch);
  }

  /** What the browser adds between a scheduled note and the speaker. Judging
   * subtracts it so a player who sounds on time also scores on time. */
  get outputLatency(): number {
    const context = this.context;
    if (context === null) {
      return 0;
    }
    return context.baseLatency + (context.outputLatency ?? 0);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stopVoices();
    void this.context?.close();
    this.context = null;
    this.bank = null;
    this.voices = null;
    this.transport = null;
  }

  private stopVoices(): void {
    this.bank?.stopAll();
    this.voices?.stopAll();
    this.voiceEnds.length = 0;
  }

  private adaptVoiceLimit(): void {
    const wall = performance.now();
    const previous = this.lastPumpAt;
    this.lastPumpAt = wall;
    if (previous === 0) {
      return;
    }
    this.voiceLimit = adaptedVoiceLimit(
      this.voiceLimit,
      wall - previous,
      this.voiceEnds.length,
    );
  }

  private voiceFor(track: number): Voice | null {
    const definition = this.song?.tracks.find((entry) => entry.index === track);
    if (definition === undefined || this.bank === null) {
      return null;
    }
    return this.bank.voiceFor({
      program: programFor(this.voicing.get(track) ?? null, definition.program),
      percussion: definition.percussion,
    });
  }

  private resetCursor(): void {
    const notes = this.song?.notes ?? [];
    const position = this.position;
    let index = 0;
    while (index < notes.length && (notes[index]?.start ?? 0) < position) {
      index += 1;
    }
    this.cursor = index;
  }

  private pump(): void {
    const transport = this.transport;
    if (this.song === null || transport === null || !transport.playing) {
      this.lastPumpAt = 0;
      return;
    }
    const notes = this.song.notes;
    const position = transport.position;
    const horizon = position + lookAhead;

    if (this.context !== null) {
      const now = this.context.currentTime;
      this.voiceEnds = this.voiceEnds.filter((end) => end > now);
    }
    this.adaptVoiceLimit();

    while (this.cursor < notes.length) {
      const note = notes[this.cursor];
      if (note === undefined || note.start > horizon) {
        break;
      }
      if (!this.autoNotes.has(note.id)) {
        this.cursor += 1;
        continue;
      }
      // Holding the cursor while an instrument is still downloading keeps a
      // cold song from silently losing its opening notes.
      if (!this.schedule(note, position) && note.start >= position) {
        break;
      }
      this.cursor += 1;
    }
  }

  private schedule(note: SongNote, position: number): boolean {
    const context = this.context;
    if (context === null) {
      return false;
    }
    // A dense passage cues more notes than can be heard apart; past the ceiling
    // the extras are dropped to spare the audio thread, and the cursor advances
    // so a drop is final.
    if (this.voiceEnds.length >= this.voiceLimit) {
      return true;
    }
    const rate = this.transport?.rate ?? 1;
    const shaped = this.voicing.get(note.track) ?? null;
    const startAt =
      context.currentTime + Math.max(0, note.start - position) / rate;
    const silent = this.startVoice(note, startAt, rate);
    if (silent !== null) {
      this.voiceEnds.push(silent);
      return true;
    }
    // Only the drums, and anything the recordings never arrived for, reach here.
    const voice = this.voiceFor(note.track);
    if (voice === null) {
      return false;
    }
    voice.start({ ...scheduledNote(note, shaped, rate), time: startAt });
    this.voiceEnds.push(startAt + (note.release - note.start) / rate);
    return true;
  }

  /** Null where the sampler should take the note instead. */
  private startVoice(
    note: SongNote,
    startAt: number,
    rate: number,
  ): number | null {
    const voices = this.voices;
    const song = this.song;
    const context = this.context;
    if (voices === null || song === null || context === null) {
      return null;
    }
    const asked = playedNote(song, this.voicing, note, startAt, rate);
    return asked === null
      ? null
      : voices.start(
          asked.instrument,
          asked.played,
          asked.trail,
          context.destination,
        );
  }
}
