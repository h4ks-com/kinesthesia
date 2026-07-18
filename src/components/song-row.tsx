"use client";

import { ExternalLink, Eye, Piano, Star, Swords } from "lucide-react";
import Link from "next/link";
import { buildPlayerUrl, type PlayerMode } from "@/lib/player-url";

const modes = [
  { mode: "watch", label: "Watch", icon: Eye, tip: "Watch it play" },
  { mode: "play", label: "Play", icon: Piano, tip: "Play it yourself" },
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
        <p className="mt-0.5 flex items-center gap-2 font-mono text-faint text-xs">
          {source !== null && sourceUrl !== null ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 transition-colors hover:text-accent"
            >
              {source}
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          ) : (
            <span>{source}</span>
          )}
          {plays === null ? null : <span>{plays.toLocaleString()} plays</span>}
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
            href={buildPlayerUrl("http://x", mode, {
              url,
              name,
              source,
              tracks: null,
            }).replace("http://x", "")}
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
