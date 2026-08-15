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
import { ShareUpload } from "@/components/share-upload";
import { defaultMelodyRate } from "@/lib/midi/melody";
import { defaultTranspose } from "@/lib/midi/song";
import {
  defaultSpeed,
  defaultStart,
  type PlayerMode,
  playerPath,
} from "@/lib/player-url";
import { isDeviceLocal } from "@/lib/trusted-url";

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
  /** How to publish this file, where an object store is configured to take it.
   * Whether it has been published already is this row's own to work out. */
  share: (() => Promise<void>) | null;
  signedIn?: boolean;
  /** Set on the row whose file has just gone online, so the control replacing
   * the confirm button takes the focus that button held. */
  justShared?: boolean;
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
  share,
  signedIn = false,
  justShared = false,
}: SongRowProps) {
  const local = isDeviceLocal(url);
  const watchHref = playerPath("watch", {
    url,
    name,
    source,
    tracks: null,
    speed: defaultSpeed,
    simplified: false,
    melodyRate: defaultMelodyRate,
    hand: null,
    transpose: defaultTranspose,
    focus: false,
    skin: null,
    rise: false,
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
        {share === null ? null : (
          <ShareUpload
            name={name}
            onShare={local ? share : null}
            sharedHref={local ? null : watchHref}
            signedIn={signedIn}
            takeFocus={justShared}
          />
        )}
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
              data-tip="Put it online first to play together"
              data-tip-side="top"
              aria-label={`Put ${name} online first to play together`}
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
                hand: null,
                transpose: defaultTranspose,
                focus: false,
                skin: null,
                rise: false,
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
