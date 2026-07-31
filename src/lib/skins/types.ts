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
  /** The rain has to agree with the notes. */
  rainfall: ["down"],
  /** Bubbles only rise. */
  abyss: ["up"],
  /** The floor rushes toward you. */
  horizon: ["down"],
  /** Embers only rise. */
  ember: ["up"],
  ink: ["up", "down"],
} as const satisfies Record<string, readonly NoteDirection[]>;

export type SkinId = keyof typeof skinDirections;

export const skinIds = Object.keys(skinDirections) as readonly SkinId[];

/** Whether a background reads with the notes travelling this way. Answered from
 * the table, so nothing has to load a skin to find out. */
export function skinReads(id: SkinId, direction: NoteDirection): boolean {
  const directions: readonly NoteDirection[] = skinDirections[id];
  return directions.includes(direction);
}

/** A note head as it sits on screen this frame, so a skin can react to where
 * notes are without knowing anything about the song. */
export type Traveller = {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly color: string;
};

/** Where a note landed on the keys this frame. Falling notes never travel
 * through the scene, so this is all a background gets to react to there. */
export type Strike = {
  readonly x: number;
  readonly color: string;
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
};

export type SkinInstance = {
  resize(width: number, height: number, ratio: number): void;
  draw(frame: SkinFrame): void;
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
  create(surface: SkinSurface): SkinInstance | null;
};

export type Skin = BackdropSource & {
  readonly id: SkinId;
  readonly name: string;
  readonly blurb: string;
  /** The directions this skin reads correctly in. A skin whose world is being
   * flown through only makes sense when notes travel away from the keys. */
  readonly directions: readonly NoteDirection[];
};
