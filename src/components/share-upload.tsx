"use client";

import { Check, Globe, Link2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type ShareUploadProps = {
  name: string;
  onShare: (() => Promise<void>) | null;
  /** The player path to hand out, resolved against this origin when copied. */
  sharedHref: string | null;
  signedIn: boolean;
};

const copiedFor = 1600;

export function ShareUpload({
  name,
  onShare,
  sharedHref,
  signedIn,
}: ShareUploadProps) {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  /** Shown when the browser refuses the clipboard, so the link is still
   * reachable rather than lost with the panel. */
  const [refused, setRefused] = useState<string | null>(null);
  const shell = useRef<HTMLDivElement | null>(null);
  const copyRef = useRef<HTMLButtonElement | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) {
        clearTimeout(copiedTimer.current);
      }
    },
    [],
  );

  // The confirm button unmounts the moment the file lands, so focus is moved
  // to what replaced it rather than falling back to the top of the page.
  useEffect(() => {
    if (sharedHref !== null) {
      copyRef.current?.focus();
    }
  }, [sharedHref]);

  useEffect(() => {
    if (!open || working) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        shell.current !== null &&
        !shell.current.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, working]);

  if (sharedHref !== null) {
    return (
      <>
        <p aria-live="polite" role="status" className="sr-only">
          {copied ? `Link to ${name} copied` : ""}
        </p>
        <button
          ref={copyRef}
          type="button"
          onClick={() => {
            const link = new URL(sharedHref, window.location.origin).toString();
            void navigator.clipboard
              ?.writeText(link)
              .then(() => {
                setCopied(true);
                if (copiedTimer.current !== null) {
                  clearTimeout(copiedTimer.current);
                }
                copiedTimer.current = setTimeout(
                  () => setCopied(false),
                  copiedFor,
                );
              })
              .catch(() => setRefused(link));
          }}
          aria-label={`Copy the link to ${name}`}
          data-tip={copied ? "Copied" : "Copy link"}
          data-tip-side="top"
          className="rounded-lg p-2 text-muted transition-colors hover:bg-raised hover:text-accent"
        >
          {copied ? (
            <Check className="size-4 text-accent" aria-hidden="true" />
          ) : (
            <Link2 className="size-4" aria-hidden="true" />
          )}
        </button>
        {refused === null ? null : (
          <input
            readOnly
            value={refused}
            aria-label={`Link to ${name}`}
            onFocus={(event) => event.currentTarget.select()}
            className="w-40 min-w-0 truncate bg-transparent font-mono text-accent text-xs outline-none"
          />
        )}
      </>
    );
  }

  if (!signedIn) {
    return (
      <button
        type="button"
        aria-disabled="true"
        onClick={(event) => event.preventDefault()}
        aria-label={`Sign in to put ${name} online`}
        data-tip="Sign in to share"
        data-tip-side="top"
        className="cursor-not-allowed rounded-lg p-2 text-faint/50"
      >
        <Globe className="size-4" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div ref={shell} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={`Put ${name} online`}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-tip="Put it online"
        data-tip-side="top"
        className={`rounded-lg p-2 transition-colors hover:bg-raised hover:text-accent ${
          open ? "text-accent" : "text-muted"
        }`}
      >
        <Globe className="size-4" aria-hidden="true" />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={`Put ${name} online`}
          className="absolute right-0 z-50 mt-1 w-60 rounded-lg border border-line-strong bg-raised p-3 text-left shadow-xl"
        >
          <p className="mb-2.5 text-text text-xs leading-relaxed">
            Anyone with the link can play {name}, and you cannot take it down.
            The copy stays online.
          </p>
          {failed === null ? null : (
            <p className="mb-2.5 text-danger text-xs">{failed}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={working}
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-1 font-mono text-faint text-xs transition-colors hover:text-text disabled:opacity-40"
            >
              cancel
            </button>
            <button
              type="button"
              disabled={working}
              onClick={() => {
                if (onShare === null) {
                  return;
                }
                setWorking(true);
                setFailed(null);
                void onShare()
                  .then(() => setOpen(false))
                  .catch((error: unknown) =>
                    setFailed(
                      error instanceof Error
                        ? error.message
                        : "The upload failed.",
                    ),
                  )
                  .finally(() => setWorking(false));
              }}
              className="rounded-md border border-accent/50 px-2 py-1 font-mono text-accent text-xs transition-colors hover:bg-accent/10 disabled:opacity-50"
            >
              {working ? "putting it online" : "put it online"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
