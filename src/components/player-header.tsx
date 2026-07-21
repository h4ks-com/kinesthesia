"use client";

import {
  CircleHelp,
  Eye,
  GraduationCap,
  Maximize,
  Piano,
  Swords,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { PartControls } from "@/components/part-controls";
import { type SoundSharing, TrackMenu } from "@/components/track-menu";
import { ScoreReadout } from "@/components/ui/score-readout";
import type { SongVoicing, Voicing } from "@/lib/audio/voicing";
import type { MelodyRate } from "@/lib/midi/melody";
import type { SongTrack } from "@/lib/midi/song";
import {
  type PlayerMode,
  type PlayerParams,
  playerPath,
} from "@/lib/player-url";
import { accuracy, type Score, scorePoints } from "@/lib/scoring/judge";
import { isLocalUrl } from "@/lib/storage/uploads";

const modeCatalog = [
  { mode: "watch", label: "Watch", icon: Eye },
  { mode: "learn", label: "Learn", icon: GraduationCap },
  { mode: "multiplayer", label: "Multiplayer", icon: Swords },
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
  melodyRate: MelodyRate;
  onMelodyRate: (rate: number) => void;
  editable: boolean;
  score: Score;
  opponent: { name: string; points: number; accuracy: number } | null;
  onToggleVisible: (index: number) => void;
  onToggleMine: (index: number) => void;
  onSolo: (index: number) => void;
  voicing: SongVoicing;
  onVoicing: ((track: number, voicing: Voicing) => void) | null;
  sound: SoundSharing | null;
  /** The render control, present only where a plain watch view can be captured
   * cleanly. */
  renderTool?: ReactNode;
  onFocus: () => void;
  onHelp: () => void;
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
  melodyRate,
  onMelodyRate,
  editable,
  score,
  opponent,
  voicing,
  onVoicing,
  sound,
  renderTool = null,
  onFocus,
  onHelp,
  onToggleVisible,
  onToggleMine,
  onSolo,
}: PlayerHeaderProps) {
  const local = isLocalUrl(params.url);
  const switchable = modeCatalog.filter((entry) =>
    mode === "multiplayer" ? false : entry.mode !== mode,
  );

  return (
    <header className="relative z-50 flex h-14 shrink-0 items-center gap-2 border-line border-b bg-panel/90 px-3 backdrop-blur sm:gap-3 sm:px-4">
      <Link
        href="/"
        data-tip="Back to search"
        data-tip-align="left"
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
        <div className="hidden shrink-0 sm:flex">
          <ScoreReadout
            points={scorePoints(score)}
            accuracy={accuracy(score)}
            combo={score.combo}
          />
        </div>
      ) : null}

      {opponent === null ? null : (
        <span className="flex shrink-0 items-center gap-2 rounded-lg border border-line-strong bg-raised px-2.5 py-1.5 font-mono text-xs">
          <span className="max-w-20 truncate">{opponent.name}</span>
          <span className="text-accent">{opponent.points}</span>
        </span>
      )}

      {interactive ? (
        <PartControls
          tracks={tracks}
          hidden={hiddenTracks}
          mine={playerTracks}
          onToggleVisible={onToggleVisible}
          onSolo={onSolo}
          voicing={voicing}
          onVoicing={onVoicing}
          sound={sound}
          onClaim={editable ? onToggleMine : null}
          simplified={simplified}
          onSimplified={editable ? onSimplified : null}
          melodyRate={melodyRate}
          onMelodyRate={editable ? onMelodyRate : null}
          whose="yours"
        />
      ) : (
        <TrackMenu
          tracks={tracks}
          hidden={hiddenTracks}
          mine={playerTracks}
          interactive={false}
          canClaim={false}
          onToggleVisible={onToggleVisible}
          onToggleMine={onToggleMine}
          onSolo={onSolo}
          voicing={voicing}
          onVoicing={onVoicing}
          sound={sound}
        />
      )}

      {renderTool}

      <button
        type="button"
        data-tour="focus"
        onClick={onFocus}
        data-tip="Just the keys and the notes"
        data-tip-align="right"
        aria-label="Focus mode"
        className="shrink-0 rounded-lg border border-line-strong p-2 text-muted transition-colors hover:border-accent hover:text-accent"
      >
        <Maximize className="size-4" aria-hidden="true" />
      </button>

      {switchable.length === 0 ? null : (
        <div data-tour="modes" className="flex shrink-0 items-center gap-2">
          {switchable.map(({ mode: target, label, icon: Icon }) =>
            local && target === "multiplayer" ? (
              <button
                key={target}
                type="button"
                aria-disabled="true"
                onClick={(event) => event.preventDefault()}
                data-tip="Uploaded files can't be shared"
                data-tip-align="right"
                aria-label="Multiplayer unavailable for uploaded files"
                className="cursor-not-allowed rounded-lg border border-line p-2 text-line-strong"
              >
                <Icon className="size-4" aria-hidden="true" />
              </button>
            ) : (
              <Link
                key={target}
                href={playerPath(target, params)}
                data-tip={`Switch to ${label.toLowerCase()}`}
                data-tip-align="right"
                aria-label={`Switch to ${label}`}
                className="rounded-lg border border-line-strong p-2 text-muted transition-colors hover:border-accent hover:text-accent"
              >
                <Icon className="size-4" aria-hidden="true" />
              </Link>
            ),
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onHelp}
        data-tip="Walk me through it"
        data-tip-align="right"
        aria-label="Tutorial"
        className="shrink-0 rounded-lg border border-line-strong p-2 text-muted transition-colors hover:border-accent hover:text-accent"
      >
        <CircleHelp className="size-4" aria-hidden="true" />
      </button>
    </header>
  );
}
