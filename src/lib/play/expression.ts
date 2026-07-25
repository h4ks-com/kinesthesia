/** How the wheels stood at one moment. Bend is signed across the wheel's
 * travel; depth is unsigned. */
export type Expression = {
  readonly bend: number;
  readonly depth: number;
};

export const flat: Expression = { bend: 0, depth: 0 };

type Sample = {
  at: number;
  bend: number;
  depth: number;
};

/** Seconds of wheel movement kept per track. A note is drawn from its start to
 * now, so the trail only has to outlast the longest note still on screen. */
const trailSeconds = 8;

/** The bend and modulation wheels over time, per track. Both are channel wide
 * in MIDI, so every note on a track shares one trail rather than carrying its
 * own copy. The renderer reads it by time to bend a note along its length. */
export class ExpressionTrail {
  private readonly tracks = new Map<number, Sample[]>();

  private samplesFor(track: number): Sample[] {
    const existing = this.tracks.get(track);
    if (existing !== undefined) {
      return existing;
    }
    const created: Sample[] = [];
    this.tracks.set(track, created);
    return created;
  }

  private push(track: number, at: number, next: Expression): void {
    const samples = this.samplesFor(track);
    const last = samples[samples.length - 1];
    if (last !== undefined && last.at > at) {
      // The clock moved back, so the old trail describes a part of the song
      // that is being played again and would bend the new notes by it.
      samples.length = 0;
    }
    samples.push({ at, bend: next.bend, depth: next.depth });
    const cutoff = at - trailSeconds;
    let drop = 0;
    while (drop < samples.length - 1 && (samples[drop + 1]?.at ?? 0) < cutoff) {
      drop += 1;
    }
    if (drop > 0) {
      samples.splice(0, drop);
    }
  }

  setBend(track: number, at: number, bend: number): void {
    this.push(track, at, { bend, depth: this.latest(track).depth });
  }

  setDepth(track: number, at: number, depth: number): void {
    this.push(track, at, { bend: this.latest(track).bend, depth });
  }

  latest(track: number): Expression {
    const samples = this.tracks.get(track);
    const last = samples?.[samples.length - 1];
    return last === undefined ? flat : { bend: last.bend, depth: last.depth };
  }

  /** Where the wheels stood at `at`. A wheel holds its value until it is moved
   * again, so a time between samples reads the one before it. */
  at(track: number, at: number): Expression {
    const samples = this.tracks.get(track);
    if (samples === undefined || samples.length === 0) {
      return flat;
    }
    const first = samples[0];
    if (first === undefined || at < first.at) {
      return flat;
    }
    let low = 0;
    let high = samples.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if ((samples[mid]?.at ?? 0) <= at) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    const found = samples[low];
    return found === undefined
      ? flat
      : { bend: found.bend, depth: found.depth };
  }

  /** Whether a track has ever moved a wheel, so the renderer can keep drawing
   * plain rectangles for the tracks that never bend. */
  touched(track: number): boolean {
    return (this.tracks.get(track)?.length ?? 0) > 0;
  }

  clear(): void {
    this.tracks.clear();
  }
}
