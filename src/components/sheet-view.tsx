"use client";

import type {
  IOSMDOptions,
  OpenSheetMusicDisplay,
} from "opensheetmusicdisplay";
import { useEffect, useRef, useState } from "react";
import type { Song, Transpose } from "@/lib/midi/song";
import { loadSheetMusic } from "@/lib/sheet/load";
import type { SheetMusic } from "@/lib/sheet/types";

type SheetViewProps = {
  url: string;
  song: Song;
  transpose: Transpose;
  /** The song position in seconds, read every animation frame: the same
   * clock the falling notes read, so the notation cursor tracks it exactly. */
  getPosition: () => number;
};

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly sheet: SheetMusic }
  | { readonly status: "failed"; readonly message: string };

const shell =
  "flex h-full items-center justify-center bg-panel px-4 text-center text-muted text-sm";

export function SheetView({
  url,
  song,
  transpose,
  getPosition,
}: SheetViewProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void loadSheetMusic(url, song, transpose)
      .then((sheet) => {
        if (!cancelled) {
          setState({ status: "ready", sheet });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setState({
          status: "failed",
          message:
            error instanceof Error
              ? error.message
              : "That song could not be turned into notation.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [url, song, transpose]);

  if (state.status === "loading") {
    return (
      <div data-testid="sheet-view" className={shell}>
        Loading notation
      </div>
    );
  }
  if (state.status === "failed") {
    return (
      <div data-testid="sheet-view" className={shell}>
        {state.message}
      </div>
    );
  }
  return <Notation sheet={state.sheet} getPosition={getPosition} />;
}

/** Slack against a small clock jitter before treating a lower reading as a
 * seek backward and resetting the cursor, rather than the scheduler's normal
 * forward wobble. */
const rewindSlack = 0.05;

const musicColor = "#e8ecf3";
const cursorColor = "#4c9eff";

function Notation({
  sheet,
  getPosition,
}: {
  sheet: SheetMusic;
  getPosition: () => number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    container.innerHTML = "";
    void import("opensheetmusicdisplay")
      .then(async ({ OpenSheetMusicDisplay, CursorType }) => {
        if (cancelled) {
          return;
        }
        const options: IOSMDOptions = {
          backend: "svg",
          drawTitle: false,
          drawPartNames: false,
          drawComposer: false,
          followCursor: true,
          defaultColorMusic: musicColor,
          cursorsOptions: [
            {
              type: CursorType.Standard,
              color: cursorColor,
              alpha: 0.25,
              follow: true,
            },
          ],
        };
        const osmd = new OpenSheetMusicDisplay(container, options);
        await osmd.load(sheet.musicXml);
        if (cancelled) {
          return;
        }
        osmd.render();
        osmd.cursor.show();
        osmdRef.current = osmd;
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setError("This song's notation could not be drawn.");
        }
      });
    return () => {
      cancelled = true;
      osmdRef.current = null;
    };
  }, [sheet]);

  // A resize of this panel (half turning to full, or a window resize the
  // library's own listener does not catch because layout, not the window,
  // changed) needs a fresh layout pass, or the notation stays the width it
  // was first drawn at.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null || !ready) {
      return;
    }
    let pending: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (pending !== null) {
        clearTimeout(pending);
      }
      pending = setTimeout(() => {
        const osmd = osmdRef.current;
        if (osmd === null) {
          return;
        }
        osmd.render();
        osmd.cursor.show();
      }, 120);
    });
    observer.observe(container);
    return () => {
      if (pending !== null) {
        clearTimeout(pending);
      }
      observer.disconnect();
    };
  }, [ready]);

  // Steps the cursor forward across the note it just crossed, on the same
  // clock the falling notes read. OSMD's cursor is a stepper with no seek, so
  // a position behind where the cursor already is means a scrub backward:
  // reset and fast-forward back to it instead of stepping past the end.
  const cursorIndex = useRef(0);
  useEffect(() => {
    if (!ready) {
      return;
    }
    cursorIndex.current = 0;
    let frame = 0;
    const step = (): void => {
      const osmd = osmdRef.current;
      if (osmd !== null) {
        const position = getPosition();
        const onsets = sheet.cursorOnsets;
        if (position < (onsets[cursorIndex.current] ?? 0) - rewindSlack) {
          osmd.cursor.reset();
          cursorIndex.current = 0;
        }
        let moved = false;
        while (
          cursorIndex.current + 1 < onsets.length &&
          position >=
            (onsets[cursorIndex.current + 1] ?? Number.POSITIVE_INFINITY)
        ) {
          osmd.cursor.next();
          cursorIndex.current += 1;
          moved = true;
        }
        if (moved) {
          osmd.cursor.cursorElement?.scrollIntoView({
            block: "nearest",
            behavior: "auto",
          });
        }
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [ready, sheet, getPosition]);

  return (
    <div
      data-testid="sheet-view"
      className="relative h-full overflow-auto bg-panel"
    >
      {error === null ? null : (
        <div className={shell}>
          <span className="absolute inset-0 flex items-center justify-center">
            {error}
          </span>
        </div>
      )}
      {/* The engraver fills this with hundreds of unnamed paths for the staves,
          stems and beams. The falling notes carry the same music in a form a
          screen reader can already be told about, so this stays out of the
          tree rather than reading as a wall of graphics. */}
      <div
        ref={containerRef}
        aria-hidden="true"
        className="min-h-full w-full px-3 py-4"
      />
    </div>
  );
}
