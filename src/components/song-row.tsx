"use client";

import { ExternalLink, Eye, GraduationCap, Star, Swords } from "lucide-react";
import Link from "next/link";
import { defaultSpeed, type PlayerMode, playerPath } from "@/lib/player-url";

const modes = [
  { mode: "watch", label: "Watch", icon: Eye, tip: "Watch it play" },
  {
    mode: "learn",
    label: "Learn",
    icon: GraduationCap,
    tip: "Learn it yourself",
  },
  { mode: "battle", label: "Battle", icon: Swords, tip: "Challenge someone" },
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
};

export function SongRow({
  name,
  url,
  source,
  sourceUrl,
  plays,
  favorite,
  onToggleFavorite,
}: SongRowProps) {
  return (
    <li className="group flex items-center justify-between gap-4 rounded-xl border border-transparent px-3 py-2.5 transition-colors hover:border-line hover:bg-panel">
      <div className="min-w-0">
        <p className="truncate font-medium">{name}</p>
        <p className="mt-0.5 truncate font-mono text-faint text-xs">
          {source !== null && sourceUrl !== null ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1 align-bottom transition-colors hover:text-accent"
            >
              <span className="truncate">{source}</span>
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            </a>
          ) : (
            <span>{source}</span>
          )}
          {plays === null ? null : (
            <span className="ml-2">{plays.toLocaleString()} plays</span>
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
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
        {modes.map(({ mode, label, icon: Icon, tip }) => (
          <Link
            key={mode}
            href={playerPath(mode, {
              url,
              name,
              source,
              tracks: null,
              speed: defaultSpeed,
            })}
            data-tip={tip}
            data-tip-side="top"
            aria-label={`${label} ${name}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 font-medium text-sm transition-colors hover:border-accent hover:text-accent"
          >
            <Icon className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        ))}
      </div>
    </li>
  );
}
