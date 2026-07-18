"use client";

import Link from "next/link";
import { buildPlayerUrl, type PlayerMode } from "@/lib/player-url";

const modes: readonly PlayerMode[] = ["watch", "play", "battle"];

type SongRowProps = {
  name: string;
  url: string;
  source: string | null;
  detail: string | null;
  favourite: boolean;
  onToggleFavourite: () => void;
};

export function SongRow({
  name,
  url,
  source,
  detail,
  favourite,
  onToggleFavourite,
}: SongRowProps) {
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="truncate font-medium">{name}</p>
        {detail === null ? null : (
          <p className="text-sm text-zinc-500">{detail}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleFavourite}
          aria-label={
            favourite ? "Remove from favourites" : "Add to favourites"
          }
          aria-pressed={favourite}
          className="rounded-lg border border-zinc-300 px-2.5 py-2 text-sm dark:border-zinc-700"
        >
          <span aria-hidden="true">{favourite ? "★" : "☆"}</span>
        </button>
        {modes.map((mode) => (
          <Link
            key={mode}
            href={buildPlayerUrl("http://x", mode, {
              url,
              name,
              source,
              tracks: null,
            }).replace("http://x", "")}
            className="rounded-lg border border-zinc-300 px-3 py-2 font-medium text-sm capitalize dark:border-zinc-700"
          >
            {mode}
          </Link>
        ))}
      </div>
    </li>
  );
}
