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
  coop: boolean;
  /** Null for a joiner, whose side is whatever the host prepared. */
  onCoop: ((coop: boolean) => void) | null;
  onInvite: () => void;
  onCopy: () => void;
};

/** Sits over the roll while the host sets the match up, so they can play the
 * song and change the difficulty before anyone is waiting on them. */
export function MultiplayerInvite({
  connection,
  copyState,
  coop,
  onCoop,
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

  if (connection.status === "opening" || connection.status === "joining") {
    return (
      <Banner>
        <Loader2
          className="size-3.5 animate-spin text-accent"
          aria-hidden="true"
        />
        {connection.status === "opening"
          ? "Opening the room"
          : "Joining the match"}
      </Banner>
    );
  }

  if (connection.status === "waiting") {
    return (
      <Banner>
        <span className="text-muted">
          {copyState === "denied"
            ? "Copy this link, then wait"
            : "Sent, waiting"}
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
      </Banner>
    );
  }

  return (
    <Banner>
      {onCoop === null ? null : <CoopToggle coop={coop} onCoop={onCoop} />}
      {connection.status === "failed" ? (
        <span className="text-danger">{connection.message}</span>
      ) : (
        <span className="text-muted">
          {coop ? "Set each side's part" : "Set the part and difficulty"}
        </span>
      )}
      <button
        type="button"
        onClick={onInvite}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 font-medium text-void text-xs transition-colors hover:bg-accent-glow"
      >
        <Swords className="size-3.5" aria-hidden="true" />
        {connection.status === "failed" ? "Try again" : "Invite a player"}
      </button>
    </Banner>
  );
}

/** Battle locks both sides to one part; co-op lets the host set a part per
 * side. */
function CoopToggle({
  coop,
  onCoop,
}: {
  coop: boolean;
  onCoop: (coop: boolean) => void;
}) {
  return (
    <fieldset className="flex shrink-0 items-center rounded-full border border-line-strong p-0.5">
      <legend className="sr-only">Match type</legend>
      <button
        type="button"
        aria-pressed={!coop}
        onClick={() => onCoop(false)}
        className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${
          coop ? "text-muted hover:text-text" : "bg-accent text-void"
        }`}
      >
        Battle
      </button>
      <button
        type="button"
        aria-pressed={coop}
        onClick={() => onCoop(true)}
        className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${
          coop ? "bg-accent text-void" : "text-muted hover:text-text"
        }`}
      >
        Co-op
      </button>
    </fieldset>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="-translate-x-1/2 rise pointer-events-auto absolute top-[4.5rem] left-1/2 z-40 flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full border border-line-strong bg-panel/95 px-3 py-1.5 text-xs backdrop-blur"
    >
      {children}
    </div>
  );
}
