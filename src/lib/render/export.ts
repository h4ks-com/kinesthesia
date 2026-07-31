import type { SongVoicing } from "@/lib/audio/voicing";
import type { Song } from "@/lib/midi/song";
import type { Frame, SkinReport } from "@/lib/render/piano-roll";
import type { BackdropSource, NoteDirection } from "@/lib/skins/types";

/** The watch view exactly as it stands, handed to an offline render. Nothing
 * here is interactive, so a frame is a pure function of position. */
export type RenderConfig = {
  readonly song: Song;
  readonly voicing: SongVoicing;
  readonly hiddenTracks: ReadonlySet<number>;
  readonly plain: boolean;
  /** Playback speed, so a render matches the sped up or slowed view. */
  readonly rate: number;
  /** Which way the notes were travelling on screen, so the file matches what
   * was being watched. */
  readonly direction: NoteDirection;
  /** The background behind the roll, drawn into the video the same way it is
   * drawn on screen. Null leaves the roll on its own dark backdrop. */
  readonly skin: BackdropSource | null;
};

export const renderSize = { width: 1280, height: 720 } as const;
/** Falling notes carry their motion in long straight travel, which reads fine
 * at half the rate a game needs, and every frame here is one the encoder has to
 * pay for twice: once drawn, once compressed. */
export const renderFps = 30;

const noPitches: ReadonlySet<number> = new Set();

export function watchFrame(
  config: RenderConfig,
  position: number,
  report: SkinReport | null = null,
): Frame {
  return {
    song: config.song,
    position,
    live: null,
    sustain: false,
    expression: null,
    direction: config.direction,
    report,
    rate: config.rate,
    playTrack: 0,
    hiddenTracks: config.hiddenTracks,
    pressed: noPitches,
    owed: noPitches,
    yours: null,
    reach: null,
    keyLabels: null,
    follow: false,
    plain: config.plain,
  };
}

/** Seconds the finished render runs for, after speed. */
export function renderDuration(config: RenderConfig): number {
  return config.song.duration / config.rate;
}

export function exportFilename(title: string, extension: string): string {
  const base = title.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${base === "" ? "song" : base}.${extension}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // The click starts the download asynchronously, so revoking on this tick can
  // cancel it before the browser has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
