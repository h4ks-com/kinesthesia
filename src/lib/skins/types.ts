/** Which way notes travel. Free roam always shoots them out of the keys; a song
 * can fall onto them or rise out of them. */
export type NoteDirection = "up" | "down";

/** Every background and the directions it reads in, kept here rather than in
 * the registry so a link, an MCP argument and the picker can all agree without
 * pulling a shader and a particle pool into the bundle. A skin flown through
 * only makes sense while notes leave the keys; one that just hangs there reads
 * either way. */
export const skinDirections = {
  /** Rocks are flown into. */
  starfield: ["up"],
  /** The whole field is travelled through. */
  cruise: ["up"],
  aurora: ["up", "down"],
  /** Rain falls whether the notes do or not. */
  rainfall: ["up", "down"],
  /** Bubbles only rise. */
  abyss: ["up"],
  /** The floor rushes toward you. */
  horizon: ["down"],
  /** Embers only rise. */
  ember: ["up"],
  ink: ["up", "down"],
  /** A meadow reads the same whichever way the notes go. */
  flower: ["up", "down"],
} as const satisfies Record<string, readonly NoteDirection[]>;

export type SkinId = keyof typeof skinDirections;

export const skinIds = Object.keys(skinDirections) as readonly SkinId[];

/** Whether a background reads with the notes travelling this way. Answered from
 * the table, so nothing has to load a skin to find out. */
export function skinReads(id: SkinId, direction: NoteDirection): boolean {
  const directions: readonly NoteDirection[] = skinDirections[id];
  return directions.includes(direction);
}

/** A note head as it sits on screen this frame. Carries what it is as well as
 * where it is, so a background can answer to the playing and not just the
 * geometry. */
export type Traveller = {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly color: string;
  /** MIDI number, 21 at the lowest key and 108 at the highest. */
  readonly pitch: number;
  /** How hard it was played, 0 to 1. */
  readonly velocity: number;
};

/** Where a note landed on the keys this frame. Falling notes never travel
 * through the scene, so this is all a background gets to react to there. */
export type Strike = {
  readonly x: number;
  readonly color: string;
  readonly pitch: number;
  readonly velocity: number;
};

export type ChordQuality =
  | "major"
  | "minor"
  | "diminished"
  | "augmented"
  | "other";

/** The chord sounding now, named. Null wherever the notes form nothing
 * nameable, which silence and a chromatic run both do. */
export type Harmony = {
  readonly name: string;
  /** Pitch class of the root, 0 for C through 11 for B. */
  readonly root: number;
  readonly quality: ChordQuality;
};

export type SongKey = {
  readonly root: number;
  readonly mode: "major" | "minor";
};

/** Everything a skin is told, in screen pixels. It never sees the song, only
 * where things are now. */
export type SkinFrame = {
  /** Where the keys begin, which is the line notes travel from or toward. */
  readonly keyboardTop: number;
  /** Seconds the layer has been up. Animation that runs on its own reads this. */
  readonly elapsed: number;
  /** Where the song is. Anything that should hold still while playback does
   * reads this instead, since it stops when the song stops. */
  readonly position: number;
  /** Note heads climbing away from the keys. Empty while notes fall. */
  readonly travellers: readonly Traveller[];
  /** Notes that landed since the last frame, whichever way they travel. */
  readonly strikes: readonly Strike[];
  /** Seconds since the last frame, clamped, so a stalled tab cannot teleport a
   * scene the moment it comes back. */
  readonly step: number;
  /** Keys down right now, as MIDI numbers. */
  readonly pressed: readonly number[];
  /** What is sounding, and what the song is in. Both null where they cannot be
   * told, which is what silence and an unnameable cluster give. */
  readonly chord: Harmony | null;
  readonly key: SongKey | null;
};

export type SkinInstance = {
  resize(width: number, height: number, ratio: number): void;
  /** Settles once this frame is actually on the layer. The roll ignores it and
   * takes whatever arrives; a render has to wait, or it encodes the frame
   * before the background drew it and the file comes out different every
   * time. */
  draw(frame: SkinFrame): void | Promise<void>;
  dispose(): void;
  /** Settles once there is something to draw, for a background that has to
   * fetch it. A render waits on this, or its opening seconds come out bare.
   * Absent where a background is ready the moment it is made. */
  readonly ready?: Promise<void>;
};

/** Both layers a skin may draw on, stacked and sized by the host. A skin never
 * touches the page: WebGL and 2D cannot share one canvas, and letting a skin
 * append its own would put layout in the hands of every skin author. */
export type SkinSurface = {
  /** For a shader. */
  readonly base: HTMLCanvasElement;
  /** Drawn over the base, for shapes that answer to where the notes are. */
  readonly overlay: HTMLCanvasElement;
};

/** Anything the roll can mount behind itself. A background this build ships and
 * a picture someone brought both answer to this and nothing more. */
export type BackdropSource = {
  /** `onBroke` is per mount, not per background: one shipped background is
   * mounted by the roll and by its own tile in the picker, and only the mount
   * that failed should say so. */
  create(
    surface: SkinSurface,
    onBroke?: (why: string) => void,
  ): SkinInstance | null;
};

export type Skin = BackdropSource & {
  readonly id: SkinId;
  readonly name: string;
  readonly blurb: string;
  /** The directions this skin reads correctly in. A skin whose world is being
   * flown through only makes sense when notes travel away from the keys. */
  readonly directions: readonly NoteDirection[];
};
