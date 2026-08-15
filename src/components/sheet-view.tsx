"use client";

import { Contrast } from "lucide-react";
import type {
  IOSMDOptions,
  OpenSheetMusicDisplay,
} from "opensheetmusicdisplay";
import { useEffect, useRef, useState } from "react";
import { formatClock } from "@/lib/format/clock";
import type { Song, Transpose } from "@/lib/midi/song";
import { loadSheetMusic } from "@/lib/sheet/load";
import { sheetColors } from "@/lib/sheet/theme";
import type { SheetMusic, SheetTheme } from "@/lib/sheet/types";

type SheetViewProps = {
  url: string;
  song: Song;
  transpose: Transpose;
  /** The song position in seconds, read every animation frame: the same
   * clock the falling notes read, so the notation cursor tracks it exactly. */
  getPosition: () => number;
  /** Coarse position for the progress rail's controlled value and its
   * accessible label; the rail's own smooth motion still reads getPosition
   * on every frame, the same split SongMinimap uses. */
  elapsed: number;
  playing: boolean;
  onSeek: ((position: number) => void) | null;
  theme: SheetTheme;
  onTheme: (next: SheetTheme) => void;
};

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly sheet: SheetMusic }
  | { readonly status: "failed"; readonly message: string };

function shellClass(theme: SheetTheme): string {
  const surface =
    theme === "light" ? "bg-paper text-ink/70" : "bg-panel text-muted";
  return `flex h-full items-center justify-center px-4 text-center text-sm ${surface}`;
}

export function SheetView({
  url,
  song,
  transpose,
  getPosition,
  elapsed,
  playing,
  onSeek,
  theme,
  onTheme,
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
      <div data-testid="sheet-view" className={shellClass(theme)}>
        Loading notation
      </div>
    );
  }
  if (state.status === "failed") {
    return (
      <div data-testid="sheet-view" className={shellClass(theme)}>
        {state.message}
      </div>
    );
  }
  return (
    <Notation
      sheet={state.sheet}
      duration={song.duration}
      getPosition={getPosition}
      elapsed={elapsed}
      playing={playing}
      onSeek={onSeek}
      theme={theme}
      onTheme={onTheme}
    />
  );
}

/** Slack against a small clock jitter before treating a lower reading as a
 * seek backward and resetting the cursor, rather than the scheduler's normal
 * forward wobble. */
const rewindSlack = 0.05;

/** Where the current system settles once following is running: a third of
 * the way down the panel, so there is always more of what is coming than of
 * what has passed. */
const followBand = 1 / 3;

/** How long a scroll the user made by hand keeps following paused. */
const followResumeMs = 2200;

/** How long following chases a seek made while the music is stopped, which is
 * the one thing that moves the notation when nobody is playing. */
const followSeekMs = 1200;

/** Exponential time constant for the eased catch-up scroll, so it glides
 * rather than snapping even across a big jump. */
const followTauMs = 220;

/** Puts a cursor's height back after the stylesheet's `img { height: auto }`
 * reset takes it away. OSMD draws a one pixel tall image and stretches it to
 * the staff with the `height` attribute, which any rule at all outranks, so the
 * marker collapses to that single pixel. Mirroring the attribute inline is the
 * one place nothing else can reach. */
function fitCursor(element: HTMLImageElement | null): void {
  if (element === null) {
    return;
  }
  const height = element.getAttribute("height");
  if (height === null) {
    return;
  }
  if (element.style.height !== `${height}px`) {
    element.style.height = `${height}px`;
  }
}

function Notation({
  sheet,
  duration,
  getPosition,
  elapsed,
  playing,
  onSeek,
  theme,
  onTheme,
}: {
  sheet: SheetMusic;
  duration: number;
  getPosition: () => number;
  elapsed: number;
  playing: boolean;
  onSeek: ((position: number) => void) | null;
  theme: SheetTheme;
  onTheme: (next: SheetTheme) => void;
}) {
  const isLocked = playing && onSeek !== null;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    const host = hostRef.current;
    if (host === null) {
      return;
    }
    host.innerHTML = "";
    void import("opensheetmusicdisplay")
      .then(async ({ OpenSheetMusicDisplay, CursorType }) => {
        if (cancelled) {
          return;
        }
        const colors = sheetColors(theme);
        const options: IOSMDOptions = {
          backend: "svg",
          drawTitle: false,
          drawPartNames: false,
          drawComposer: false,
          // OSMD's own follow scrolls the page itself on every cursor.next();
          // the panel drives its own eased, pausable scroll instead, so both
          // must stay off or the two fight over the same scrollTop.
          followCursor: false,
          defaultColorMusic: colors.music,
          cursorsOptions: [
            {
              type: CursorType.Standard,
              color: colors.cursor,
              alpha: colors.cursorAlpha,
              follow: false,
            },
            {
              type: CursorType.ThinLeft,
              color: colors.next,
              alpha: colors.nextAlpha,
              follow: false,
            },
          ],
        };
        const osmd = new OpenSheetMusicDisplay(host, options);
        await osmd.load(sheet.musicXml);
        if (cancelled) {
          return;
        }
        osmd.render();
        osmd.cursor.show();
        // Shown where it stands and moved only by the frame loop below, which
        // counts its own steps: advancing it here as well puts the real cursor
        // a step ahead of that count, and it marks two notes on rather than the
        // one about to sound.
        osmd.cursors[1]?.show();
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
  }, [sheet, theme]);

  // A resize of this panel (half turning to full, or a window resize the
  // library's own listener does not catch because layout, not the window,
  // changed) needs a fresh layout pass, or the notation stays the width it
  // was first drawn at.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null || !ready) {
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
        osmd.cursors[1]?.show();
        // Laid out again, the cursor is somewhere else on the page entirely,
        // so the panel goes and finds it even with the music stopped.
        chaseUntil.current = performance.now() + followSeekMs;
        lastManualScroll.current = Number.NEGATIVE_INFINITY;
      }, 120);
    });
    observer.observe(host);
    return () => {
      if (pending !== null) {
        clearTimeout(pending);
      }
      observer.disconnect();
    };
  }, [ready]);

  // Steps both cursors forward on the clock the falling notes already read,
  // keeps the current system in view with an eased scroll that yields to a
  // scroll the listener makes by hand, and settles the second cursor one
  // onset ahead of the first. OSMD's cursor is a stepper with no seek, so a
  // position behind where it already is means a scrub backward: reset and
  // fast-forward both cursors back to it instead of stepping past the end.
  const cursorIndex = useRef(0);
  const nextCursorIndex = useRef(0);
  const expectedScrollTop = useRef(0);
  const lastManualScroll = useRef(Number.NEGATIVE_INFINITY);
  const lastFrameTime = useRef(0);
  const followedIndex = useRef(-1);
  const chaseUntil = useRef(Number.NEGATIVE_INFINITY);
  // Read inside the frame loop rather than listed as a dependency: restarting
  // that effect zeroes the cursor counters while the drawn cursors stay where
  // they stood, so every play and pause would leave the notation a few notes
  // behind the music.
  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
    if (playing) {
      lastManualScroll.current = Number.NEGATIVE_INFINITY;
      return;
    }
    // Stopping stops the scroll with it, rather than letting the chase from
    // the last onset crossed carry the page on for another second.
    chaseUntil.current = Number.NEGATIVE_INFINITY;
  }, [playing]);
  useEffect(() => {
    if (!ready) {
      return;
    }
    const scrollEl = scrollRef.current;
    // A scroll still arrives from the keyboard while the pointer is refused,
    // and it is honoured on the same terms as any other: yielded to, rather
    // than dragged back on the next frame.
    const onScroll = (): void => {
      if (scrollEl === null) {
        return;
      }
      if (Math.abs(scrollEl.scrollTop - expectedScrollTop.current) > 2) {
        lastManualScroll.current = performance.now();
      }
    };
    scrollEl?.addEventListener("scroll", onScroll, { passive: true });

    cursorIndex.current = 0;
    nextCursorIndex.current = 0;
    lastFrameTime.current = 0;
    followedIndex.current = -1;
    // Emptied and redrawn, the panel is briefly short enough that the browser
    // clamps how far it was scrolled, which arrives as a scroll nobody made.
    // Taking the position as it stands now is what keeps that from reading as
    // a listener scrolling by hand and pausing the follow.
    expectedScrollTop.current = scrollEl?.scrollTop ?? 0;
    lastManualScroll.current = Number.NEGATIVE_INFINITY;
    let frame = 0;
    const step = (): void => {
      const osmd = osmdRef.current;
      const now = performance.now();
      const dt = lastFrameTime.current === 0 ? 16 : now - lastFrameTime.current;
      lastFrameTime.current = now;

      if (osmd !== null) {
        const onsets = sheet.cursorOnsets;
        const lastIndex = onsets.length - 1;
        const position = getPosition();
        if (position < (onsets[cursorIndex.current] ?? 0) - rewindSlack) {
          osmd.cursor.reset();
          cursorIndex.current = 0;
          osmd.cursors[1]?.reset();
          nextCursorIndex.current = 0;
        }
        while (
          cursorIndex.current < lastIndex &&
          position >=
            (onsets[cursorIndex.current + 1] ?? Number.POSITIVE_INFINITY)
        ) {
          osmd.cursor.next();
          cursorIndex.current += 1;
        }
        const desiredNext = Math.min(cursorIndex.current + 1, lastIndex);
        while (nextCursorIndex.current < desiredNext) {
          osmd.cursors[1]?.next();
          nextCursorIndex.current += 1;
        }
        fitCursor(osmd.cursor.cursorElement);
        fitCursor(osmd.cursors[1]?.cursorElement ?? null);

        if (scrollEl !== null) {
          const cursorEl = osmd.cursor.cursorElement;
          if (cursorEl !== null) {
            const hostBox = scrollEl.getBoundingClientRect();
            const cursorBox = cursorEl.getBoundingClientRect();
            const cursorTop = cursorBox.top - hostBox.top + scrollEl.scrollTop;
            const maxScroll = Math.max(
              0,
              scrollEl.scrollHeight - scrollEl.clientHeight,
            );
            const target = Math.max(
              0,
              Math.min(maxScroll, cursorTop - hostBox.height * followBand),
            );
            if (followedIndex.current !== cursorIndex.current) {
              followedIndex.current = cursorIndex.current;
              chaseUntil.current = now + followSeekMs;
              // Asking for a bar is asking to be taken to it, so a seek
              // outranks a scroll made a moment earlier. The two windows
              // overlap, and the older one would otherwise swallow it.
              if (!playingRef.current) {
                lastManualScroll.current = Number.NEGATIVE_INFINITY;
              }
            }
            const hasYielded = now - lastManualScroll.current < followResumeMs;
            const isFollowing = playingRef.current || now < chaseUntil.current;
            if (!hasYielded && isFollowing) {
              const alpha = 1 - Math.exp(-dt / followTauMs);
              scrollEl.scrollTop += (target - scrollEl.scrollTop) * alpha;
              expectedScrollTop.current = scrollEl.scrollTop;
            }
          }
        }
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      scrollEl?.removeEventListener("scroll", onScroll);
    };
  }, [ready, sheet, getPosition]);

  return (
    <div data-testid="sheet-view" className="relative flex h-full">
      <SheetProgress
        duration={duration}
        elapsed={elapsed}
        getPosition={getPosition}
        onSeek={onSeek}
        theme={theme}
      />
      {/* A scroll container that stops being one loses where it was scrolled
          to, so the lock refuses the wheel and the finger and leaves the
          scrolling in place. Locked only while the reader can stop the music:
          a match hides the transport and disables the rail, and taking the
          page as well would leave nothing that moves the score at all. */}
      <div
        ref={scrollRef}
        data-testid="sheet-scroll"
        className={`relative h-full min-w-0 flex-1 overflow-auto ${
          isLocked ? "pointer-events-none" : ""
        } ${theme === "light" ? "bg-paper" : "bg-panel"}`}
      >
        {error === null ? null : (
          <div className={shellClass(theme)}>
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
          ref={hostRef}
          aria-hidden="true"
          className="min-h-full w-full px-3 py-4"
        />
      </div>
      {/* `[data-tip]` in globals.css forces position:relative at the same
          specificity as the `absolute` utility, so the positioned element
          has to be a plain wrapper around the button that carries the tip,
          the same split the focus-exit button in player.tsx already uses. */}
      <div className="absolute top-2 right-2 z-10">
        <button
          type="button"
          onClick={() => onTheme(theme === "light" ? "dark" : "light")}
          aria-pressed={theme === "light"}
          aria-label="Invert notation colours"
          data-tip={theme === "light" ? "Switch to dark" : "Switch to paper"}
          data-tip-side="top"
          data-tip-align="right"
          className={`rounded-lg border p-1.5 pointer-coarse:min-h-11 pointer-coarse:min-w-11 backdrop-blur transition-colors hover:border-accent hover:text-accent ${
            theme === "light"
              ? "border-ink/20 bg-paper/70 text-ink/60"
              : "border-line-strong bg-panel/60 text-muted"
          }`}
        >
          <Contrast className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

const railSteps: Readonly<Record<string, number>> = {
  ArrowUp: -1,
  ArrowDown: 1,
  PageUp: -10,
  PageDown: 10,
};

function SheetProgress({
  duration,
  elapsed,
  getPosition,
  onSeek,
  theme,
}: {
  duration: number;
  elapsed: number;
  getPosition: () => number;
  onSeek: ((position: number) => void) | null;
  theme: SheetTheme;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  const [length, setLength] = useState(0);
  const safeDuration = Math.max(duration, 0.001);

  useEffect(() => {
    const rail = railRef.current;
    if (rail === null) {
      return;
    }
    const measure = (): void => setLength(rail.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let frame = requestAnimationFrame(function loop() {
      const share = Math.max(0, Math.min(1, getPosition() / safeDuration));
      if (fillRef.current !== null) {
        fillRef.current.style.clipPath = `inset(0 0 ${(1 - share) * 100}% 0)`;
      }
      if (headRef.current !== null) {
        headRef.current.style.top = `${share * 100}%`;
      }
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [safeDuration, getPosition]);

  return (
    <div
      ref={railRef}
      className={`relative w-7 pointer-coarse:w-9 shrink-0 self-stretch overflow-hidden rounded-md ${
        theme === "light" ? "bg-ink/10" : "bg-raised"
      } ${onSeek === null ? "opacity-50" : ""}`}
    >
      <div
        ref={fillRef}
        aria-hidden="true"
        className="absolute inset-0 bg-accent/35"
      />
      <div
        ref={headRef}
        aria-hidden="true"
        className="-translate-x-1/2 -translate-y-1/2 absolute left-1/2 h-1 w-4 rounded-full bg-accent shadow-[0_0_6px_var(--accent)]"
      />
      {/* A real range carries the semantics, the keyboard and the drag; it is
          a horizontal input rotated upright, since a vertical writing-mode
          range renders inconsistently across browsers while a rotated
          horizontal one behaves exactly like the proven one on the transport
          bar. Its own width becomes the rail's measured height once turned. */}
      <input
        type="range"
        min={0}
        max={Math.max(1, safeDuration)}
        step={0.05}
        value={Math.min(elapsed, safeDuration)}
        disabled={onSeek === null}
        onChange={(event) => onSeek?.(Number(event.target.value))}
        onKeyDown={(event) => {
          if (onSeek === null) {
            return;
          }
          const step = railSteps[event.key];
          const target =
            step === undefined
              ? { Home: 0, End: safeDuration }[event.key]
              : getPosition() + step;
          if (target === undefined) {
            return;
          }
          event.preventDefault();
          onSeek(Math.max(0, Math.min(safeDuration, target)));
        }}
        aria-label="Notation position"
        aria-orientation="vertical"
        aria-valuetext={formatClock(elapsed)}
        style={{ width: length, transform: "rotate(90deg)" }}
        className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 h-7 cursor-pointer appearance-none bg-transparent opacity-0 outline-none disabled:cursor-default"
      />
    </div>
  );
}
