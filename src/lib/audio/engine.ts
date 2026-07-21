import { InstrumentBank, type Voice } from "@/lib/audio/instruments";
import { unmuteWebAudio } from "@/lib/audio/ios-unmute";
import { Transport } from "@/lib/audio/transport";
import {
  programFor,
  type SongVoicing,
  scheduledNote,
  shapingFor,
  velocityFor,
} from "@/lib/audio/voicing";
import type { Song, SongNote } from "@/lib/midi/song";

const lookAhead = 0.2;
const tickInterval = 25;

export class PlaybackEngine {
  private context: AudioContext | null = null;
  private bank: InstrumentBank | null = null;
  private transport: Transport | null = null;
  private song: Song | null = null;
  private autoNotes: ReadonlySet<number> = new Set();
  private voicing: SongVoicing = new Map();
  private cursor = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pendingPosition = 0;
  private pendingRate = 1;

  setSong(song: Song, autoNotes: ReadonlySet<number>): void {
    this.song = song;
    this.autoNotes = autoNotes;
    // Notes inside the look ahead window are already with a voice, so the
    // cursor alone would hand them out a second time.
    this.bank?.stopAll();
    this.resetCursor();
  }

  /** How each track is made to sound. Tracks left out keep the instrument the
   * file named and the sample's own shape. */
  setVoicing(voicing: SongVoicing): void {
    this.voicing = voicing;
    this.bank?.stopAll();
  }

  /** A player who owes only the melody still hears the rest of their part. */
  setAutoNotes(autoNotes: ReadonlySet<number>): void {
    this.autoNotes = autoNotes;
    // Notes inside the look ahead window are already with a voice, so the
    // cursor alone would hand them out a second time.
    this.bank?.stopAll();
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
    unmuteWebAudio();
    if (this.context === null) {
      this.context = new AudioContext({ latencyHint: 0 });
      this.bank = new InstrumentBank(this.context);
      this.transport = new Transport(this.context);
      this.transport.seek(this.pendingPosition);
      this.transport.setRate(this.pendingRate);
    }
    if (this.context.state !== "running") {
      await this.context.resume();
    }
    const transport = this.transport;
    if (transport === null) {
      throw new Error("The transport was not created");
    }
    return transport;
  }

  async warmInstruments(song: Song): Promise<void> {
    await this.wake();
    await this.bank?.warm(
      song.tracks.map((track) => ({
        program: programFor(
          this.voicing.get(track.index) ?? null,
          track.program,
        ),
        percussion: track.percussion,
      })),
    );
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
    this.bank?.stopAll();
  }

  setRate(rate: number): void {
    this.pendingRate = rate;
    this.transport?.setRate(rate);
    this.bank?.stopAll();
    this.resetCursor();
  }

  seek(position: number): void {
    this.pendingPosition = Math.max(0, position);
    this.transport?.seek(this.pendingPosition);
    this.bank?.stopAll();
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
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.bank?.stopAll();
    void this.context?.close();
    this.context = null;
    this.bank = null;
    this.transport = null;
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
      return;
    }
    const notes = this.song.notes;
    const position = transport.position;
    const horizon = position + lookAhead;

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
    const voice = this.voiceFor(note.track);
    if (context === null || voice === null) {
      return false;
    }
    const rate = this.transport?.rate ?? 1;
    const shaped = this.voicing.get(note.track) ?? null;
    voice.start({
      ...scheduledNote(note, shaped, rate),
      time: context.currentTime + Math.max(0, note.start - position) / rate,
    });
    return true;
  }
}
