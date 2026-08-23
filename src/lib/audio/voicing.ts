import { homeSlot, paletteSlot } from "@/lib/midi/palette";
import type { SongNote, SongTrack } from "@/lib/midi/song";

/** How one track is played and drawn: which instrument sounds it, the shaping
 * laid over the sample, and which palette entry its notes take. Each default
 * means "leave it as it arrived", so a track nobody has touched plays and
 * reads exactly as it always did. */
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
  /** Which palette entry the track's notes are drawn in. */
  readonly color: number;
  /** Draws this track over every track that is not in front, so a solo is not
   * buried by whatever happens to sound after it. */
  readonly front: boolean;
};

/** A voicing per track index. Absent tracks sound and read as they were
 * parsed. */
export type SongVoicing = ReadonlyMap<number, Voicing>;

/** The same, as it travels and as it is stored: a map keyed by number is not
 * JSON, and a row written before tracks could be recoloured names no colour. */
export type StoredVoicing = Record<string, ReadVoicing>;

type ReadVoicing = Omit<Voicing, "color" | "front"> & {
  readonly color?: number;
  readonly front?: boolean;
};

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
    color: homeSlot(track.index),
    front: false,
  };
}

/** Given the track it belongs to, since a record that names no colour takes
 * the one its position gives it. */
export function clampVoicing(voicing: ReadVoicing, track: number): Voicing {
  return {
    color:
      voicing.color === undefined
        ? homeSlot(track)
        : paletteSlot(voicing.color),
    front: voicing.front === true,
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

/** Whether any track has been asked to the front, which is what says a second
 * pass over the notes is worth making. */
export function anyFront(voicing: SongVoicing): boolean {
  for (const entry of voicing.values()) {
    if (entry.front) {
      return true;
    }
  }
  return false;
}

export function isFront(track: number, voicing: SongVoicing): boolean {
  return voicing.get(track)?.front === true;
}

export function asRecord(voicing: SongVoicing): StoredVoicing {
  return Object.fromEntries(
    [...voicing].map(([track, entry]) => [String(track), entry]),
  );
}

export function asVoicing(tracks: StoredVoicing): SongVoicing {
  return new Map(
    Object.entries(tracks).map(([track, voicing]) => [
      Number(track),
      clampVoicing(voicing, Number(track)),
    ]),
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

/** The instrument a track plays under a voicing, falling back to the one the
 * file named for a track nobody has revoiced. */
export function programFor(voicing: Voicing | null, program: number): number {
  return voicing?.program ?? program;
}

/** The sampler options a note is played with, shared by the live engine and the
 * offline render so both sound the same. The caller adds `time`, which is the
 * only thing that differs between playing now and rendering ahead. */
export function scheduledNote(
  note: SongNote,
  voicing: Voicing | null,
  rate: number,
): {
  note: number;
  duration: number;
  velocity: number;
  ampAttack?: number;
  ampRelease?: number;
  lpfCutoffHz?: number;
} {
  return {
    note: note.pitch,
    duration: Math.max(0.05, (note.release - note.start) / rate),
    velocity: velocityFor(note.velocity, voicing),
    ...shapingFor(voicing),
  };
}
