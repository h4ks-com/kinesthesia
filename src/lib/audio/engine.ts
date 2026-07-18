import { SplendidGrandPiano } from "smplr";
import { Transport } from "@/lib/audio/transport";
import type { Song, SongNote } from "@/lib/midi/song";

const lookAhead = 0.2;
const tickInterval = 25;

export class PlaybackEngine {
  readonly context: AudioContext;
  readonly transport: Transport;
  private readonly piano: SplendidGrandPiano;
  private song: Song | null = null;
  private autoTracks: ReadonlySet<number> = new Set();
  private cursor = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.context = new AudioContext();
    this.piano = new SplendidGrandPiano(this.context);
    this.transport = new Transport(this.context);
  }

  async ready(): Promise<void> {
    await this.piano.load;
  }

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
    return this.transport.position;
  }

  get playing(): boolean {
    return this.transport.playing;
  }

  async play(): Promise<void> {
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    this.transport.start();
    if (this.timer === null) {
      this.timer = setInterval(() => this.pump(), tickInterval);
    }
  }

  pause(): void {
    this.transport.pause();
    this.piano.stop();
  }

  seek(position: number): void {
    this.transport.seek(position);
    this.piano.stop();
    this.resetCursor();
  }

  strike(pitch: number, velocity: number): void {
    if (this.context.state === "suspended") {
      void this.context.resume();
    }
    this.piano.start({ note: pitch, velocity: Math.round(velocity * 127) });
  }

  dispose(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.piano.stop();
    void this.context.close();
  }

  private resetCursor(): void {
    const notes = this.song?.notes ?? [];
    const position = this.transport.position;
    let index = 0;
    while (index < notes.length && (notes[index]?.start ?? 0) < position) {
      index += 1;
    }
    this.cursor = index;
  }

  private pump(): void {
    if (this.song === null || !this.transport.playing) {
      return;
    }
    const notes = this.song.notes;
    const position = this.transport.position;
    const horizon = position + lookAhead;

    while (this.cursor < notes.length) {
      const note = notes[this.cursor];
      if (note === undefined || note.start > horizon) {
        break;
      }
      this.cursor += 1;
      if (this.autoTracks.has(note.track)) {
        this.schedule(note, position);
      }
    }
  }

  private schedule(note: SongNote, position: number): void {
    const when = this.context.currentTime + Math.max(0, note.start - position);
    this.piano.start({
      note: note.pitch,
      time: when,
      duration: Math.max(0.05, note.end - note.start),
      velocity: Math.round(note.velocity * 127),
    });
  }
}
