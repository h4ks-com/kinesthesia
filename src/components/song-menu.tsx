"use client";

import {
  Check,
  ChevronDown,
  Download,
  Globe,
  Link2,
  Loader2,
  Star,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Popover } from "@/components/ui/popover";
import { downloadBlob, downloadName } from "@/lib/download";
import { readSongBytes } from "@/lib/midi/song";
import {
  type PlayerMode,
  type PlayerParams,
  playerPath,
} from "@/lib/player-url";
import { isFavourite, toggleFavourite } from "@/lib/storage/library";
import { permanenceWarning, publishUpload } from "@/lib/storage/publish";
import { isDeviceLocal } from "@/lib/trusted-url";

type SongMenuProps = {
  mode: PlayerMode;
  /** The view as it stands, so the link handed out opens on what is on screen. */
  params: PlayerParams;
  /** The name without its file extension, which is noise on a title. */
  title: string;
  trackCount: number;
  signedIn: boolean;
  shareEnabled: boolean;
  /** Where the file landed, for whoever owns the address this page is on. */
  onPublished: (url: string) => void;
};

const copiedFor = 1600;

export function SongMenu({
  mode,
  params,
  title,
  trackCount,
  signedIn,
  shareEnabled,
  onPublished,
}: SongMenuProps) {
  const [starred, setStarred] = useState(false);
  const [copied, setCopied] = useState(false);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  /** The link, where the browser refused to take it, so it stays reachable by
   * hand rather than the control appearing to do nothing. */
  const [refused, setRefused] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) {
        clearTimeout(copiedTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    void isFavourite(params.source, params.url).then(setStarred);
  }, [params.source, params.url]);

  const local = isDeviceLocal(params.url);

  function copy(): void {
    const here = new URL(window.location.href);
    // A match joiner arrives on a single use invite that names no song, so the
    // view is rebuilt from what is playing rather than handed out as an invite
    // the room has already consumed.
    const link = here.searchParams.has("url")
      ? here.href
      : new URL(playerPath(mode, params), here).href;
    if (navigator.clipboard === undefined) {
      setRefused(link);
      return;
    }
    void navigator.clipboard
      .writeText(link)
      .then(() => {
        setCopied(true);
        if (copiedTimer.current !== null) {
          clearTimeout(copiedTimer.current);
        }
        copiedTimer.current = setTimeout(() => setCopied(false), copiedFor);
      })
      .catch(() => setRefused(link));
  }

  async function download(): Promise<void> {
    setFailed(null);
    setWorking(true);
    try {
      const bytes = await readSongBytes(params.url);
      downloadBlob(
        new Blob([bytes], { type: "audio/midi" }),
        downloadName(title, "mid"),
      );
    } catch (error) {
      setFailed(
        error instanceof Error
          ? error.message
          : "That file would not download.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function publish(): Promise<void> {
    setFailed(null);
    setWorking(true);
    try {
      onPublished(await publishUpload(params.url));
    } catch (error) {
      setFailed(error instanceof Error ? error.message : "The upload failed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Popover
      label="This song"
      align="left"
      trigger={(open) => (
        <span
          className={`flex min-w-0 items-center gap-1 rounded-lg px-1.5 py-1 text-sm transition-colors ${
            open ? "text-text" : "text-muted hover:text-text"
          }`}
        >
          <span className="max-w-[40vw] truncate sm:max-w-xs">{title}</span>
          <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
        </span>
      )}
    >
      <div className="flex w-64 flex-col gap-0.5 max-sm:w-full">
        <div className="px-2.5 pt-1.5 pb-2">
          <p className="truncate font-medium text-sm">{title}</p>
          <p className="font-mono text-[0.7rem] text-faint">
            {local ? "on this device" : (params.source ?? "by link")} ·{" "}
            {trackCount} {trackCount === 1 ? "part" : "parts"}
          </p>
        </div>

        <Row
          icon={working ? Loader2 : Download}
          label="Download MIDI"
          spin={working}
          onClick={() => void download()}
        />

        {local ? null : (
          <Row
            icon={copied ? Check : Link2}
            label={copied ? "Copied" : "Copy link"}
            onClick={copy}
          />
        )}

        <Row
          icon={Star}
          label={starred ? "Remove favorite" : "Favorite"}
          filled={starred}
          onClick={() =>
            void toggleFavourite({
              url: params.url,
              name: params.name,
              source: params.source,
            }).then(setStarred)
          }
        />

        {!local || !shareEnabled ? null : signedIn ? (
          <Row
            icon={Globe}
            label="Put it online"
            note={permanenceWarning}
            onClick={() => void publish()}
          />
        ) : (
          <Row icon={Globe} label="Sign in to put it online" onClick={null} />
        )}

        {failed === null ? null : (
          <p className="px-2.5 py-1.5 text-danger text-xs">{failed}</p>
        )}

        {refused === null ? null : (
          <input
            readOnly
            value={refused}
            aria-label={`Link to ${title}`}
            onFocus={(event) => event.currentTarget.select()}
            className="mx-2.5 mb-1.5 min-w-0 truncate bg-transparent font-mono text-accent text-xs outline-none"
          />
        )}
      </div>
    </Popover>
  );
}

function Row({
  icon: Icon,
  label,
  note,
  onClick,
  filled = false,
  spin = false,
}: {
  icon: typeof Download;
  label: string;
  note?: string;
  onClick: (() => void) | null;
  filled?: boolean;
  spin?: boolean;
}): ReactNode {
  return (
    <button
      type="button"
      aria-disabled={onClick === null ? "true" : undefined}
      onClick={onClick ?? ((event) => event.preventDefault())}
      className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
        onClick === null
          ? "cursor-not-allowed text-faint/60"
          : "text-muted hover:bg-raised hover:text-text"
      }`}
    >
      <Icon
        className={`mt-0.5 size-4 shrink-0 ${spin ? "animate-spin text-accent" : ""} ${
          filled ? "fill-accent text-accent" : ""
        }`}
        aria-hidden="true"
      />
      <span className="min-w-0">
        {label}
        {note === undefined ? null : (
          <span className="mt-0.5 block text-[0.7rem] text-faint leading-snug">
            {note}
          </span>
        )}
      </span>
    </button>
  );
}
