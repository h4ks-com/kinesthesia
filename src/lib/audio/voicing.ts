import type { SongTrack } from "@/lib/midi/song";

/** How one track is made to sound: which instrument plays it, and the shaping
 * laid over the sample. Each default means "leave the sample alone", so a
 * track nobody has touched plays exactly as it always did. */
export type Voicing = {
  readonly program: number;
  /** Milliseconds faded in over the sample's own onset. */
  readonly attack: number;
  /** Milliseconds faded out. Zero lets the sample ring its written length. */
  readonly release: number;
  /** Low pass cutoff in Hz. At the top of the range nothing is filtered. */
  readonly brightness: number;
  /** Percent of the written velocity. */
  readonly volume: number;
};

/** A voicing per track index. Absent tracks sound as they were parsed. */
export type SongVoicing = ReadonlyMap<number, Voicing>;

export const attackRange = { min: 0, max: 1000 } as const;
export const releaseRange = { min: 0, max: 4000 } as const;
export const brightnessRange = { min: 200, max: 20000 } as const;
export const volumeRange = { min: 0, max: 150 } as const;
export const programRange = { min: 0, max: 127 } as const;

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) {
    return low;
  }
  return Math.min(high, Math.max(low, Math.round(value)));
}

export function defaultVoicing(track: SongTrack): Voicing {
  return {
    program: track.program,
    attack: attackRange.min,
    release: releaseRange.min,
    brightness: brightnessRange.max,
    volume: 100,
  };
}

export function clampVoicing(voicing: Voicing): Voicing {
  return {
    program: clamp(voicing.program, programRange.min, programRange.max),
    attack: clamp(voicing.attack, attackRange.min, attackRange.max),
    release: clamp(voicing.release, releaseRange.min, releaseRange.max),
    brightness: clamp(
      voicing.brightness,
      brightnessRange.min,
      brightnessRange.max,
    ),
    volume: clamp(voicing.volume, volumeRange.min, volumeRange.max),
  };
}

export function isDefaultVoicing(voicing: Voicing, track: SongTrack): boolean {
  const home = defaultVoicing(track);
  return (
    voicing.program === home.program &&
    voicing.attack === home.attack &&
    voicing.release === home.release &&
    voicing.brightness === home.brightness &&
    voicing.volume === home.volume
  );
}

/** The shaping to hand the sampler, holding back anything left at its default
 * so an untouched track is scheduled exactly as it was before any of this. */
export function shapingFor(voicing: Voicing | null): {
  ampAttack?: number;
  ampRelease?: number;
  lpfCutoffHz?: number;
} {
  if (voicing === null) {
    return {};
  }
  return {
    ...(voicing.attack > attackRange.min
      ? { ampAttack: voicing.attack / 1000 }
      : {}),
    ...(voicing.release > releaseRange.min
      ? { ampRelease: voicing.release / 1000 }
      : {}),
    ...(voicing.brightness < brightnessRange.max
      ? { lpfCutoffHz: voicing.brightness }
      : {}),
  };
}

/** Written velocity after the track's level, on the sampler's 0 to 127 scale. */
export function velocityFor(velocity: number, voicing: Voicing | null): number {
  const level = (voicing?.volume ?? 100) / 100;
  return clamp(velocity * 127 * level, 0, 127);
}
