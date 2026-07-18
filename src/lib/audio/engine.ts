import { InstrumentBank, type Voice } from "@/lib/audio/instruments";
import { Transport } from "@/lib/audio/transport";
import type { Song, SongNote } from "@/lib/midi/song";

const lookAhead = 0.2;
const tickInterval = 25;

export class PlaybackEngine {
  private context: AudioContext | null = null;
  private bank: InstrumentBank | null = null;
  private transport: Transport | null = null;
  private song: Song | null = null;
  private autoTracks: ReadonlySet<number> = new Set();
  private cursor = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pendingPosition = 0;
  private pendingRate = 1;

  setSong(song: Song, autoTracks: ReadonlySet<number>): void {
    this.song = song;
    this.autoTracks = autoTracks;
    this.resetCursor();
  }

  setAutoTracks(autoTracks: ReadonlySet<number>): void {
    this.autoTracks = autoTracks;
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
    if (this.context === null) {
      this.context = new AudioContext();
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
        program: track.program,
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

  async strike(pitch: number, velocity: number, track: number): Promise<void> {
    await this.wake();
    this.voiceFor(track)?.start({
      note: pitch,
      velocity: Math.round(velocity * 127),
    });
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
      program: definition.program,
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
      if (!this.autoTracks.has(note.track)) {
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
    voice.start({
      note: note.pitch,
      time: context.currentTime + Math.max(0, note.start - position) / rate,
      duration: Math.max(0.05, (note.end - note.start) / rate),
      velocity: Math.round(note.velocity * 127),
    });
    return true;
  }
}
