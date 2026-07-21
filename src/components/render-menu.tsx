"use client";

import {
  AudioLines,
  Check,
  CircleAlert,
  Clapperboard,
  Download,
  Film,
  Loader2,
} from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Popover } from "@/components/ui/popover";
import type { SongVoicing } from "@/lib/audio/voicing";
import type { Song } from "@/lib/midi/song";
import { audioToWav, renderSongAudio } from "@/lib/render/audio";
import {
  downloadBlob,
  exportFilename,
  type RenderConfig,
} from "@/lib/render/export";
import {
  canRenderVideo,
  isFastVideo,
  renderSongVideo,
} from "@/lib/render/video";

type RenderMenuProps = {
  song: Song;
  voicing: SongVoicing;
  hiddenTracks: ReadonlySet<number>;
  plain: boolean;
  speed: number;
  title: string;
};

type JobKind = "video" | "audio";

type Job =
  | { kind: JobKind; phase: "working"; stage: string; progress: number | null }
  | {
      kind: JobKind;
      phase: "done";
      filename: string;
      blob: Blob;
      realtime: boolean;
    }
  | { kind: JobKind; phase: "error"; message: string };

export function RenderMenu({
  song,
  voicing,
  hiddenTracks,
  plain,
  speed,
  title,
}: RenderMenuProps) {
  const [job, setJob] = useState<Job | null>(null);
  const abort = useRef<AbortController | null>(null);
  const lastShown = useRef(0);

  function config(): RenderConfig {
    return { song, voicing, hiddenTracks, plain, rate: speed };
  }

  async function run(kind: JobKind): Promise<void> {
    const controller = new AbortController();
    abort.current = controller;
    lastShown.current = 0;
    setJob({
      kind,
      phase: "working",
      stage: "Rendering sound",
      progress: null,
    });
    try {
      const audio = await renderSongAudio(config());
      if (controller.signal.aborted) {
        return;
      }
      if (kind === "audio") {
        finish(kind, audioToWav(audio), exportFilename(title, "wav"), false);
        return;
      }
      setJob({ kind, phase: "working", stage: "Encoding video", progress: 0 });
      const video = await renderSongVideo(
        config(),
        audio,
        (fraction) => {
          if (fraction < 1 && fraction - lastShown.current < 0.01) {
            return;
          }
          lastShown.current = fraction;
          setJob((current) =>
            current?.phase === "working"
              ? { ...current, progress: fraction }
              : current,
          );
        },
        controller.signal,
      );
      finish(
        kind,
        video.blob,
        exportFilename(title, video.extension),
        video.realtime,
      );
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted) {
        setJob(null);
        return;
      }
      setJob({
        kind,
        phase: "error",
        message: error instanceof Error ? error.message : "The render failed.",
      });
    }
  }

  function finish(
    kind: JobKind,
    blob: Blob,
    filename: string,
    realtime: boolean,
  ): void {
    downloadBlob(blob, filename);
    setJob({ kind, phase: "done", filename, blob, realtime });
  }

  function cancel(): void {
    abort.current?.abort();
    setJob(null);
  }

  return (
    <>
      <Popover
        label="Render"
        align="right"
        trigger={(open) => (
          <span
            data-tip="Render a video or audio file"
            data-tip-align="right"
            className={`inline-flex items-center rounded-lg border p-2 transition-colors ${
              open
                ? "border-accent text-accent"
                : "border-line-strong text-muted hover:border-accent hover:text-accent"
            }`}
          >
            <Clapperboard className="size-4" aria-hidden="true" />
          </span>
        )}
      >
        <div className="flex w-60 flex-col gap-1 p-1 max-sm:w-full">
          <p className="px-2 pt-1 pb-1.5 text-faint text-xs leading-relaxed">
            The keyboard and notes as they play now, at your current sound and
            speed.
          </p>
          <Choice
            icon={<Film className="size-4" aria-hidden="true" />}
            title="Video"
            note="mp4, keyboard and notes"
            disabled={!canRenderVideo()}
            onClick={() => void run("video")}
          />
          <Choice
            icon={<AudioLines className="size-4" aria-hidden="true" />}
            title="Audio"
            note="wav, just the sound"
            disabled={false}
            onClick={() => void run("audio")}
          />
        </div>
      </Popover>

      {/* Portalled to the body: the header's backdrop-blur is a containing
          block for fixed children, which would otherwise trap the dialog. */}
      {job === null
        ? null
        : createPortal(
            <RenderDialog
              job={job}
              title={title}
              onCancel={cancel}
              onClose={() => setJob(null)}
            />,
            document.body,
          )}
    </>
  );
}

function RenderDialog({
  job,
  title,
  onCancel,
  onClose,
}: {
  job: Job;
  title: string;
  onCancel: () => void;
  onClose: () => void;
}) {
  const kindLabel = job.kind === "video" ? "video" : "audio";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-void/70 p-6 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-line-strong bg-panel p-6 shadow-[0_24px_70px_-15px_rgba(0,0,0,0.95)]">
        {job.phase === "working" ? (
          <Working
            job={job}
            kindLabel={kindLabel}
            title={title}
            onCancel={onCancel}
          />
        ) : job.phase === "done" ? (
          <Done job={job} onClose={onClose} />
        ) : (
          <Failed message={job.message} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function Working({
  job,
  kindLabel,
  title,
  onCancel,
}: {
  job: Extract<Job, { phase: "working" }>;
  kindLabel: string;
  title: string;
  onCancel: () => void;
}) {
  const percent = job.progress === null ? null : Math.round(job.progress * 100);
  const hint =
    job.kind === "video" && job.stage === "Encoding video" && !isFastVideo()
      ? "Recording in real time, about the length of the song."
      : "Faster than real time.";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Loader2
          className="size-5 shrink-0 animate-spin text-accent"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h2 className="font-semibold text-sm text-text">
            Rendering {kindLabel}
          </h2>
          <p className="truncate text-faint text-xs">{title}</p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-muted text-xs">{job.stage}</span>
          {percent === null ? null : (
            <span className="font-mono text-accent text-xs tabular-nums">
              {percent}%
            </span>
          )}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-raised">
          {job.progress === null ? (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
          ) : (
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-150"
              style={{ width: `${Math.max(2, percent ?? 0)}%` }}
            />
          )}
        </div>
        <p className="text-faint text-xs">{hint}</p>
      </div>

      <button
        type="button"
        onClick={onCancel}
        className="self-end rounded-lg border border-line-strong px-3 py-1.5 text-muted text-xs transition-colors hover:border-danger hover:text-danger"
      >
        Cancel
      </button>
    </div>
  );
}

function Done({
  job,
  onClose,
}: {
  job: Extract<Job, { phase: "done" }>;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-good/15 text-good">
          <Check className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold text-sm text-text">Saved</h2>
          <p className="truncate text-faint text-xs">
            {job.filename} · {formatBytes(job.blob.size)}
          </p>
        </div>
      </div>
      {job.realtime ? (
        <p className="text-faint text-xs leading-relaxed">
          Recorded in real time, since this browser can't encode faster.
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => downloadBlob(job.blob, job.filename)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-muted text-xs transition-colors hover:border-accent hover:text-accent"
        >
          <Download className="size-3.5" aria-hidden="true" />
          Download again
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg bg-accent px-3 py-1.5 font-medium text-panel text-xs transition-opacity hover:opacity-90"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function Failed({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger">
          <CircleAlert className="size-5" aria-hidden="true" />
        </span>
        <h2 className="font-semibold text-sm text-text">The render failed</h2>
      </div>
      <p className="text-muted text-xs leading-relaxed">{message}</p>
      <button
        type="button"
        onClick={onClose}
        className="self-end rounded-lg border border-line-strong px-3 py-1.5 text-muted text-xs transition-colors hover:border-accent hover:text-accent"
      >
        Close
      </button>
    </div>
  );
}

function Choice({
  icon,
  title,
  note,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  note: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg border border-line-strong px-3 py-2 text-left transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line-strong disabled:hover:text-inherit"
    >
      <span className="text-muted">{icon}</span>
      <span className="flex flex-col">
        <span className="font-medium text-sm text-text">{title}</span>
        <span className="text-faint text-xs">{note}</span>
      </span>
    </button>
  );
}

function formatBytes(bytes: number): string {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
