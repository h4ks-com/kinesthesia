/** Seconds on a clock that only ever moves forward. In the player it is the
 * audio device's, so the picture and the notes are measured against the same
 * thing they were scheduled against and cannot drift apart. */
export type Clock = () => number;

/** Where the song has got to. Everything here is arithmetic over one reading of
 * the clock, so a test can drive the position by hand and assert it without a
 * sound device. */
export class Transport {
  private readonly now: Clock;
  private offset = 0;
  private startedAt = 0;
  private running = false;
  private speed = 1;

  constructor(now: Clock) {
    this.now = now;
  }

  get position(): number {
    if (!this.running) {
      return this.offset;
    }
    return this.offset + (this.now() - this.startedAt) * this.speed;
  }

  get playing(): boolean {
    return this.running;
  }

  get rate(): number {
    return this.speed;
  }

  setRate(rate: number): void {
    this.offset = this.position;
    this.startedAt = this.now();
    this.speed = rate;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.startedAt = this.now();
    this.running = true;
  }

  pause(): void {
    if (!this.running) {
      return;
    }
    this.offset = this.position;
    this.running = false;
  }

  seek(position: number): void {
    this.offset = Math.max(0, position);
    this.startedAt = this.now();
  }
}
