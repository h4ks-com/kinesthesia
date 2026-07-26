/** Which way notes travel. Free roam always shoots them out of the keys; a song
 * can fall onto them or rise out of them. */
export type NoteDirection = "up" | "down";

export type SkinId = string;

/** A note head as it sits on screen this frame, so a skin can react to where
 * notes are without knowing anything about the song. */
export type Traveller = {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly color: string;
};

export type Strike = {
  readonly x: number;
  readonly color: string;
};

/** Everything a skin is told, in screen pixels. It never sees the song, only
 * where things are now. */
export type SkinFrame = {
  readonly width: number;
  readonly height: number;
  /** Where the keys begin, which is the line notes travel from or toward. */
  readonly keyboardTop: number;
  readonly elapsed: number;
  readonly direction: NoteDirection;
  readonly travellers: readonly Traveller[];
  readonly strikes: readonly Strike[];
};

export type SkinInstance = {
  resize(width: number, height: number, ratio: number): void;
  draw(frame: SkinFrame): void;
  dispose(): void;
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

export type Skin = {
  readonly id: SkinId;
  readonly name: string;
  readonly blurb: string;
  /** The directions this skin reads correctly in. A skin whose world is being
   * flown through only makes sense when notes travel away from the keys. */
  readonly directions: readonly NoteDirection[];
  /** Null where the device cannot run it, so the choice falls back rather than
   * leaving a blank layer. */
  create(surface: SkinSurface): SkinInstance | null;
};
