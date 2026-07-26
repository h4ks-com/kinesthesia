"use client";

import { Maximize, Minimize } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PianoRollView } from "@/components/piano-roll-view";
import { SettingsMenu } from "@/components/settings-menu";
import { SkinPicker } from "@/components/skin-picker";
import { TopBar } from "@/components/top-bar";
import { TrackMenu } from "@/components/track-menu";
import { PlaybackEngine } from "@/lib/audio/engine";
import type { SongVoicing, Voicing } from "@/lib/audio/voicing";
import { keyLabelsFor, reachFor } from "@/lib/input/keyboard-map";
import { type InputChannel, useNoteInput } from "@/lib/input/use-note-input";
import { ExpressionTrail } from "@/lib/midi/expression";
import type { Song, SongNote } from "@/lib/midi/song";
import {
  channelPart,
  keyboardPart,
  type PlayPart,
  partToTrack,
} from "@/lib/play/parts";
import { usePlayNotes } from "@/lib/play/use-play-notes";
import { clampKeyWidth, defaultKeyWidth } from "@/lib/render/keyboard";
import { findSkin, noSkin } from "@/lib/skins/registry";
import type { SkinId } from "@/lib/skins/types";
import {
  type GlobalSettings,
  loadGlobalSettings,
  updateGlobalSettings,
} from "@/lib/storage/settings";
import type { Viewer } from "@/server/auth";

type PlayViewProps = {
  viewer: Viewer | null;
  authEnabled: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const noAutoNotes: ReadonlySet<number> = new Set();
const noNotes: readonly SongNote[] = [];
/** The computer keyboard and touch always play this part; MIDI channels get
 * their own. It is never removed, so the routing target is a constant. */
const keyboardTrack = 0;
const settleMs = 250;

/** A key struck through one input, so its release ends the note on the same
 * part even after the octave has moved on. */
function inputKey(pitch: number, channel: InputChannel): string {
  return `${channel ?? "self"}:${pitch}`;
}

function playSong(parts: readonly PlayPart[]): Song {
  return {
    name: "Play",
    duration: Number.POSITIVE_INFINITY,
    notes: [],
    tracks: parts.map(partToTrack),
    expression: new ExpressionTrail(),
  };
}

export function PlayView({
  viewer,
  authEnabled,
  signIn,
  signOut,
}: PlayViewProps) {
  const [parts, setParts] = useState<readonly PlayPart[]>(() => [
    keyboardPart(keyboardTrack),
  ]);
  const [voicing, setVoicing] = useState<SongVoicing>(new Map());
  const [keyWidth, setKeyWidth] = useState(defaultKeyWidth);
  const [showKeyLabels, setShowKeyLabels] = useState(true);
  const [plainStyle, setPlainStyle] = useState(false);
  const [skinId, setSkinId] = useState<SkinId>(noSkin);
  const [pickingSkin, setPickingSkin] = useState(false);
  const [hasKeyboard, setHasKeyboard] = useState(false);
  const [focus, setFocus] = useState(false);
  const [started, setStarted] = useState(false);

  const engineRef = useRef<PlaybackEngine | null>(null);
  const startedRef = useRef(false);

  const song = useMemo<Song>(() => playSong(parts), [parts]);

  useEffect(() => {
    const engine = new PlaybackEngine();
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    // setTracks, not setSong: a part appearing mid-play must not cut the notes
    // already ringing on the others. A new voice loads lazily, so warm it here
    // to have it ready by the time it is hit.
    engineRef.current?.setTracks(song);
    void engineRef.current?.warmInstruments(song);
  }, [song]);

  useEffect(() => {
    engineRef.current?.setVoicing(voicing);
  }, [voicing]);

  useEffect(() => {
    setHasKeyboard(window.matchMedia("(any-pointer: fine)").matches);
    void loadGlobalSettings().then((stored) => {
      if (stored !== null) {
        setKeyWidth(clampKeyWidth(stored.keyWidth));
        setShowKeyLabels(stored.showKeyLabels ?? true);
        setPlainStyle(stored.plainStyle ?? false);
        setSkinId(stored.skin ?? noSkin);
      }
    });
  }, []);

  const getPosition = useCallback(() => engineRef.current?.position ?? 0, []);
  const notes = usePlayNotes(getPosition);
  const expression = useRef(new ExpressionTrail()).current;

  const partsRef = useRef(parts);
  partsRef.current = parts;
  const struck = useRef(new Map<string, number>());
  const channels = useRef(new Map<number, number>());
  const programByChannel = useRef(new Map<number, number>());
  const nextId = useRef(1);
  const globalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingGlobal = useRef<Partial<GlobalSettings>>({});
  const sustainRef = useRef(false);
  const sustained = useRef(new Set<string>());

  useEffect(
    () => () => {
      if (globalTimer.current !== null) {
        clearTimeout(globalTimer.current);
        void updateGlobalSettings(pendingGlobal.current);
      }
    },
    [],
  );

  const ensureRunning = useCallback(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    setStarted(true);
    void engineRef.current?.play();
  }, []);

  // Grows the parts list and hands the engine the new voice at once, so the
  // very first note on a fresh channel resolves rather than starting silent.
  const commitParts = useCallback((next: readonly PlayPart[]) => {
    partsRef.current = next;
    setParts(next);
    engineRef.current?.setTracks(playSong(next));
  }, []);

  // A part answering to this channel, made the moment the channel first speaks
  // so a controller populates its own parts without any setup.
  const partForChannel = useCallback(
    (channel: number): number => {
      const existing = channels.current.get(channel);
      if (existing !== undefined) {
        return existing;
      }
      const id = nextId.current++;
      channels.current.set(channel, id);
      commitParts([
        ...partsRef.current,
        channelPart(id, channel, programByChannel.current.get(channel) ?? 0),
      ]);
      return id;
    },
    [commitParts],
  );

  const trackFor = useCallback(
    (channel: InputChannel): number =>
      channel === null ? keyboardTrack : partForChannel(channel),
    [partForChannel],
  );

  const handlePress = useCallback(
    (pitch: number, velocity: number, _at: number, channel: InputChannel) => {
      ensureRunning();
      const track = trackFor(channel);
      // Re-striking a key ends its deferred-under-pedal release, so lifting the
      // pedal later cannot cut the note now being held.
      sustained.current.delete(`${track}:${pitch}`);
      struck.current.set(inputKey(pitch, channel), track);
      engineRef.current?.strike(pitch, velocity, track);
      notes.emit(pitch, track, velocity);
    },
    [ensureRunning, trackFor, notes],
  );

  const handleRelease = useCallback(
    (pitch: number, channel: InputChannel) => {
      const key = inputKey(pitch, channel);
      const track = struck.current.get(key) ?? trackFor(channel);
      struck.current.delete(key);
      notes.lift(pitch, track);
      if (sustainRef.current) {
        sustained.current.add(`${track}:${pitch}`);
        return;
      }
      engineRef.current?.release(pitch, track);
      notes.damp(pitch, track);
    },
    [trackFor, notes],
  );

  const releaseSustained = useCallback(() => {
    for (const key of sustained.current) {
      const [track, pitch] = key.split(":").map(Number);
      if (track !== undefined && pitch !== undefined) {
        engineRef.current?.release(pitch, track);
        notes.damp(pitch, track);
      }
    }
    sustained.current.clear();
  }, [notes]);

  const setPedal = useCallback(
    (down: boolean) => {
      sustainRef.current = down;
      if (!down) {
        releaseSustained();
      }
    },
    [releaseSustained],
  );

  const handleProgram = useCallback(
    (channel: number, program: number) => {
      programByChannel.current.set(channel, program);
      const id = partForChannel(channel);
      commitParts(
        partsRef.current.map((part) =>
          part.id === id ? { ...part, program } : part,
        ),
      );
    },
    [partForChannel, commitParts],
  );

  const input = useNoteInput({
    active: true,
    onPress: handlePress,
    onRelease: handleRelease,
    onProgram: handleProgram,
    onSustain: (_channel, down) => setPedal(down),
    onBend: (channel, amount) =>
      expression.setBend(trackFor(channel), getPosition(), amount),
    onModulation: (channel, depth) =>
      expression.setDepth(trackFor(channel), getPosition(), depth),
  });

  // The computer keyboard has no pedal, so space stands in for one, but only
  // when nothing is focused: a focused button keeps space for its own click.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (
        event.code === "Space" &&
        event.target === document.body &&
        !event.repeat
      ) {
        event.preventDefault();
        setPedal(true);
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setPedal(false);
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [setPedal]);

  const getPressed = useCallback(() => {
    const held = new Set<number>();
    for (const note of notes.get()) {
      if (note.end === null) {
        held.add(note.pitch);
      }
    }
    return held;
  }, [notes]);

  const getSustain = useCallback(() => sustainRef.current, []);

  // Which parts are sounding now, for the pulsing dots: those with a held note,
  // plus one just released so a quick tap still registers a pulse.
  const getSounding = useCallback(() => {
    const now = getPosition();
    const set = new Set<number>();
    for (const note of notes.get()) {
      if (note.release === null || now - note.release < 0.05) {
        set.add(note.track);
      }
    }
    return set;
  }, [notes, getPosition]);

  const noPitches = useCallback((): ReadonlySet<number> => noAutoNotes, []);
  const noYours = useCallback((): ReadonlySet<number> | null => null, []);

  // A write per slider step would spend a read and a write on a value the next
  // step replaces, so the save settles a moment after the last change.
  const settleGlobal = useCallback((patch: Partial<GlobalSettings>) => {
    // Changes made inside one settle are gathered, so a second one does not
    // replace the first and leave it unwritten.
    pendingGlobal.current = { ...pendingGlobal.current, ...patch };
    if (globalTimer.current !== null) {
      clearTimeout(globalTimer.current);
    }
    globalTimer.current = setTimeout(() => {
      const next = pendingGlobal.current;
      pendingGlobal.current = {};
      void updateGlobalSettings(next);
    }, settleMs);
  }, []);

  const onKeyWidth = useCallback(
    (width: number) => {
      setKeyWidth(width);
      settleGlobal({ keyWidth: width });
    },
    [settleGlobal],
  );
  const onKeyLabels = useCallback(
    (next: boolean) => {
      setShowKeyLabels(next);
      settleGlobal({ showKeyLabels: next });
    },
    [settleGlobal],
  );
  // Free roam shoots notes out of the keys, so that is the direction a skin is
  // told about and the one the picker offers for.
  const skin = useMemo(() => findSkin(skinId), [skinId]);

  const onSkin = useCallback(
    (next: SkinId) => {
      setSkinId(next);
      setPickingSkin(false);
      settleGlobal({ skin: next });
    },
    [settleGlobal],
  );

  const onPlainStyle = useCallback(
    (next: boolean) => {
      setPlainStyle(next);
      settleGlobal({ plainStyle: next });
    },
    [settleGlobal],
  );

  useEffect(() => {
    if (!focus) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFocus(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus]);

  const onVoicing = useCallback((track: number, next: Voicing): void => {
    setVoicing((current) => new Map(current).set(track, next));
  }, []);

  const focusButton = (
    <button
      type="button"
      onClick={() => setFocus(true)}
      aria-label="Focus mode"
      data-tip="Focus mode"
      data-tip-side="top"
      className="inline-flex items-center rounded-lg border border-line-strong p-2 text-muted transition-colors hover:border-accent hover:text-accent"
    >
      <Maximize className="size-4" aria-hidden="true" />
    </button>
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-void">
      {focus ? null : (
        <TopBar
          viewer={viewer}
          authEnabled={authEnabled}
          signIn={signIn}
          signOut={signOut}
          nav={
            <>
              <TrackMenu
                label="Instruments"
                tracks={song.tracks}
                notes={noNotes}
                getPosition={getPosition}
                getSounding={getSounding}
                voicing={voicing}
                onVoicing={onVoicing}
              />
              {focusButton}
            </>
          }
        />
      )}

      <div className="relative min-h-0 flex-1">
        {pickingSkin ? (
          <SkinPicker
            chosen={skinId}
            direction="up"
            onChoose={onSkin}
            onClose={() => setPickingSkin(false)}
          />
        ) : null}

        <PianoRollView
          skin={skin}
          direction="up"
          song={song}
          hiddenTracks={noAutoNotes}
          keyWidth={keyWidth}
          focusPitch={null}
          getPosition={getPosition}
          getPressed={getPressed}
          getOwed={noPitches}
          getYours={noYours}
          getLive={notes.get}
          getSustain={getSustain}
          expression={expression}
          reach={hasKeyboard ? reachFor(input.octave) : null}
          keyLabels={
            hasKeyboard && showKeyLabels ? keyLabelsFor(input.octave) : null
          }
          plain={plainStyle}
          onStrike={(pitch) => handlePress(pitch, 0.8, performance.now(), null)}
          onRelease={(pitch) => handleRelease(pitch, null)}
        />
        {started ? null : (
          <p className="-translate-x-1/2 pointer-events-none absolute top-6 left-1/2 flex items-center gap-2 whitespace-nowrap rounded-full border border-line-strong bg-panel/90 px-4 py-1.5 text-muted text-xs backdrop-blur">
            press a key or tap to start the sound
          </p>
        )}
        {focus ? (
          <div className="fixed top-4 right-4 z-30">
            <button
              type="button"
              onClick={() => setFocus(false)}
              aria-label="Leave focus mode"
              data-tip="Leave focus"
              data-tip-side="bottom"
              data-tip-align="right"
              className="rounded-lg border border-line-strong bg-panel/60 p-2 text-muted backdrop-blur transition-colors hover:border-accent hover:text-accent"
            >
              <Minimize className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>

      {focus ? null : (
        <footer className="flex h-16 shrink-0 items-center justify-end border-line border-t bg-panel px-3 sm:px-4">
          <SettingsMenu
            keyWidth={keyWidth}
            onKeyWidth={onKeyWidth}
            octave={hasKeyboard ? input.octave : null}
            onOctave={input.setOctave}
            inputStatus={input.status}
            latencyOffset={0}
            onLatencyOffset={() => {}}
            measuredLatency={0}
            showLatency={false}
            keyLabels={hasKeyboard ? showKeyLabels : null}
            onKeyLabels={onKeyLabels}
            plainStyle={plainStyle}
            onPlainStyle={onPlainStyle}
            onPickSkin={() => setPickingSkin(true)}
            skinName={skin?.name.toLowerCase() ?? "plain"}
          />
        </footer>
      )}
    </div>
  );
}
