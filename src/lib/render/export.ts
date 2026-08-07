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
  /** How large and how finely the picture is laid down. Audio ignores it. */
  readonly quality: RenderQuality;
};

export type RenderQuality = "720p" | "1080p";

/** What each quality lays down. The bitrates are set against a roll rather than
 * against film: flat colour and hard edges compress far better, and the number
 * that matters is the one that keeps a file postable where a chat caps an
 * attachment at tens of megabytes. A moving background spends the most. */
export const renderQualities = {
  "720p": { width: 1280, height: 720, bitrate: 2_000_000 },
  "1080p": { width: 1920, height: 1080, bitrate: 5_000_000 },
} as const satisfies Record<
  RenderQuality,
  { width: number; height: number; bitrate: number }
>;

export const renderQualityIds = Object.keys(
  renderQualities,
) as readonly RenderQuality[];

export const defaultQuality: RenderQuality = "720p";

export const renderSize = renderQualities[defaultQuality];
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
    hits: noPitches,
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
