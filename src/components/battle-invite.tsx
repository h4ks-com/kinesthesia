"use client";

import { Check, Copy, Loader2, Swords } from "lucide-react";

type BattleInviteProps = {
  state: "setup" | "opening" | "waiting" | "joining";
  link: string | null;
  copied: boolean;
  onInvite: () => void;
  onCopy: () => void;
};

/** Sits over the roll while the host sets the match up, so they can play the
 * song and change the difficulty before anyone is waiting on them. */
export function BattleInvite({
  state,
  link,
  copied,
  onInvite,
  onCopy,
}: BattleInviteProps) {
  if (state === "setup") {
    return (
      <Banner>
        <span className="text-muted">
          Set the part and difficulty, have a go
        </span>
        <button
          type="button"
          onClick={onInvite}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 font-medium text-void text-xs transition-colors hover:bg-accent-glow"
        >
          <Swords className="size-3.5" aria-hidden="true" />
          Invite a player
        </button>
      </Banner>
    );
  }

  if (state === "opening" || state === "joining") {
    return (
      <Banner>
        <Loader2
          className="size-3.5 animate-spin text-accent"
          aria-hidden="true"
        />
        {state === "opening" ? "Opening the room" : "Joining the match"}
      </Banner>
    );
  }

  return (
    <Banner>
      <span className="text-muted">Send this link, then wait for them</span>
      <button
        type="button"
        onClick={onCopy}
        aria-label="Copy the invite link"
        className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border border-accent/40 px-3 py-1.5 font-mono text-accent text-xs transition-colors hover:bg-accent-soft"
      >
        <span className="truncate">{link ?? ""}</span>
        {copied ? (
          <Check className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5 shrink-0" aria-hidden="true" />
        )}
      </button>
    </Banner>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="-translate-x-1/2 rise pointer-events-auto absolute top-[4.5rem] left-1/2 z-40 flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full border border-line-strong bg-panel/95 px-3 py-1.5 text-xs backdrop-blur">
      {children}
    </div>
  );
}
