"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
} from "react";
import type { Reach } from "@/lib/input/keyboard-map";
import type { ExpressionTrail } from "@/lib/midi/expression";
import { chordAt } from "@/lib/midi/harmony";
import type { LiveNote, Song } from "@/lib/midi/song";
import { PianoRollRenderer, type SkinReport } from "@/lib/render/piano-roll";
import type {
  BackdropSource,
  NoteDirection,
  SkinInstance,
} from "@/lib/skins/types";

/** A skin is decoration, so it is drawn at most half again the css resolution
 * however dense the screen is. */
const maxSkinRatio = 1.5;

/** Each pointer keeps its own gesture, so one finger panning the roll and
 * another walking the keys never read each other's start position. */
type Gesture =
  | { readonly kind: "keys"; pitch: number | null }
  | { readonly kind: "pan"; readonly x: number; readonly pan: number };

type PianoRollViewProps = {
  song: Song;
  hiddenTracks: ReadonlySet<number>;
  keyWidth: number;
  focusPitch: number | null;
  /** Brings the note the player is next asked for into view, where the keyboard
   * is wider than the screen. */
  follow: boolean;
  getPosition: () => number;
  getPressed: () => ReadonlySet<number>;
  getOwed: () => ReadonlySet<number>;
  getYours: () => ReadonlySet<number> | null;
  /** Play mode's live notes, rising from the keys. Omitted everywhere notes
   * fall from a song instead. */
  getLive?: () => readonly LiveNote[];
  /** Whether the sustain pedal is down, for the strike-line indicator. */
  getSustain?: () => boolean;
  /** How the bend and modulation wheels moved, per track. Play mode only. */
  expression?: ExpressionTrail;
  /** The cosmetic layer drawn behind the roll. Null leaves the roll opaque. */
  skin: BackdropSource | null;
  /** Which way notes travel, which decides what a skin is looking at. */
  direction?: NoteDirection;
  /** Playback speed, so the owed-note foreshadow leads by a constant reaction
   * time. Defaults to normal speed. */
  rate?: number;
  /** The track the player plays, so a bare key press takes that part's colour
   * rather than the first track's. */
  playTrack?: number;
  /** What the computer keyboard reaches from the current octave, or null where
   * there is nothing to play. */
  reach?: Reach | null;
  keyLabels?: ReadonlyMap<number, string> | null;
  plain?: boolean;
  onStrike?: (pitch: number) => void;
  onRelease?: (pitch: number) => void;
};

export function PianoRollView({
  song,
  hiddenTracks,
  keyWidth,
  focusPitch,
  follow,
  getPosition,
  getPressed,
  getOwed,
  getYours,
  getLive,
  getSustain,
  rate = 1,
  playTrack = 0,
  reach = null,
  keyLabels = null,
  plain = false,
  expression,
  skin,
  direction = "down",
  onStrike,
  onRelease,
}: PianoRollViewProps) {
  const liveRef = useRef(getLive);
  liveRef.current = getLive;
  const sustainRef = useRef(getSustain);
  sustainRef.current = getSustain;
  const expressionRef = useRef(expression);
  expressionRef.current = expression;
  const skinBase = useRef<HTMLCanvasElement | null>(null);
  const skinOverlay = useRef<HTMLCanvasElement | null>(null);
  const skinRef = useRef<SkinInstance | null>(null);
  const directionRef = useRef(direction);
  directionRef.current = direction;
  const reportRef = useRef<SkinReport>({
    keyboardTop: 0,
    travellers: [],
    strikes: [],
  });
  // Kept out of the render loop's effect, which restarts whenever the song
  // changes: a skin outlives that, and a clock that jumped back would throw its
  // whole field off screen.
  const skinClock = useRef<number | null>(null);
  /** Where the harmony was looked up last, so naming what is sounding costs one
   * comparison a frame rather than a search of the whole song. */
  const chordCursor = useRef(0);
  const skinLast = useRef(0);
  const songRef = useRef(song);
  songRef.current = song;
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const playTrackRef = useRef(playTrack);
  playTrackRef.current = playTrack;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<PianoRollRenderer | null>(null);
  const hiddenRef = useRef(hiddenTracks);
  hiddenRef.current = hiddenTracks;
  const keyWidthRef = useRef(keyWidth);
  keyWidthRef.current = keyWidth;
  const reachRef = useRef(reach);
  reachRef.current = reach;
  const labelsRef = useRef(keyLabels);
  labelsRef.current = keyLabels;
  const plainRef = useRef(plain);
  plainRef.current = plain;
  const gestures = useRef(new Map<number, Gesture>());
  // A rebuilt renderer starts on the lowest keys, so it is framed on creation
  // as well as on a move: the pitch itself often has not changed.
  const focusRef = useRef(focusPitch);
  focusRef.current = focusPitch;
  const followRef = useRef(follow);
  followRef.current = follow;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const renderer = new PianoRollRenderer(canvas, keyWidthRef.current);
    rendererRef.current = renderer;
    if (focusRef.current !== null) {
      renderer.centreOn(focusRef.current);
    }
    let frame = requestAnimationFrame(function loop() {
      const skinned = skinRef.current;
      const at = getPosition();
      if (skinned !== null) {
        reportRef.current.travellers.length = 0;
        reportRef.current.strikes.length = 0;
      }
      renderer.draw({
        song,
        position: at,
        live: liveRef.current?.() ?? null,
        sustain: sustainRef.current?.() ?? false,
        expression: expressionRef.current ?? null,
        direction: directionRef.current,
        report: skinRef.current === null ? null : reportRef.current,
        rate: rateRef.current,
        playTrack: playTrackRef.current,
        hiddenTracks: hiddenRef.current,
        pressed: getPressed(),
        owed: getOwed(),
        yours: getYours(),
        follow: followRef.current,
        reach: reachRef.current,
        keyLabels: labelsRef.current,
        plain: plainRef.current,
      });
      // Drawn after the roll, which is what fills the report for this frame, so
      // a skin reacts to where the notes are now rather than a frame behind.
      if (skinned !== null) {
        skinClock.current ??= performance.now();
        const elapsed = (performance.now() - skinClock.current) / 1000;
        const song = songRef.current;
        const named = chordAt(song.harmony, at, chordCursor.current);
        chordCursor.current = named.cursor;
        // Clamped, so a tab coming back does not hand a background a step it
        // would move a whole scene by.
        const step =
          skinLast.current === 0
            ? 1 / 60
            : Math.max(0, Math.min(0.05, elapsed - skinLast.current));
        skinLast.current = elapsed;
        skinned.draw({
          keyboardTop: reportRef.current.keyboardTop,
          elapsed,
          position: at,
          step,
          travellers: reportRef.current.travellers,
          strikes: reportRef.current.strikes,
          pressed: [...getPressed()],
          chord: named.chord,
          key: song.key,
        });
      }
      frame = requestAnimationFrame(loop);
    });

    const observer = new ResizeObserver(() => renderer.resize());
    observer.observe(canvas);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      rendererRef.current = null;
    };
  }, [song, getPosition, getPressed, getOwed, getYours]);

  useEffect(() => {
    const base = skinBase.current;
    const overlay = skinOverlay.current;
    if (base === null || overlay === null || skin === null) {
      return;
    }
    const made = skin.create({ base, overlay });
    skinRef.current = made;
    if (made === null) {
      return;
    }
    const sizeSkin = () => {
      const box = base.getBoundingClientRect();
      made.resize(
        box.width,
        box.height,
        Math.min(window.devicePixelRatio, maxSkinRatio),
      );
    };
    sizeSkin();
    const observer = new ResizeObserver(sizeSkin);
    observer.observe(base);
    return () => {
      observer.disconnect();
      made.dispose();
      skinRef.current = null;
    };
  }, [skin]);

  useEffect(() => {
    rendererRef.current?.setKeyWidth(keyWidth);
  }, [keyWidth]);

  useEffect(() => {
    if (focusPitch !== null) {
      rendererRef.current?.centreOn(focusPitch);
    }
  }, [focusPitch]);

  /** Another finger may be holding the same key, and the pressed set is keyed
   * by pitch, so the note ends only once the last of them lifts. */
  function releasePitch(pointerId: number, pitch: number | null) {
    if (pitch === null) {
      return;
    }
    for (const [other, gesture] of gestures.current) {
      if (
        other !== pointerId &&
        gesture.kind === "keys" &&
        gesture.pitch === pitch
      ) {
        return;
      }
    }
    onRelease?.(pitch);
  }

  function pitchUnder(event: ReactPointerEvent<HTMLCanvasElement>) {
    const renderer = rendererRef.current;
    if (renderer === null) {
      return null;
    }
    const box = event.currentTarget.getBoundingClientRect();
    return renderer.pitchAt(event.clientX - box.left, event.clientY - box.top);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const renderer = rendererRef.current;
    if (renderer === null) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const pitch = pitchUnder(event);
    if (pitch !== null && onStrike !== undefined) {
      gestures.current.set(event.pointerId, { kind: "keys", pitch });
      onStrike(pitch);
      return;
    }
    gestures.current.set(event.pointerId, {
      kind: "pan",
      x: event.clientX,
      pan: renderer.panOffset,
    });
  }

  /** A finger that started on the keys plays every key it crosses and never
   * pans, even while it is off the keyboard between two of them. */
  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const renderer = rendererRef.current;
    const gesture = gestures.current.get(event.pointerId);
    if (renderer === null || gesture === undefined) {
      return;
    }
    if (gesture.kind === "pan") {
      renderer.holdPan();
      renderer.setPan(gesture.pan - (event.clientX - gesture.x));
      return;
    }
    const pitch = pitchUnder(event);
    if (pitch === gesture.pitch) {
      return;
    }
    const previous = gesture.pitch;
    gesture.pitch = pitch;
    releasePitch(event.pointerId, previous);
    if (pitch !== null) {
      onStrike?.(pitch);
    }
  }

  function endPointer(event: ReactPointerEvent<HTMLCanvasElement>) {
    const gesture = gestures.current.get(event.pointerId);
    gestures.current.delete(event.pointerId);
    if (gesture?.kind === "keys") {
      releasePitch(event.pointerId, gesture.pitch);
    }
  }

  // Keyed so React never hands the roll's canvas to the skin when the layers
  // appear: a canvas keeps the first context type it is given, and one that has
  // drawn 2D can never return a WebGL context.
  return (
    <>
      {skin === null ? null : (
        <>
          <canvas
            key="skin-base"
            ref={skinBase}
            className="absolute inset-0 block size-full"
          />
          <canvas
            key="skin-overlay"
            ref={skinOverlay}
            className="absolute inset-0 block size-full"
          />
        </>
      )}
      <canvas
        key="roll"
        ref={canvasRef}
        role="img"
        aria-label={`Piano roll for ${song.name}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        className="absolute inset-0 block size-full touch-none"
      />
    </>
  );
}
