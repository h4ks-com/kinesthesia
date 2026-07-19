"use client";

import { Check, Copy, Loader2, Swords } from "lucide-react";
import { useEffect, useRef } from "react";

export type InviteConnection =
  | { status: "setup" }
  | { status: "opening" }
  | { status: "waiting"; link: string }
  | { status: "joining" }
  | { status: "failed"; message: string }
  | { status: "connected" };

type MultiplayerInviteProps = {
  connection: InviteConnection;
  copyState: "idle" | "copied" | "denied";
  onInvite: () => void;
  onCopy: () => void;
};

export function MultiplayerInvite({
  connection,
  copyState,
  onInvite,
  onCopy,
}: MultiplayerInviteProps) {
  const copyRef = useRef<HTMLButtonElement | null>(null);
  const waiting = connection.status === "waiting";

  useEffect(() => {
    if (waiting) {
      copyRef.current?.focus();
    }
  }, [waiting]);

  if (connection.status === "connected") {
    return null;
  }

  if (connection.status === "opening" || connection.status === "joining") {
    return (
      <span className="flex items-center gap-2 text-muted text-xs">
        <Loader2
          className="size-3.5 animate-spin text-accent"
          aria-hidden="true"
        />
        {connection.status === "opening"
          ? "Opening the room"
          : "Joining the match"}
      </span>
    );
  }

  if (connection.status === "waiting") {
    return (
      <>
        <span className="shrink-0 text-muted text-xs">
          {copyState === "denied" ? "Copy this link" : "Sent, waiting"}
        </span>
        <input
          readOnly
          value={connection.link}
          aria-label="Invite link"
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 truncate bg-transparent font-mono text-accent text-xs outline-none"
        />
        <button
          ref={copyRef}
          type="button"
          onClick={onCopy}
          aria-label="Copy the invite link"
          className="inline-flex shrink-0 items-center rounded-full border border-accent/40 p-1.5 text-accent transition-colors hover:bg-accent-soft"
        >
          {copyState === "copied" ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
        </button>
      </>
    );
  }

  return (
    <>
      <span className="min-w-0 flex-1 truncate text-danger text-xs">
        {connection.status === "failed" ? connection.message : null}
      </span>
      <button
        type="button"
        onClick={onInvite}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 font-medium text-void text-xs transition-colors hover:bg-accent-glow"
      >
        <Swords className="size-3.5" aria-hidden="true" />
        {connection.status === "failed" ? "Try again" : "Invite a player"}
      </button>
    </>
  );
}
