"use client";

import { Clock, Drum, Gauge, ListMusic, Music2, Rows3, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChordTimeline } from "@/components/chord-timeline";
import { formatClock } from "@/lib/format/clock";
import type { Digest } from "@/lib/midi/analysis";
import { trackColor } from "@/lib/midi/palette";

type SongInfoPanelProps = {
  /** The song's own name, without its file extension. */
  title: string;
  report: Digest;
  onClose: () => void;
};

export function SongInfoPanel({ title, report, onClose }: SongInfoPanelProps) {
  const panel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const opener = document.activeElement;
    panel.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) {
        opener.focus();
      }
    };
  }, []);

  // Captured and stopped, matching every other full screen dialog here: the
  // player's own shortcuts sit behind this on the same keys.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = panel.current?.querySelectorAll<HTMLElement>("button");
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
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-void/70 p-4 backdrop-blur-sm">
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="song-info-title"
        tabIndex={-1}
        className="relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line-strong bg-panel p-5 shadow-[0_24px_70px_-15px_rgba(0,0,0,0.95)] outline-none"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2
            id="song-info-title"
            className="min-w-0 truncate font-semibold text-sm text-text"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1.5 text-faint transition-colors hover:bg-raised hover:text-text"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-line border-b pb-3">
          <Fact
            icon={Clock}
            label="Duration"
            value={formatClock(report.durationSeconds)}
          />
          <Fact
            icon={Gauge}
            label="Tempo"
            value={`${report.tempo.bpm} bpm`}
            note={tempoNote(report.tempo)}
          />
          <Fact
            icon={Rows3}
            label="Meter"
            value={`${report.meter.beats}/${report.meter.value}`}
            note={meterNote(report.meter)}
          />
          <Fact
            icon={Music2}
            label="Key"
            value={
              report.key === null
                ? "unclear"
                : `${report.key.tonic} ${report.key.mode}`
            }
            note={
              report.key === null
                ? undefined
                : `${Math.round(report.key.correlation * 100)}% fit`
            }
          />
        </div>

        <h3 className="label mt-3 mb-1.5">Tracks · {report.tracks.length}</h3>
        <ul className="flex flex-col gap-0.5">
          {report.tracks.map((track) => {
            const color = trackColor(track.index);
            return (
              <li
                key={track.index}
                className="flex items-center gap-2 rounded-lg px-1 py-1"
              >
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full"
                  style={{
                    background: color.glow,
                    boxShadow: `0 0 8px ${color.glow}`,
                  }}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-text">
                  {track.name}
                </span>
                {track.percussion ? (
                  <Drum
                    className="size-3.5 shrink-0 text-faint"
                    aria-hidden="true"
                    data-tip="Percussion"
                    data-tip-side="top"
                  />
                ) : null}
                <span className="shrink-0 font-mono text-[0.7rem] text-faint">
                  {track.range[0]}–{track.range[1]} · {track.notes}
                  {track.index === report.playedTrack ? " · busiest" : ""}
                </span>
              </li>
            );
          })}
        </ul>

        <h3 className="label mt-3 mb-1.5 flex items-center gap-1.5">
          <ListMusic className="size-3" aria-hidden="true" />
          Chords
        </h3>
        <ChordTimeline
          timeline={report.timeline}
          duration={report.durationSeconds}
        />
      </div>
    </div>,
    document.body,
  );
}

function tempoNote(tempo: Digest["tempo"]): string | undefined {
  if (!tempo.explicit) {
    return "assumed";
  }
  return tempo.changes > 1 ? `changes ${tempo.changes}×` : undefined;
}

function meterNote(meter: Digest["meter"]): string | undefined {
  if (!meter.explicit) {
    return "assumed";
  }
  return meter.changes > 1 ? `changes ${meter.changes}×` : undefined;
}

function Fact({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  note?: string | undefined;
}): ReactNode {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-[0.65rem] text-faint uppercase tracking-wide">
          {label}
        </span>
        <span className="text-sm text-text">
          {value}
          {note === undefined ? null : (
            <span className="ml-1 text-[0.7rem] text-faint">{note}</span>
          )}
        </span>
      </span>
    </div>
  );
}
