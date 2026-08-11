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
import { type ReactNode, useEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Popover } from "@/components/ui/popover";
import type { SongVoicing } from "@/lib/audio/voicing";
import { downloadBlob, downloadName } from "@/lib/download";
import type { Song } from "@/lib/midi/song";
import {
  defaultQuality,
  type RenderConfig,
  type RenderQuality,
  renderDuration,
  renderQualityIds,
} from "@/lib/render/export";
import {
  handBack,
  handBackFailure,
  handbackFromUrl,
  isExpected,
} from "@/lib/render/handback";
import { canRenderVideo, isFastVideo } from "@/lib/render/video-support";
import type { BackdropSource, NoteDirection } from "@/lib/skins/types";

type RenderMenuProps = {
  song: Song;
  voicing: SongVoicing;
  hiddenTracks: ReadonlySet<number>;
  plain: boolean;
  /** Carried into the file so it matches what was on screen. */
  noteNames: boolean;
  speed: number;
  direction: NoteDirection;
  /** The background on screen, so the file carries it too. */
  skin: BackdropSource | null;
  title: string;
};

type JobKind = "video" | "audio";

type Job =
  | {
      kind: JobKind;
      phase: "working";
      stage: string;
      progress: number | null;
      /** When this stage started, so what is left is measured against the part
       * of it that has actually run. */
      since: number;
      /** How long the finished file runs, which is what the speed is against. */
      seconds: number;
      /** True while the stage is laying down output at song speed, so a rate
       * against the song means something. */
      paced: boolean;
    }
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
  noteNames,
  speed,
  direction,
  skin,
  title,
}: RenderMenuProps) {
  const [job, setJob] = useState<Job | null>(null);
  const [quality, setQuality] = useState<RenderQuality>(defaultQuality);
  const abort = useRef<AbortController | null>(null);
  const lastShown = useRef(0);

  // A render outlives a click, so an unmount mid-render has to stop it or it
  // keeps encoding detached and downloads a file into a page the user has left.
  // A driven one has nobody to leave the page, and its only unmount is the one
  // React does twice on purpose in development.
  useEffect(
    () => () => {
      if (handbackFromUrl() === null) {
        abort.current?.abort();
      }
    },
    [],
  );

  // An address that asks for a render starts one without anybody clicking, which
  // is how a browser somewhere else is driven.
  const runNow = useRef(run);
  runNow.current = run;
  const drivenStarted = useRef(false);
  useEffect(() => {
    const asked = handbackFromUrl();
    if (drivenStarted.current || asked === null) {
      return;
    }
    drivenStarted.current = true;
    // Asked for by whoever started the job, not merely by the address: a link
    // is otherwise enough to set a stranger's browser encoding for nobody.
    void isExpected(asked).then((expected) => {
      if (expected) {
        void runNow.current(asked.kind);
      }
    });
  }, []);

  async function run(kind: JobKind): Promise<void> {
    const config: RenderConfig = {
      song,
      voicing,
      hiddenTracks,
      plain,
      noteNames,
      rate: speed,
      direction,
      skin,
      quality,
    };
    const controller = new AbortController();
    abort.current = controller;
    lastShown.current = 0;
    const seconds = renderDuration(config);
    const begin = (stage: string, paced: boolean, progress: number | null) =>
      setJob({
        kind,
        phase: "working",
        stage,
        progress,
        since: performance.now(),
        seconds,
        paced,
      });
    begin("Loading instruments", false, null);
    const onStep = (stage: string, progress: number | null): void =>
      setJob((current) => {
        if (current?.phase !== "working") {
          return current;
        }
        if (current.stage !== stage) {
          return {
            ...current,
            stage,
            progress,
            since: performance.now(),
            paced: stage === "Rendering sound",
          };
        }
        return { ...current, progress };
      });
    try {
      const { renderSongAudio, audioToWav } = await import(
        "@/lib/render/audio"
      );
      const audio = await renderSongAudio(config, onStep);
      if (controller.signal.aborted) {
        return;
      }
      if (kind === "audio") {
        finish(kind, audioToWav(audio), downloadName(title, "wav"), false);
        return;
      }
      begin("Encoding video", true, 0);
      const { renderSongVideo } = await import("@/lib/render/video");
      const video = await renderSongVideo(
        config,
        audio,
        (fraction) => {
          if (fraction < 1 && fraction - lastShown.current < 0.005) {
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
        downloadName(title, video.extension),
        video.realtime,
      );
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted) {
        setJob(null);
        return;
      }
      const message =
        error instanceof Error ? error.message : "The render failed.";
      const asked = handbackFromUrl();
      if (asked !== null) {
        void handBackFailure(asked, message);
      }
      setJob({ kind, phase: "error", message });
    }
  }

  function finish(
    kind: JobKind,
    blob: Blob,
    filename: string,
    realtime: boolean,
  ): void {
    const asked = handbackFromUrl();
    if (asked === null) {
      downloadBlob(blob, filename);
    } else {
      void handBack(asked, blob, filename);
    }
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
            // Which container it lands in depends on what the browser can
            // encode, and the saved file carries its own name, so the offer
            // promises the picture rather than the format.
            note={
              isFastVideo()
                ? "the keyboard and the notes"
                : "recorded in real time"
            }
            disabled={!canRenderVideo()}
            onClick={() => void run("video")}
          />
          <fieldset className="flex gap-1 px-1">
            <legend className="sr-only">Video quality</legend>
            {renderQualityIds.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={id === quality}
                disabled={!canRenderVideo()}
                onClick={() => setQuality(id)}
                className={`flex-1 rounded-lg border px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  id === quality
                    ? "border-accent text-accent"
                    : "border-line-strong text-muted hover:border-accent hover:text-accent"
                }`}
              >
                {id}
              </button>
            ))}
          </fieldset>
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
  const panel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const opener = document.activeElement;
    return () => {
      if (opener instanceof HTMLElement) {
        opener.focus();
      }
    };
  }, []);

  // Focus the panel's primary action on open and again on each phase change,
  // since the button that had focus unmounts when working turns to done.
  // biome-ignore lint/correctness/useExhaustiveDependencies: job.phase is the re-run trigger, not something the effect reads
  useEffect(() => {
    const target =
      panel.current?.querySelector<HTMLElement>("[data-autofocus]");
    target?.focus();
  }, [job.phase]);

  const dismiss = job.phase === "working" ? onCancel : onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        dismiss();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = panel.current?.querySelectorAll("button");
      const first = focusable?.[0];
      const last = focusable?.[focusable.length - 1];
      if (first === undefined || last === undefined) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dismiss]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-void/70 p-6 backdrop-blur-sm">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="render-dialog-title"
        aria-busy={job.phase === "working"}
        className="w-full max-w-sm rounded-2xl border border-line-strong bg-panel p-6 shadow-[0_24px_70px_-15px_rgba(0,0,0,0.95)]"
      >
        {job.phase === "working" ? (
          <Working job={job} title={title} onCancel={onCancel} />
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
  title,
  onCancel,
}: {
  job: Extract<Job, { phase: "working" }>;
  title: string;
  onCancel: () => void;
}) {
  const percent = job.progress === null ? null : Math.round(job.progress * 100);
  const pace = usePace(job);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3" role="status" aria-live="polite">
        <Loader2
          className="size-5 shrink-0 animate-spin text-accent"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h2
            id="render-dialog-title"
            className="font-semibold text-sm text-text"
          >
            Rendering {job.kind}
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
        <div
          role="progressbar"
          aria-label={job.stage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
          className="h-1.5 overflow-hidden rounded-full bg-raised"
        >
          {job.progress === null ? (
            <div className="marching h-full w-1/3 rounded-full bg-accent" />
          ) : (
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-150"
              style={{ width: `${Math.max(2, percent ?? 0)}%` }}
            />
          )}
        </div>
        {pace === null ? null : (
          <p className="text-faint text-xs tabular-nums">{pace}</p>
        )}
      </div>

      <button
        type="button"
        data-autofocus
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
      <div className="flex items-center gap-3" role="status" aria-live="polite">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-good/15 text-good">
          <Check className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2
            id="render-dialog-title"
            className="font-semibold text-sm text-text"
          >
            Saved
          </h2>
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
          data-autofocus
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
      <div className="flex items-center gap-3" role="status" aria-live="polite">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger">
          <CircleAlert className="size-5" aria-hidden="true" />
        </span>
        <h2
          id="render-dialog-title"
          className="font-semibold text-sm text-text"
        >
          The render failed
        </h2>
      </div>
      <p className="text-muted text-xs leading-relaxed">{message}</p>
      <button
        type="button"
        data-autofocus
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

/** How fast the render is running and how much of it is left, counted down
 * between progress reports rather than only when one lands. Null until there is
 * enough of a stage behind it to divide by. */
function usePace(job: Extract<Job, { phase: "working" }>): string | null {
  const [, retime] = useReducer((count: number) => count + 1, 0);
  const measurable = job.progress !== null;
  useEffect(() => {
    if (!measurable) {
      return;
    }
    const timer = setInterval(retime, 500);
    return () => clearInterval(timer);
  }, [measurable]);

  const done = job.progress ?? 0;
  const elapsed = (performance.now() - job.since) / 1000;
  if (done <= 0 || elapsed < 1) {
    return null;
  }
  const left = formatSpan(elapsed / done - elapsed);
  if (!job.paced) {
    return `${left} left`;
  }
  const rate = (done * job.seconds) / elapsed;
  return `${rate >= 10 ? Math.round(rate) : rate.toFixed(1)}× real time · ${left} left`;
}

function formatSpan(seconds: number): string {
  const whole = Math.max(1, Math.round(seconds));
  if (whole < 60) {
    return `${whole}s`;
  }
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
