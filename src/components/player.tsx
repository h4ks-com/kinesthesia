"use client";

import { Minimize, Piano, Volume2 } from "lucide-react";
import {
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { HitFlag } from "@/components/hit-flag";
import { PianoRollView } from "@/components/piano-roll-view";
import { PlayerHeader } from "@/components/player-header";
import { PlayerTransport, TransportBar } from "@/components/player-transport";
import { RenderMenu } from "@/components/render-menu";
import { SkinPicker } from "@/components/skin-picker";
import { TimingRail } from "@/components/timing-rail";
import { Walkthrough } from "@/components/walkthrough";
import { judgedPosition, suggestedOffset } from "@/lib/audio/latency";
import { usePlaybackEngine } from "@/lib/audio/use-playback-engine";
import { useSongVoicing } from "@/lib/audio/use-song-voicing";
import { keyLabelsFor, reachFor } from "@/lib/input/keyboard-map";
import { useMidiShortcuts } from "@/lib/input/midi-shortcuts";
import { useNoteInput } from "@/lib/input/use-note-input";
import { reduceToMelody } from "@/lib/midi/melody";
import {
  medianPitch,
  type Part,
  soloHidden,
  toggleHidden,
  tracksToHide,
} from "@/lib/midi/part";
import { type Song, transposeSong } from "@/lib/midi/song";
import { useSong } from "@/lib/midi/use-song";
import type { PlayerMode, PlayerParams } from "@/lib/player-url";
import { busiestTrack } from "@/lib/scoring/gates";
import type { Judgement, Score } from "@/lib/scoring/judge";
import type { Summary } from "@/lib/scoring/summary";
import { useGates } from "@/lib/scoring/use-gates";
import { useRunRecord } from "@/lib/scoring/use-run-record";
import { tourFor } from "@/lib/tour/steps";
import { useWalkthrough } from "@/lib/tour/use-walkthrough";
import { useBackground } from "@/lib/use-background";
import { usePlayerSettings } from "@/lib/use-player-settings";
import { useWideLayout } from "@/lib/use-wide-layout";

type PlayerProps = {
  mode: PlayerMode;
  params: PlayerParams;
  /** Who is signed in, so their own sound for a song wins over the newest. */
  viewerId?: string | null;
  /** Whether the walkthrough may run on its own here. A match joiner never sees
   * it; the host does. */
  tourAuto?: boolean;
  onScore?: (score: Score) => void;
  onHit?: (judgement: Judgement) => void;
  /** Reports the part being played, so a match can mirror it on the other side
   * without reading it back out of the address bar. */
  onConfig?: (part: Part) => void;
  opponent?: { name: string; points: number; accuracy: number } | null;
  /** A live match freezes the settings, since both sides derive their part
   * from them and have to keep agreeing once the scoring starts. */
  locked?: boolean;
  /** A running match round hides the transport, so no one can pause, seek or
   * start on their own; the handle drives playback. */
  matchActive?: boolean;
  /** A match hangs its other half, its overlay and its invite off the player,
   * so one timeline spans both sides and stays on the clock that drives them. */
  aside?: ReactNode;
  overlay?: ReactNode;
  footerExtra?: ReactNode;
  onEnd?: (summary: Summary) => void;
};

/** The match drives each side's playback through this, so one signal starts a
 * round on both sides. */
export type PlayerHandle = {
  prepare: () => Promise<void>;
  startRound: () => void;
  stop: () => void;
  /** The other half of a match draws off this clock, which is what keeps one
   * timeline walking both rolls. */
  getPosition: () => number;
};

export const Player = forwardRef<PlayerHandle, PlayerProps>(function Player(
  {
    mode,
    params,
    viewerId = null,
    tourAuto = true,
    onScore,
    onHit,
    onConfig,
    opponent = null,
    locked = false,
    matchActive = false,
    aside = null,
    overlay = null,
    footerExtra = null,
    onEnd,
  },
  ref,
) {
  const sound = useSongVoicing(params, viewerId);
  const load = useSong(params);
  const original = load.status === "ready" ? load.song : null;
  const [pickingSkin, setPickingSkin] = useState(false);
  const wideLayout = useWideLayout();

  const interactive = mode !== "watch";
  // Notes may only leave the keys where nobody has to read them coming: in
  // learn and match the approach is how you know what to play.
  const waitsForYou = mode === "learn";

  const [hiddenTracks, setHiddenTracks] = useState<ReadonlySet<number>>(
    new Set(),
  );
  // The file extension is noise on the presented title.
  const songTitle = params.name.replace(/\.midi?$/i, "");
  // A crafted link auto-focuses a solo view, but not a match, whose setup and
  // invite live in the chrome focus mode hides.
  const [focus, setFocus] = useState(mode !== "multiplayer" && params.focus);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const getFocus = useCallback(() => focusRef.current, []);
  // The background is a setting of this device, and the link carries it so
  // copying the address hands over the view rather than the song alone.
  const viewRef = useRef({ skin: params.skin, rise: params.rise });
  const getView = useCallback(() => viewRef.current, []);

  const {
    playerTracks,
    speed,
    latencyOffset,
    keyWidth,
    showKeyLabels,
    showNoteNames,
    plainStyle,
    hasKeyboard,
    simplified,
    melodyRate,
    transpose,
    hydrated,
    claimTrack,
    updateUrl,
    changeKeyWidth,
    changeLatency,
    changeKeyLabels,
    changeNoteNames,
    changePlainStyle,
    changeSimplified,
    changeMelodyRate,
    changeTranspose,
    changeSpeed,
    togglePlayerTrack,
  } = usePlayerSettings({ mode, params, locked, getFocus, getView });

  const background = useBackground({
    // Notes may only leave the keys where nobody has to read them coming: in
    // learn and match the approach is how you know what to play.
    fixed: mode === "watch" ? null : "down",
    plain: plainStyle,
    fromLink: { skin: params.skin, rise: params.rise },
    onChange: (next) => {
      viewRef.current = next;
      updateUrl({});
    },
  });

  const skinShortcuts = useMidiShortcuts({
    onTrigger: background.choose,
    targets: () => background.cycle,
  });

  const song = useMemo(
    () => (original === null ? null : transposeSong(original, transpose)),
    [original, transpose],
  );

  // The chrome the tour points at is up only once the song is and the page is
  // not stripped for recording.
  const tour = useWalkthrough(mode, tourAuto && song !== null && !focus);

  const changeFocus = useCallback(
    (next: boolean) => {
      setFocus(next);
      focusRef.current = next;
      updateUrl({});
    },
    [updateUrl],
  );

  useEffect(() => {
    if (!focus) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        changeFocus(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, changeFocus]);

  // Entering focus presents the song's name over the empty view, then fades so
  // a recording started a moment later is clean.
  const stage = useRef<HTMLDivElement | null>(null);
  const [titleUp, setTitleUp] = useState(false);
  const rollUp = song !== null;
  useEffect(() => {
    if (!focus || !rollUp) {
      setTitleUp(false);
      return;
    }
    setTitleUp(true);
    stage.current?.focus();
    const timer = setTimeout(() => setTitleUp(false), 4000);
    return () => clearTimeout(timer);
  }, [focus, rollUp]);

  useEffect(() => {
    if (
      !hydrated ||
      locked ||
      song === null ||
      !interactive ||
      playerTracks.size > 0
    ) {
      return;
    }
    claimTrack(busiestTrack(song));
  }, [hydrated, locked, song, interactive, playerTracks.size, claimTrack]);

  const focusedSong = useRef<Song | null>(null);
  useEffect(() => {
    if (
      original === null ||
      song === null ||
      !interactive ||
      playerTracks.size === 0
    ) {
      return;
    }
    if (focusedSong.current === original) {
      return;
    }
    focusedSong.current = original;
    setHiddenTracks(tracksToHide(song, playerTracks));
  }, [song, original, interactive, playerTracks]);

  const owed = useMemo(() => {
    if (song === null || !interactive) {
      return [];
    }
    const mine = song.notes.filter((note) => playerTracks.has(note.track));
    return simplified
      ? reduceToMelody(song, {
          tracks: playerTracks,
          maxNotesPerSecond: melodyRate,
        })
      : mine;
  }, [song, playerTracks, interactive, simplified, melodyRate]);

  const owedIds = useMemo(() => new Set(owed.map((note) => note.id)), [owed]);

  // Learning shows only the part you owe while the rest keeps playing, so
  // hiding a track is a view choice there rather than a mute.
  const autoNotes = useMemo(() => {
    if (song === null) {
      return new Set<number>();
    }
    return new Set(
      song.notes
        .filter(
          (note) =>
            !owedIds.has(note.id) &&
            (interactive || !hiddenTracks.has(note.track)),
        )
        .map((note) => note.id),
    );
  }, [song, hiddenTracks, interactive, owedIds]);

  const resetGates = useCallback(() => gatesRef.current?.reset(), []);
  const playback = usePlaybackEngine({
    song,
    sourceKey: params.url,
    autoNotes,
    speed,
    onRestart: resetGates,
  });

  useEffect(() => {
    playback.setVoicing(sound.voicing);
  }, [playback.setVoicing, sound.voicing]);

  const gates = useGates({
    owed,
    active: interactive,
    waitsForYou,
    getPosition: playback.getPosition,
    isPlaying: playback.isPlaying,
    pause: playback.pause,
    resume: playback.resume,
  });
  const gatesRef = useRef(gates);
  gatesRef.current = gates;

  // The end is only counted for a round that actually started, so a song left
  // at its end during preview does not report a finish the moment a match opens.
  const startedRef = useRef(false);
  const endedRef = useRef(false);

  const seekPlayback = playback.seek;
  const seek = useCallback(
    (position: number) => {
      seekPlayback(position);
      gatesRef.current.moveTo(position);
    },
    [seekPlayback],
  );

  // The engine resets to zero whenever the file changes, so the opening offset
  // is re-applied per file rather than once per mount.
  const startedFrom = useRef<string | null>(null);
  useEffect(() => {
    if (
      song === null ||
      params.start <= 0 ||
      startedFrom.current === params.url
    ) {
      return;
    }
    startedFrom.current = params.url;
    seek(Math.min(params.start, song.duration));
  }, [song, params.start, params.url, seek]);

  const offsetRef = useRef(latencyOffset);
  offsetRef.current = latencyOffset;
  const ownedTrack = [...playerTracks][0] ?? 0;

  useEffect(() => {
    if (interactive && song !== null) {
      playback.warmPlayed([ownedTrack]);
    }
  }, [interactive, ownedTrack, playback.warmPlayed, song]);
  const input = useNoteInput({
    active: interactive,
    onPress: useCallback(
      (pitch: number, velocity: number, at: number) => {
        playback.strike(pitch, velocity, ownedTrack);
        // A match only scores a struck note once its round is running, so keys
        // pressed during the countdown or result never count or reach the peer.
        if (interactive && (mode !== "multiplayer" || startedRef.current)) {
          gatesRef.current.judgeStrike(
            pitch,
            judgedPosition(
              playback.getPosition(),
              at,
              performance.now(),
              playback.latency(),
              offsetRef.current,
            ),
          );
        }
      },
      [playback, ownedTrack, interactive, mode],
    ),
    onRelease: useCallback(
      (pitch: number) => {
        playback.release(pitch, ownedTrack);
        if (interactive && (mode !== "multiplayer" || startedRef.current)) {
          // Read off the clock here rather than carried from the event: a hold
          // is judged against a slack of a whole sixth of the note, so the
          // handful of milliseconds between the two cannot reach the verdict.
          const now = performance.now();
          gatesRef.current.judgeRelease(
            pitch,
            judgedPosition(
              playback.getPosition(),
              now,
              now,
              playback.latency(),
              offsetRef.current,
            ),
          );
        }
      },
      [playback, ownedTrack, interactive, mode],
    ),
    onToggle: useCallback(() => {
      if (!matchActive) {
        void playback.toggle();
      }
    }, [playback, matchActive]),
    onControl: skinShortcuts.onControl,
  });

  /** Opening on the lowest keys hides the part on a phone, where only a slice
   * of the keyboard fits, so the roll starts where the notes are. */
  const focusPitch = useMemo(() => {
    if (song === null) {
      return null;
    }
    const source = owed.length > 0 ? owed : song.notes;
    return medianPitch(
      source.filter((note) => interactive || !hiddenTracks.has(note.track)),
    );
  }, [song, owed, interactive, hiddenTracks]);

  // Interactive modes light only the part you owe and ghost the rest, so the
  // accompaniment and any other track stay visible without competing with it.
  const yoursSet = useMemo(
    () => (interactive ? owedIds : null),
    [interactive, owedIds],
  );
  const yoursRef = useRef(yoursSet);
  yoursRef.current = yoursSet;
  const yours = useCallback(() => yoursRef.current, []);

  useRunRecord({
    mode,
    params,
    score: gates.score,
    elapsed: playback.elapsed,
    duration: song?.duration ?? 0,
    active: interactive,
    speed,
    simplified,
    melodyRate,
  });

  useEffect(() => {
    onScore?.(gates.score);
  }, [gates.score, onScore]);

  const configRef = useRef(onConfig);
  configRef.current = onConfig;
  useEffect(() => {
    configRef.current?.({
      tracks: [...playerTracks].sort((left, right) => left - right),
      simplified,
      melodyRate,
    });
  }, [playerTracks, simplified, melodyRate]);

  const hitRef = useRef(gates.lastHit?.seq ?? 0);
  useEffect(() => {
    const hit = gates.lastHit;
    if (hit === null || hit.seq === hitRef.current) {
      return;
    }
    hitRef.current = hit.seq;
    // Only what the other side scores: letting a held note go is this player's
    // own business, and the peer has no verdict of that name to show.
    if (hit.judgement !== "letGo") {
      onHit?.(hit.judgement);
    }
  }, [gates.lastHit, onHit]);

  useImperativeHandle(
    ref,
    () => ({
      prepare: () => playback.prepare(),
      startRound: () => {
        startedRef.current = true;
        endedRef.current = false;
        void playback.restart();
      },
      stop: () => {
        startedRef.current = false;
        endedRef.current = true;
        playback.pause();
      },
      getPosition: () => playback.getPosition(),
    }),
    [playback],
  );

  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  useEffect(() => {
    if (
      !matchActive ||
      !startedRef.current ||
      song === null ||
      endedRef.current ||
      playback.elapsed < song.duration
    ) {
      return;
    }
    startedRef.current = false;
    endedRef.current = true;
    endRef.current?.(gates.summary(song.duration));
  }, [matchActive, song, playback.elapsed, gates.summary]);

  function toggleTrack(index: number) {
    setHiddenTracks((current) => toggleHidden(current, index));
  }

  function soloTrack(index: number) {
    const all = song?.tracks.map((track) => track.index) ?? [];
    setHiddenTracks((current) => soloHidden(all, current, index));
  }

  // Focus hides every other control, so its own way out rides along with it,
  // including over the loading and failed frames where a phone has no Escape.
  const focusExit = focus ? (
    <div className="fixed top-4 right-4 z-30">
      <button
        type="button"
        onClick={() => changeFocus(false)}
        data-tip="Leave focus"
        data-tip-side="bottom"
        data-tip-align="right"
        aria-label="Leave focus"
        className="rounded-lg border border-line-strong bg-panel/60 p-2 text-muted backdrop-blur transition-colors hover:border-accent hover:text-accent"
      >
        <Minimize className="size-4" aria-hidden="true" />
      </button>
    </div>
  ) : null;

  // The frame stays up while the song loads or fails, because a match hangs its
  // other half, its overlay and its invite off it and would go dark with it.
  if (song === null) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-void">
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <p className="flex flex-1 items-center justify-center px-6 text-center text-muted text-sm">
              {load.status === "failed" ? load.message : "Loading the song"}
            </p>
            {overlay}
          </div>
          {aside}
        </div>
        {footerExtra === null ? null : (
          <TransportBar>
            <span className="min-w-0 flex-1" />
            {footerExtra}
          </TransportBar>
        )}
        {focusExit}
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-void">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {focus ? null : (
            <PlayerHeader
              mode={mode}
              params={{
                ...params,
                tracks: [...playerTracks],
                speed,
                simplified,
                melodyRate,
                transpose,
                focus,
              }}
              tracks={song.tracks}
              notes={song.notes}
              getPosition={playback.getPosition}
              hiddenTracks={hiddenTracks}
              playerTracks={playerTracks}
              interactive={interactive}
              simplified={simplified}
              onSimplified={changeSimplified}
              melodyRate={melodyRate}
              onMelodyRate={changeMelodyRate}
              editable={!locked}
              score={gates.score}
              opponent={opponent}
              onToggleVisible={toggleTrack}
              onToggleMine={togglePlayerTrack}
              onSolo={soloTrack}
              voicing={sound.voicing}
              onVoicing={sound.change}
              sound={{
                playing: sound.playing,
                others: sound.saved.map((entry) => ({
                  id: entry.authorId,
                  name: entry.authorName,
                })),
                dirty: sound.dirty,
                canSave: viewerId !== null,
                onSave: () => void sound.save(),
                onAdopt: sound.adopt,
                onReset: sound.reset,
              }}
              renderTool={
                mode === "watch" ? (
                  <RenderMenu
                    song={song}
                    voicing={sound.voicing}
                    hiddenTracks={hiddenTracks}
                    plain={plainStyle}
                    noteNames={showNoteNames}
                    speed={speed}
                    direction={background.direction}
                    skin={background.source}
                    title={songTitle}
                  />
                ) : null
              }
              onFocus={() => changeFocus(true)}
              onHelp={tour.start}
            />
          )}

          <div
            ref={stage}
            tabIndex={-1}
            className="relative min-h-0 flex-1 outline-none"
          >
            {pickingSkin ? (
              <SkinPicker
                chosen={background.chosen}
                available={background.offered}
                onChoose={background.choose}
                onClose={() => setPickingSkin(false)}
                shortcuts={skinShortcuts}
              />
            ) : null}
            <PianoRollView
              skin={background.source}
              direction={background.direction}
              song={song}
              hiddenTracks={hiddenTracks}
              keyWidth={keyWidth}
              focusPitch={focusPitch}
              // Only where there is a part to play: watching reduces nothing,
              // so there would be no single note to come to, and the view
              // would wander the song.
              follow={simplified && interactive}
              getPosition={playback.getPosition}
              getPressed={input.pressed}
              getOwed={gates.owed}
              getYours={yours}
              rate={speed}
              playTrack={ownedTrack}
              reach={interactive ? reachFor(input.octave) : null}
              keyLabels={
                interactive && hasKeyboard && showKeyLabels
                  ? keyLabelsFor(input.octave)
                  : null
              }
              noteNames={showNoteNames}
              plain={plainStyle}
              onStrike={(pitch) => input.press(pitch, 0.8)}
              onRelease={input.release}
            />
            {interactive ? <HitFlag hit={gates.lastHit} /> : null}
            {interactive ? (
              <TimingRail
                hit={gates.lastHit}
                lie={wideLayout ? "upright" : "flat"}
              />
            ) : null}
            {gates.waiting ? (
              <p className="rise -translate-x-1/2 absolute top-6 left-1/2 rounded-full border border-accent/40 bg-panel/90 px-4 py-1.5 font-mono text-accent text-xs backdrop-blur">
                waiting for you
              </p>
            ) : null}
            {playback.soundReady || mode === "multiplayer" ? null : (
              <p className="-translate-x-1/2 absolute top-6 left-1/2 flex items-center gap-2 whitespace-nowrap rounded-full border border-line-strong bg-panel/90 px-4 py-1.5 text-muted text-xs backdrop-blur">
                <Volume2 className="size-3.5 shrink-0" aria-hidden="true" />
                press play to start the sound
              </p>
            )}
          </div>
          {overlay}
        </div>
        {aside}
      </div>

      {focus ? null : (
        <TransportBar>
          <PlayerTransport
            playing={playback.playing}
            elapsed={playback.elapsed}
            duration={song.duration}
            speed={speed}
            onSpeed={locked ? null : changeSpeed}
            transpose={transpose}
            onTranspose={locked ? null : changeTranspose}
            keyWidth={keyWidth}
            onKeyWidth={(next) => changeKeyWidth(next)}
            octave={interactive ? input.octave : null}
            latencyOffset={latencyOffset}
            suggestedLatency={suggestedOffset(gates.timing(), latencyOffset)}
            onLatencyOffset={(next) => changeLatency(next)}
            showLatency={interactive}
            keyLabels={interactive && hasKeyboard ? showKeyLabels : null}
            onKeyLabels={changeKeyLabels}
            noteNames={showNoteNames}
            onNoteNames={changeNoteNames}
            plainStyle={plainStyle}
            onPlainStyle={changePlainStyle}
            onPickSkin={
              background.offered.length > 0 ? () => setPickingSkin(true) : null
            }
            skinName={background.name}
            onRising={background.canTurn ? background.turn : null}
            rising={background.direction === "up"}
            risingHeldBy={background.heldBy?.name.toLowerCase() ?? null}
            inputStatus={input.status}
            // A running match owns the clock, so nobody plays or seeks by hand.
            onToggle={matchActive ? null : () => void playback.toggle()}
            onSeek={matchActive ? null : seek}
            onOctave={input.setOctave}
          />
          {footerExtra}
        </TransportBar>
      )}

      {focusExit}
      {focus && params.name !== "" ? (
        <div className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center px-6">
          <div
            className={`max-w-[90vw] rounded-2xl border border-line-strong bg-panel/85 px-8 py-6 text-center shadow-[0_24px_70px_-15px_rgba(0,0,0,0.95)] backdrop-blur-md transition-opacity duration-700 ${titleUp ? "opacity-100" : "opacity-0"}`}
          >
            <Piano
              className="mx-auto mb-3 size-6 text-accent"
              aria-hidden="true"
            />
            <p className="line-clamp-3 text-balance font-semibold text-3xl text-text leading-tight sm:text-5xl">
              {songTitle}
            </p>
          </div>
        </div>
      ) : null}

      {tour.open ? (
        <Walkthrough steps={tourFor(mode)} onClose={tour.close} />
      ) : null}
    </div>
  );
});
