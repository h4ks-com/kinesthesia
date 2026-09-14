"use client";

import { isBlack } from "keybed";
import {
  Loader2,
  Pause,
  Piano,
  Play,
  RotateCcw,
  Scan,
  Video,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePlaybackEngine } from "@/lib/audio/use-playback-engine";
import type { SysexListening } from "@/lib/input/sysex-pattern";
import { connectMidiInputs, isWebMidiSupported } from "@/lib/input/web-midi";
import { paletteColor } from "@/lib/midi/palette";
import type { Song } from "@/lib/midi/song";
import { useSong } from "@/lib/midi/use-song";
import { keyboardPart, playSong } from "@/lib/play/parts";
import { usePlayNotes } from "@/lib/play/use-play-notes";
import type { PlayerParams } from "@/lib/player-url";
import {
  defaultKeyWidth,
  keyboardBand,
  whiteKeyLeft,
} from "@/lib/render/keyboard";
import {
  type Frame,
  PianoRollRenderer,
  type SkinReport,
} from "@/lib/render/piano-roll";
import type { SkinInstance } from "@/lib/skins/types";
import { useBackground } from "@/lib/use-background";
import { type BoardRead, readBoard } from "@/lib/vision/board";
import { storedRange } from "@/lib/vision/calibration";
import {
  type KeybedCamera,
  type Reading,
  readsToHold,
  type TrackerState,
} from "@/lib/vision/keybed-camera";
import {
  inPixels,
  nearestCorner,
  type Point,
  placeKeybed,
  type Size,
} from "@/lib/vision/placement";
import {
  keyFace,
  keysOf,
  type PitchRange,
  runwayInView,
  type Stage,
  stageSpace,
  whiteKeysOf,
} from "@/lib/vision/space";
import {
  type BarStyle,
  clearFrame,
  defaultFade,
  drawBar,
  drawCameraLayer,
  drawHandles,
  drawQuad,
  drawWholeFrame,
  placedMap,
  type ToOutput,
  wholeFrameMap,
} from "@/lib/vision/stage";
import { createWarp, type Warp } from "@/lib/vision/warp";

/** The stage is drawn at the size it is shown, so a tall window is a tall stage
 * with more of the runway in it. Capped, since a wide screen at full device
 * pixels is a lot of fill for a picture that came off a camera. */
const mostPixels = 1600;
const noteColour = paletteColor(0);

/** The keys the app believes are there, drawn over the keys the camera sees.
 * Where the two come apart, the board was read wrong, so the black keys are
 * filled to make any drift plain and every C is picked out to show the octave
 * the notes will land in. */
const keyPaint = {
  white: { fill: null, edge: "rgba(76, 158, 255, 0.3)", width: 1 },
  black: {
    fill: "rgba(76, 158, 255, 0.3)",
    edge: "rgba(76, 158, 255, 0.5)",
    width: 1,
  },
  c: {
    fill: "rgba(240, 169, 58, 0.16)",
    edge: "rgba(240, 169, 58, 0.75)",
    width: 1.5,
  },
  struck: { fill: noteColour.glow, edge: noteColour.core, width: 1.5 },
} as const;
const noSysex: SysexListening = { patterns: [], learning: false };

/** How long the camera looks before it says it is not finding a keyboard.
 * A detection off a fresh camera takes a few reads, and a reader who is still
 * aiming needs longer than that before being told to change anything. */
const giveUpAfterMs = 12000;

/** How long the reader waits between attempts at the keys. Once they are read
 * they are kept: the camera is static and the keyboard is where it was put, so
 * nothing about it is worked out twice. */
const readBoardEveryMs = 1500;

/** How wide the picture the board is read from. Colour across the keys needs
 * nothing like the detail the stage is drawn at, and a whole frame of pixels
 * read at camera size is a hitch the draw loop cannot hide. */
const readBoardWidth = 640;

type View = "camera" | "stage";

/** What the reader sees is the picture, so the detail goes to the console for
 * whoever is chasing a detection rather than into the frame. */
function report(state: TrackerState, reading: Reading | null): string {
  if (state.kind === "held") {
    return state.byHand ? "stage: corners set by hand" : "stage: pattern found";
  }
  if (state.kind === "lost") {
    return `stage: keyboard gone, ${state.reason}`;
  }
  const seen =
    reading === null
      ? ""
      : ` · mask ${(reading.coverage * 100).toFixed(0)}% · ${reading.latencyMs.toFixed(0)} ms`;
  return `stage: ${state.progress.reason} · ${state.progress.agreed}/${readsToHold} reads${seen}`;
}

function paintFor(pitch: number, held: boolean): BarStyle {
  if (held) {
    return keyPaint.struck;
  }
  if (isBlack(pitch)) {
    return keyPaint.black;
  }
  return pitch % 12 === 0 ? keyPaint.c : keyPaint.white;
}

/** The keys of the real instrument, outlined where the app believes they are.
 * Where the two come apart the board was read wrong, so the black keys are
 * filled to make any drift plain and every C is picked out. */
function drawKeys(
  context: CanvasRenderingContext2D,
  stage: Stage,
  to: ToOutput,
  board: PitchRange,
  pressed: ReadonlySet<number>,
  showKeys: boolean,
): void {
  context.save();
  for (const pitch of keysOf(board)) {
    const held = pressed.has(pitch);
    if (!(showKeys || held)) {
      continue;
    }
    const face = keyFace(stage, pitch, board);
    if (face !== null) {
      drawBar(context, face, to, paintFor(pitch, held));
    }
  }
  context.restore();
}

/** The app's own roll, drawn once as it is drawn everywhere else and laid onto
 * the plane the camera sees. What is projected is the part above the roll's own
 * keyboard, since the keys on the stage are the real ones. */
type Roll = {
  readonly sheet: HTMLCanvasElement;
  readonly renderer: PianoRollRenderer;
  readonly report: SkinReport;
};

const rollSize = { width: 1280, height: 720 };

function makeRoll(): Roll {
  const sheet = document.createElement("canvas");
  const renderer = new PianoRollRenderer(sheet, defaultKeyWidth, {
    ...rollSize,
    ratio: 1,
  });
  return {
    sheet,
    renderer,
    report: { keyboardTop: 0, travellers: [], strikes: [] },
  };
}

/** Where the roll's own left and right edges fall across the real keyboard, as
 * shares of its span. The roll shows a window onto the keyboard, so the window
 * is what is laid down, not an assumed fit. */
function windowOf(roll: Roll, board: PitchRange): { from: number; to: number } {
  const whites = whiteKeysOf(board);
  const wide = roll.renderer.metrics.whiteWidth;
  const start = whiteKeyLeft(board.lowest, wide);
  return {
    from: (roll.renderer.panOffset - start) / (whites * wide),
    to: (roll.renderer.panOffset + rollSize.width - start) / (whites * wide),
  };
}

/** Fits the roll's window to the board, so its keys sit on the real ones. */
function aimRoll(roll: Roll, board: PitchRange): void {
  roll.renderer.setKeyWidth(rollSize.width / whiteKeysOf(board));
  roll.renderer.setPan(
    whiteKeyLeft(board.lowest, roll.renderer.metrics.whiteWidth),
  );
}

/** What the stage knows about the keyboard in front of it, which is read off
 * the picture rather than assumed. */
type BoardReader = {
  sheet: HTMLCanvasElement | null;
  at: number;
  range: PitchRange | null;
  /** The lowest and highest note the player has sounded, which the board has to
   * be able to play. This is what settles the octave. */
  played: PitchRange | null;
};

/** The black keys say how many keys the board has and which note it starts on,
 * so nothing here is taken on trust about the instrument. A board the player
 * has pinned down themselves is left alone. */
function readTheBoard(
  reader: BoardReader,
  stage: Stage,
  frame: CanvasImageSource,
  size: Size,
  now: number,
): void {
  if (reader.range !== null || now - reader.at < readBoardEveryMs) {
    return;
  }
  reader.at = now;
  const pinned = storedRange();
  if (pinned !== null) {
    reader.range = pinned;
    return;
  }
  reader.sheet ??= document.createElement("canvas");
  const sheet = reader.sheet;
  const scale = Math.min(1, readBoardWidth / size.width);
  sheet.width = Math.round(size.width * scale);
  sheet.height = Math.round(size.height * scale);
  const context = sheet.getContext("2d", { willReadFrequently: true });
  if (context === null) {
    return;
  }
  context.drawImage(frame, 0, 0, sheet.width, sheet.height);
  const pixels = context.getImageData(0, 0, sheet.width, sheet.height);
  const found: BoardRead = readBoard(
    stage,
    {
      width: pixels.width,
      height: pixels.height,
      data: pixels.data,
      scale,
    },
    reader.played,
  );
  console.info(
    found.kind === "read"
      ? `stage: board reads ${found.range.lowest} to ${found.range.highest}, ${(found.agreement * 100).toFixed(0)}% of the keys agree, ${(found.darkShare * 100).toFixed(0)}% dark at ${found.depth} deep`
      : `stage: board unread, ${found.reason}`,
  );
  if (found.kind === "read") {
    reader.range = found.range;
  }
}

/** Every note played tells the reader something the picture cannot: colour says
 * how many keys there are and which note the board starts on inside an octave,
 * never which octave. A note outside what has been sounded before narrows that,
 * so the board is read again on the next frame. */
function rememberPlayed(reader: BoardReader, pitch: number): void {
  const seen = reader.played;
  if (seen !== null && pitch >= seen.lowest && pitch <= seen.highest) {
    return;
  }
  reader.played =
    seen === null
      ? { lowest: pitch, highest: pitch }
      : {
          lowest: Math.min(seen.lowest, pitch),
          highest: Math.max(seen.highest, pitch),
        };
  reader.at = 0;
}

export function StageView({ params }: { params: PlayerParams | null }) {
  const loaded = useSong(params);
  const file = loaded.status === "ready" ? loaded.song : null;
  // With no file to play, the stage is free roam: the roll carries what the
  // keys emit and nothing else.
  const free = useMemo(() => playSong([keyboardPart(0)]), []);
  const song = file ?? free;
  const sounding = useMemo(
    () => new Set(song.notes.map((note) => note.id)),
    [song],
  );
  const playback = usePlaybackEngine({
    song: file,
    sourceKey: params?.url ?? "",
    autoNotes: sounding,
    speed: params?.speed ?? 1,
    onRestart: () => {},
  });
  // The draw loop starts once and reads the song and the playhead off refs, so
  // loading a song never restarts the camera.
  // With a song the roll follows the song's clock; with none it follows the
  // room's, so a key played still sends a note climbing.
  const playhead = useRef<() => number>(() => 0);
  playhead.current =
    file === null ? () => performance.now() / 1000 : playback.getPosition;
  const live = usePlayNotes(() => playhead.current());
  const liveNotes = useRef(live.get);
  liveNotes.current = live.get;
  const playingSong = useRef<Song>(song);
  playingSong.current = song;
  const playing = useRef(false);
  playing.current = playback.playing;
  const speed = useRef(1);
  speed.current = params?.speed ?? 1;
  const roll = useRef<Roll | null>(null);
  const solved = useRef<{
    readonly quad: readonly Point[];
    readonly stage: Stage | null;
  } | null>(null);
  const warp = useRef<Warp | null>(null);

  // The stage shows whatever background the player is set to, so the two views
  // of a song look like the same app.
  const background = useBackground({
    fixed: "down",
    plain: false,
    fromLink: { skin: params?.skin ?? null, rise: false },
  });
  const skinBase = useRef<HTMLCanvasElement | null>(null);
  const skinOverlay = useRef<HTMLCanvasElement | null>(null);
  const skin = useRef<SkinInstance | null>(null);
  const skinFrom = useRef(0);
  const video = useRef<HTMLVideoElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const camera = useRef<KeybedCamera | null>(null);
  const dragging = useRef<number | null>(null);
  const corners = useRef<Point[] | null>(null);
  const pressed = useRef(new Set<number>());
  const board = useRef<BoardReader>({
    sheet: null,
    at: 0,
    range: null,
    played: null,
  });
  const stage = useRef<HTMLDivElement | null>(null);
  const output = useRef({ width: 1280, height: 720 });
  const view = useRef<View>("camera");
  const keysShown = useRef(false);
  const huntingSince = useRef<number | null>(null);
  const [showing, setShowing] = useState<View>("camera");
  const [showingKeys, setShowingKeys] = useState(false);
  const [looking, setLooking] = useState<TrackerState["kind"]>("hunting");
  const [missing, setMissing] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  // The stage is drawn at the size it is shown at, so the window's own shape
  // decides how much of the runway is in view.
  useEffect(() => {
    const box = stage.current;
    const sheet = canvas.current;
    if (box === null || sheet === null) {
      return;
    }
    const settle = (): void => {
      const seen = box.getBoundingClientRect();
      const ratio = Math.min(
        window.devicePixelRatio,
        mostPixels / Math.max(seen.width, 1),
      );
      const width = Math.max(2, Math.round(seen.width * ratio));
      const height = Math.max(2, Math.round(seen.height * ratio));
      output.current = { width, height };
      sheet.width = width;
      sheet.height = height;
    };
    settle();
    const watching = new ResizeObserver(settle);
    watching.observe(box);
    return () => watching.disconnect();
  }, []);

  useEffect(() => {
    const base = skinBase.current;
    const over = skinOverlay.current;
    const source = background.source;
    if (base === null || over === null || source === null) {
      return;
    }
    const made = source.create({ base, overlay: over });
    skin.current = made;
    if (made === null) {
      return;
    }
    const settle = (): void => {
      const box = base.getBoundingClientRect();
      made.resize(
        box.width,
        box.height,
        Math.min(window.devicePixelRatio, 1.5),
      );
    };
    settle();
    const watching = new ResizeObserver(settle);
    watching.observe(base);
    return () => {
      watching.disconnect();
      made.dispose();
      skin.current = null;
    };
  }, [background.source]);

  useEffect(() => {
    if (!isWebMidiSupported()) {
      return;
    }
    let disconnect: (() => void) | null = null;
    let dropped = false;
    connectMidiInputs(
      (event) => {
        if (event.type !== "note") {
          return;
        }
        if (event.down && event.velocity > 0) {
          pressed.current.add(event.pitch);
          live.emit(event.pitch, 0, event.velocity);
          rememberPlayed(board.current, event.pitch);
          return;
        }
        pressed.current.delete(event.pitch);
        live.lift(event.pitch, 0);
        live.damp(event.pitch, 0);
      },
      () => noSysex,
    )
      .then((off) => {
        if (dropped) {
          off();
          return;
        }
        disconnect = off;
      })
      .catch(() => {
        // A browser with no device, or one that refuses: the stage still shows
        // the keys, it just has nothing to light them with.
      });
    return () => {
      dropped = true;
      disconnect?.();
    };
  }, [live]);

  useEffect(() => {
    let stop = false;
    let stream: MediaStream | null = null;
    let frame = 0;

    const run = async (): Promise<void> => {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const element = video.current;
      if (element === null || stop) {
        return;
      }
      element.srcObject = stream;
      await element.play();

      // The model and its runtime are megabytes, and nothing outside this page
      // wants them, so they arrive only once a camera is running.
      const { createKeybedCamera } = await import("@/lib/vision/keybed-camera");
      camera.current = await createKeybedCamera();
      roll.current ??= makeRoll();
      warp.current ??= createWarp();
      const context = canvas.current?.getContext("2d") ?? null;
      let lastSaid = "";

      /** The app's roll, drawn for this moment and laid onto the runway. */
      const layRoll = (
        context: CanvasRenderingContext2D,
        stage: Stage,
        to: ToOutput,
        board: PitchRange,
        output: Size,
        struck: ReadonlySet<number>,
        position: number,
      ): void => {
        const sheet = roll.current;
        const paint = warp.current;
        const song = playingSong.current;
        if (sheet === null || paint === null) {
          return;
        }
        aimRoll(sheet, board);
        const frame: Frame = {
          song,
          position,
          live: liveNotes.current(),
          sustain: false,
          expression: null,
          direction: "down",
          rate: speed.current,
          playTrack: 0,
          voicing: new Map(),
          hiddenTracks: new Set(),
          pressed: struck,
          owed: new Set(),
          hits: new Set(),
          yours: null,
          reach: null,
          keyLabels: null,
          noteNames: false,
          plain: false,
          follow: false,
          songPresses: true,
          report: sheet.report,
        };
        sheet.renderer.draw(frame);
        const band = keyboardBand(rollSize.height);
        const span = windowOf(sheet, board);
        const far = runwayInView(stage, to, 0);
        // The runway is solved in the camera's frame, and everything drawn on
        // the stage goes through the same placement as the picture.
        const corners = [
          stage.at(span.from, far),
          stage.at(span.to, far),
          stage.at(span.to, 0),
          stage.at(span.from, 0),
        ].flatMap((point) => (point === null ? [] : [to(point)]));
        if (corners.length < 4) {
          return;
        }
        const laid = paint.onto(
          sheet.sheet,
          { width: rollSize.width, height: band.top },
          rollSize,
          corners,
          output,
        );
        if (laid !== null) {
          context.drawImage(laid, 0, 0);
        }
      };

      const draw = (now: number): void => {
        frame = requestAnimationFrame(draw);
        const reader = camera.current;
        if (context === null || reader === null || element.videoWidth === 0) {
          return;
        }
        void reader.look(element, now);
        const state = reader.state();
        const said = report(state, reader.reading());
        if (said !== lastSaid) {
          lastSaid = said;
          console.info(said);
        }
        setLooking(state.kind);
        if (state.kind === "hunting") {
          huntingSince.current ??= now;
          setMissing(now - huntingSince.current > giveUpAfterMs);
        } else {
          huntingSince.current = null;
          setMissing(false);
        }
        if (state.kind === "held" && dragging.current === null) {
          corners.current = [...state.keybed.quad];
        }
        const size = { width: element.videoWidth, height: element.videoHeight };
        clearFrame(context, output.current);
        const behind = skin.current;
        if (behind !== null) {
          skinFrom.current ||= now;
          behind.draw({
            keyboardTop: output.current.height,
            elapsed: (now - skinFrom.current) / 1000,
            position: playhead.current(),
            travellers: [],
            strikes: [],
            step: 1 / 60,
            pressed: [...pressed.current],
            chord: null,
            key: playingSong.current?.key ?? null,
          });
        }
        if (state.kind !== "held") {
          // Once the hunt is long enough to be a failure, the picture is what
          // the reader needs: they can only fix the aim by seeing it, and a
          // keyboard that has gone is the same question.
          const searching = now - (huntingSince.current ?? now);
          context.filter =
            state.kind === "lost" || searching > giveUpAfterMs
              ? "none"
              : "blur(14px) brightness(0.6)";
          drawWholeFrame(context, element, size, output.current);
          context.filter = "none";
          return;
        }
        // The picture and everything drawn over it come from one keybed, so a
        // corner dragged moves the stage and the keys together.
        const keybed = {
          quad: corners.current ?? state.keybed.quad,
          playerEdgeIsFirst: state.keybed.playerEdgeIsFirst,
        };
        let to: ToOutput;
        if (view.current === "camera") {
          drawWholeFrame(context, element, size, output.current);
          to = wholeFrameMap(size, output.current);
        } else {
          const placement = placeKeybed(keybed, size, output.current);
          drawCameraLayer(
            context,
            element,
            size,
            placement,
            output.current,
            defaultFade,
          );
          to = placedMap(placement, size);
        }
        // The corners do not move once they are held, so neither does the pose.
        if (solved.current?.quad !== keybed.quad) {
          solved.current = {
            quad: keybed.quad,
            stage: stageSpace(keybed, size),
          };
        }
        const stage = solved.current.stage;
        if (stage !== null) {
          readTheBoard(board.current, stage, element, size, now);
          const keys = board.current.range;
          if (keys !== null) {
            drawKeys(
              context,
              stage,
              to,
              keys,
              pressed.current,
              keysShown.current,
            );
            layRoll(
              context,
              stage,
              to,
              keys,
              output.current,
              pressed.current,
              playhead.current(),
            );
          }
        }
        if (view.current === "camera") {
          const pixels = keybed.quad.map((corner) => inPixels(corner, size));
          drawQuad(context, pixels, to);
          drawHandles(context, pixels, to);
        }
      };
      frame = requestAnimationFrame(draw);
    };

    run().catch((reason: unknown) => {
      setRefused(reason instanceof Error ? reason.message : `${reason}`);
    });

    return () => {
      stop = true;
      cancelAnimationFrame(frame);
      for (const track of stream?.getTracks() ?? []) {
        track.stop();
      }
    };
  }, []);

  /** Where a pointer sits inside the drawn frame, as a share of it. */
  const framePoint = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect();
    const element = video.current;
    const size = {
      width: element?.videoWidth ?? output.current.width,
      height: element?.videoHeight ?? output.current.height,
    };
    const shown = output.current;
    const scale = Math.min(
      shown.width / size.width,
      shown.height / size.height,
    );
    const insetX = (shown.width - size.width * scale) / 2;
    const insetY = (shown.height - size.height * scale) / 2;
    const x = ((event.clientX - box.left) / box.width) * shown.width;
    const y = ((event.clientY - box.top) / box.height) * shown.height;
    return {
      x: (x - insetX) / (size.width * scale),
      y: (y - insetY) / (size.height * scale),
    };
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-void">
      <header className="flex h-14 shrink-0 items-center gap-3 border-line border-b bg-panel px-4">
        <h1 className="label">stage</h1>
        <p
          className={`min-w-0 flex-1 truncate font-mono text-[0.7rem] ${
            refused === null ? "text-muted" : "text-warn"
          }`}
        >
          {refused ?? file?.name ?? ""}
        </p>
        {file === null ? null : (
          <button
            type="button"
            onClick={() => {
              void playback.toggle();
            }}
            aria-label={playback.playing ? "Pause the song" : "Play the song"}
            data-tip={playback.playing ? "Pause the song" : "Play the song"}
            data-tip-side="bottom"
            data-tip-align="right"
            className="shrink-0 rounded-lg p-1.5 text-faint transition-colors hover:bg-raised hover:text-accent pointer-coarse:min-h-11"
          >
            {playback.playing ? (
              <Pause className="size-4" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => camera.current?.release()}
          aria-label="Detect the keybed again"
          data-tip="Detect the keybed again"
          data-tip-side="bottom"
          data-tip-align="right"
          className="shrink-0 rounded-lg p-1.5 text-faint transition-colors hover:bg-raised hover:text-accent pointer-coarse:min-h-11"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => {
            keysShown.current = !showingKeys;
            setShowingKeys(!showingKeys);
          }}
          aria-pressed={showingKeys}
          aria-label={showingKeys ? "Hide the keys" : "Show the keys"}
          data-tip={showingKeys ? "Hide the keys" : "Show the keys"}
          data-tip-side="bottom"
          data-tip-align="right"
          className={`shrink-0 rounded-lg p-1.5 transition-colors pointer-coarse:min-h-11 ${
            showingKeys
              ? "text-accent"
              : "text-faint hover:bg-raised hover:text-accent"
          }`}
        >
          <Piano className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => {
            const next = showing === "camera" ? "stage" : "camera";
            view.current = next;
            setShowing(next);
          }}
          aria-pressed={showing === "stage"}
          aria-label={
            showing === "stage" ? "Show the camera" : "Preview the stage"
          }
          data-tip={
            showing === "stage" ? "Show the camera" : "Preview the stage"
          }
          data-tip-side="bottom"
          data-tip-align="right"
          className={`shrink-0 rounded-lg p-1.5 transition-colors pointer-coarse:min-h-11 ${
            showing === "stage"
              ? "text-accent"
              : "text-faint hover:bg-raised hover:text-accent"
          }`}
        >
          {showing === "stage" ? (
            <Video className="size-4" aria-hidden="true" />
          ) : (
            <Scan className="size-4" aria-hidden="true" />
          )}
        </button>
      </header>
      <div
        ref={stage}
        className="relative min-h-0 flex-1 overflow-hidden bg-void"
      >
        {background.source === null ? null : (
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
        {looking === "hunting" ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <Loader2
              className="size-6 animate-spin text-accent"
              aria-hidden="true"
            />
            <p className="font-mono text-[0.7rem] text-muted">
              Finding piano pattern
            </p>
            {missing ? (
              <p className="max-w-sm text-[0.75rem] text-faint leading-relaxed">
                No piano pattern found yet. Point the camera at the whole
                keybed, from above the keys, and light the keyboard evenly.
              </p>
            ) : null}
          </div>
        ) : null}
        {looking === "lost" ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="font-mono text-[0.7rem] text-warn">
              Piano pattern out of the picture
            </p>
            <p className="max-w-sm text-[0.75rem] text-faint leading-relaxed">
              Detect the keybed again once the keyboard is back in frame.
            </p>
          </div>
        ) : null}
        <canvas
          ref={canvas}
          onPointerDown={(event) => {
            if (showing !== "camera" || corners.current === null) {
              return;
            }
            const found = nearestCorner(corners.current, framePoint(event));
            if (found === null) {
              return;
            }
            dragging.current = found;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const index = dragging.current;
            const quad = corners.current;
            if (index === null || quad === null) {
              return;
            }
            quad[index] = framePoint(event);
          }}
          onPointerUp={() => {
            const quad = corners.current;
            if (dragging.current !== null && quad !== null) {
              camera.current?.hold(quad);
            }
            dragging.current = null;
          }}
          className="absolute inset-0 block size-full"
        />
        {/* The camera feeds the canvas and is never shown on its own, so what
            leaves this page is only ever what the canvas holds. */}
        <video ref={video} className="hidden" muted playsInline />
      </div>
    </div>
  );
}
