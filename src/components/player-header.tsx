"use client";

import { Eye, GraduationCap, Music2, Piano, Swords } from "lucide-react";
import Link from "next/link";
import { TrackMenu } from "@/components/track-menu";
import type { SongTrack } from "@/lib/midi/song";
import {
  type PlayerMode,
  type PlayerParams,
  playerPath,
} from "@/lib/player-url";
import { accuracy, type Score, scorePoints } from "@/lib/scoring/judge";

const modeCatalog = [
  { mode: "watch", label: "Watch", icon: Eye },
  { mode: "learn", label: "Learn", icon: GraduationCap },
  { mode: "battle", label: "Battle", icon: Swords },
] as const satisfies readonly {
  mode: PlayerMode;
  label: string;
  icon: typeof Eye;
}[];

type PlayerHeaderProps = {
  mode: PlayerMode;
  params: PlayerParams;
  tracks: readonly SongTrack[];
  hiddenTracks: ReadonlySet<number>;
  playerTracks: ReadonlySet<number>;
  interactive: boolean;
  simplified: boolean;
  onSimplified: (simplified: boolean) => void;
  editable: boolean;
  score: Score;
  opponent: { name: string; points: number; accuracy: number } | null;
  onToggleVisible: (index: number) => void;
  onToggleMine: (index: number) => void;
  onSolo: (index: number) => void;
};

export function PlayerHeader({
  mode,
  params,
  tracks,
  hiddenTracks,
  playerTracks,
  interactive,
  simplified,
  onSimplified,
  editable,
  score,
  opponent,
  onToggleVisible,
  onToggleMine,
  onSolo,
}: PlayerHeaderProps) {
  const switchable = modeCatalog.filter((entry) =>
    mode === "battle" ? false : entry.mode !== mode,
  );

  return (
    <header className="relative z-50 flex h-14 shrink-0 items-center gap-2 border-line border-b bg-panel/90 px-3 backdrop-blur sm:gap-3 sm:px-4">
      <Link
        href="/"
        data-tip="Back to search"
        aria-label="Back to search"
        className="flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 font-semibold tracking-tight transition-colors hover:text-accent"
      >
        <Piano className="size-[18px] text-accent" aria-hidden="true" />
        <span className="hidden sm:inline">Kinesthesia</span>
      </Link>

      <span className="min-w-0 flex-1 truncate text-muted text-sm">
        {params.name}
      </span>

      {interactive ? (
        <span className="hidden shrink-0 items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 font-mono text-xs sm:flex">
          <span className="text-accent">{scorePoints(score)}</span>
          <span className="text-faint">
            {Math.round(accuracy(score) * 100)}% · {score.combo}x
          </span>
        </span>
      ) : null}

      {opponent === null ? null : (
        <span className="flex shrink-0 items-center gap-2 rounded-lg border border-line-strong bg-raised px-2.5 py-1.5 font-mono text-xs">
          <span className="max-w-20 truncate">{opponent.name}</span>
          <span className="text-accent">{opponent.points}</span>
        </span>
      )}

      <TrackMenu
        tracks={tracks}
        hidden={hiddenTracks}
        mine={playerTracks}
        interactive={interactive}
        canClaim={editable}
        onToggleVisible={onToggleVisible}
        onToggleMine={onToggleMine}
        onSolo={onSolo}
      />

      {interactive && editable ? (
        <button
          type="button"
          onClick={() => onSimplified(!simplified)}
          aria-pressed={simplified}
          data-tip={
            simplified ? "Play the full part" : "Play one note at a time"
          }
          aria-label="Simplify to one note at a time"
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-2 font-medium text-sm transition-colors sm:px-3 ${
            simplified
              ? "border-accent bg-accent-soft text-accent"
              : "border-line-strong text-muted hover:border-accent hover:text-accent"
          }`}
        >
          <Music2 className="size-4" aria-hidden="true" />
          <span className="hidden lg:inline">Simplify</span>
        </button>
      ) : null}

      {switchable.map(({ mode: target, label, icon: Icon }) => (
        <Link
          key={target}
          href={playerPath(target, params)}
          data-tip={`Switch to ${label.toLowerCase()}`}
          aria-label={`Switch to ${label}`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-2 font-medium text-sm transition-colors hover:border-accent hover:text-accent sm:px-3"
        >
          <Icon className="size-4" aria-hidden="true" />
          <span className="hidden lg:inline">{label}</span>
        </Link>
      ))}
    </header>
  );
}
