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
  /** Whether the notes carry their names, as they do on screen. */
  readonly noteNames: boolean;
};

export type RenderQuality = "720p" | "1080p" | "1080p60";

type QualitySpec = {
  readonly width: number;
  readonly height: number;
  /** Falling notes carry their motion in long straight travel, which reads
   * fine at half the rate a game needs, and every frame is one the encoder
   * pays for twice: once drawn, once compressed. */
  readonly fps: number;
  readonly bitrate: number;
  /** Kept at or under what a platform AAC encoder will take at 44.1kHz stereo,
   * which is 256 kbps. Asking past that is not clamped everywhere: some
   * encoders accept the config, fail on the first frame and close, which
   * surfaces only as a codec that is already shut. */
  readonly audioBitrate: number;
  /** Frames between forced keyframes, or null to leave the spacing to the
   * encoder. A tight one costs bitrate and buys seeking. */
  readonly gop: number | null;
};

/** What each quality lays down. The first two are set against a roll rather
 * than against film: flat colour and hard edges compress far better, and the
 * number that matters is the one that keeps a file postable where a chat caps
 * an attachment at tens of megabytes. A moving background spends the most.
 *
 * The last one answers to YouTube's published upload settings instead, which
 * pull the other way: high profile, 12 Mbps, closed GOP at half the frame
 * rate. It buys a clean transcode from any site that re-encodes what it is
 * given, at the cost of a file far too large to attach anywhere. Its sound
 * stops short of the 384 kbps YouTube names, which no encoder here reaches. */
export const renderQualities = {
  "720p": {
    width: 1280,
    height: 720,
    fps: 30,
    bitrate: 2_000_000,
    audioBitrate: 192_000,
    gop: null,
  },
  "1080p": {
    width: 1920,
    height: 1080,
    fps: 30,
    bitrate: 5_000_000,
    audioBitrate: 192_000,
    gop: null,
  },
  "1080p60": {
    width: 1920,
    height: 1080,
    fps: 60,
    bitrate: 12_000_000,
    audioBitrate: 256_000,
    gop: 30,
  },
} as const satisfies Record<RenderQuality, QualitySpec>;

export const renderQualityIds = Object.keys(
  renderQualities,
) as readonly RenderQuality[];

export const defaultQuality: RenderQuality = "720p";

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
    noteNames: config.noteNames,
    follow: false,
    // A render has nobody at the keys, so the song presses them itself.
    songPresses: true,
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
