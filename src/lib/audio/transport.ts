/** Song position driven by the audio hardware clock, which never runs backwards
 * and never drifts against the notes we scheduled against it. */
export class Transport {
  private readonly context: AudioContext;
  private offset = 0;
  private startedAt = 0;
  private running = false;

  constructor(context: AudioContext) {
    this.context = context;
  }

  get position(): number {
    if (!this.running) {
      return this.offset;
    }
    return this.offset + (this.context.currentTime - this.startedAt);
  }

  get playing(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.startedAt = this.context.currentTime;
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
    this.startedAt = this.context.currentTime;
  }
}
