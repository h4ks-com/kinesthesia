import type { SongVoicing } from "@/lib/audio/voicing";
import type { Song } from "@/lib/midi/song";
import type { Frame } from "@/lib/render/piano-roll";

/** The watch view exactly as it stands, handed to an offline render. Nothing
 * here is interactive, so a frame is a pure function of position. */
export type RenderConfig = {
  readonly song: Song;
  readonly voicing: SongVoicing;
  readonly hiddenTracks: ReadonlySet<number>;
  readonly plain: boolean;
  /** Playback speed, so a render matches the sped up or slowed view. */
  readonly rate: number;
};

export const renderSize = { width: 1280, height: 720 } as const;
export const renderFps = 60;

const noPitches: ReadonlySet<number> = new Set();

export function watchFrame(config: RenderConfig, position: number): Frame {
  return {
    song: config.song,
    position,
    live: null,
    sustain: false,
    rate: config.rate,
    playTrack: 0,
    hiddenTracks: config.hiddenTracks,
    pressed: noPitches,
    owed: noPitches,
    yours: null,
    reach: null,
    keyLabels: null,
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
