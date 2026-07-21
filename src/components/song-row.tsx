"use client";

import {
  ExternalLink,
  Eye,
  GraduationCap,
  Star,
  Swords,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { defaultMelodyRate } from "@/lib/midi/melody";
import { defaultTranspose } from "@/lib/midi/song";
import {
  defaultSpeed,
  defaultStart,
  type PlayerMode,
  playerPath,
} from "@/lib/player-url";
import { isLocalUrl } from "@/lib/storage/uploads";

const modes = [
  { mode: "watch", label: "Watch", icon: Eye, tip: "Watch it play" },
  {
    mode: "learn",
    label: "Learn",
    icon: GraduationCap,
    tip: "Learn it yourself",
  },
  {
    mode: "multiplayer",
    label: "Multiplayer",
    icon: Swords,
    tip: "Play together",
  },
] as const satisfies readonly {
  mode: PlayerMode;
  label: string;
  icon: typeof Eye;
  tip: string;
}[];

type SongRowProps = {
  name: string;
  url: string;
  source: string | null;
  sourceUrl: string | null;
  plays: number | null;
  favorite: boolean;
  onToggleFavorite: () => void;
  /** When set, a remove control drops this one entry, used for uploads. */
  onRemove?: () => void;
};

export function SongRow({
  name,
  url,
  source,
  sourceUrl,
  plays,
  favorite,
  onToggleFavorite,
  onRemove,
}: SongRowProps) {
  const local = isLocalUrl(url);
  const watchHref = playerPath("watch", {
    url,
    name,
    source,
    tracks: null,
    speed: defaultSpeed,
    simplified: false,
    melodyRate: defaultMelodyRate,
    transpose: defaultTranspose,
    focus: false,
    start: defaultStart,
  });

  return (
    <li className="group flex min-w-0 items-center justify-between gap-3 rounded-xl border border-transparent px-3 py-2.5 transition-colors hover:border-line hover:bg-panel">
      <div className="min-w-0 flex-1">
        <Link
          href={watchHref}
          className="block truncate font-medium transition-colors hover:text-accent"
        >
          {name}
        </Link>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 font-mono text-faint text-xs">
          {source === null || local ? (
            <span className="truncate">{source}</span>
          ) : sourceUrl !== null ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="flex min-w-0 items-center gap-1 transition-colors hover:text-accent"
            >
              <span className="truncate">{source}</span>
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            </a>
          ) : (
            <Link
              href="/sources"
              className="truncate transition-colors hover:text-accent"
            >
              {source}
            </Link>
          )}
          {plays === null ? null : (
            <span className="shrink-0">{plays.toLocaleString()} plays</span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {onRemove === undefined ? null : (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${name}`}
            data-tip="Remove"
            data-tip-side="top"
            className="rounded-lg p-2 text-muted transition-colors hover:bg-raised hover:text-danger"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          onClick={onToggleFavorite}
          aria-pressed={favorite}
          aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
          data-tip={favorite ? "Remove favorite" : "Favorite"}
          data-tip-side="top"
          className="rounded-lg p-2 text-muted transition-colors hover:bg-raised hover:text-accent"
        >
          <Star
            className={`size-4 ${favorite ? "fill-accent text-accent" : ""}`}
            aria-hidden="true"
          />
        </button>
        {modes.map(({ mode, label, icon: Icon, tip }) =>
          local && mode === "multiplayer" ? (
            <button
              key={mode}
              type="button"
              aria-disabled="true"
              onClick={(event) => event.preventDefault()}
              data-tip="Uploaded files can't be shared"
              data-tip-side="top"
              aria-label="Multiplayer unavailable for uploaded files"
              className="cursor-not-allowed rounded-lg border border-line p-2 text-line-strong"
            >
              <Icon className="size-4" aria-hidden="true" />
            </button>
          ) : (
            <Link
              key={mode}
              href={playerPath(mode, {
                url,
                name,
                source,
                tracks: null,
                speed: defaultSpeed,
                simplified: false,
                melodyRate: defaultMelodyRate,
                transpose: defaultTranspose,
                focus: false,
                start: defaultStart,
              })}
              data-tip={tip}
              data-tip-side="top"
              aria-label={`${label} ${name}`}
              className="rounded-lg border border-line-strong p-2 text-muted transition-colors hover:border-accent hover:text-accent"
            >
              <Icon className="size-4" aria-hidden="true" />
            </Link>
          ),
        )}
      </div>
    </li>
  );
}
