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
import type { PlayerParams } from "@/lib/player-url";
import { lookAhead } from "@/lib/render/piano-roll";
import { type BoardRead, readBoard } from "@/lib/vision/board";
import { storedRange } from "@/lib/vision/calibration";
import type { HandLayer } from "@/lib/vision/hands";
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
  noteBar,
  type PitchRange,
  type Stage,
  stageSpace,
} from "@/lib/vision/space";
import {
  type BarStyle,
  clearFrame,
  defaultFade,
  drawBar,
  drawCameraLayer,
  drawHandles,
  drawNote,
  drawPlacedFrame,
  drawQuad,
  drawWholeFrame,
  placedMap,
  type ToOutput,
  wholeFrameMap,
} from "@/lib/vision/stage";

const output = { width: 1280, height: 720 };
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

/** How often the keys are read off the picture: often while the board is still
 * unknown, and rarely once it is, since the read costs a whole frame of pixels
 * and the draw loop has to keep its frame rate. */
const readBoardEveryMs = 2000;
const rereadBoardEveryMs = 10000;

/** How wide the picture the board is read from. Colour across the keys needs
 * nothing like the detail the stage is drawn at, and a whole frame of pixels
 * read at camera size is a hitch the draw loop cannot hide. */
const readBoardWidth = 640;

type View = "camera" | "stage";

/** A note the player is holding, or one still travelling after it was let go.
 * Times are seconds, in the clock the device stamps its messages with. */
type Struck = {
  readonly from: number;
  to: number | null;
};

/** What the reader sees is the picture, so the detail goes to the console for
 * whoever is chasing a detection rather than into the frame. */
function report(state: TrackerState, reading: Reading | null): string {
  if (state.kind === "held") {
    return state.byHand ? "stage: corners set by hand" : "stage: pattern found";
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

/** The keys as the camera sees them, and the notes the player has struck
 * leaving them along the runway. */
function drawRoll(
  context: CanvasRenderingContext2D,
  stage: Stage,
  to: ToOutput,
  board: PitchRange,
  struck: Map<number, Struck>,
  showKeys: boolean,
  now: number,
): void {
  context.save();
  for (const pitch of keysOf(board)) {
    const held = struck.get(pitch)?.to === null;
    if (!(showKeys || held)) {
      continue;
    }
    const face = keyFace(stage, pitch, board);
    if (face !== null) {
      drawBar(context, face, to, paintFor(pitch, held));
    }
  }
  for (const [pitch, note] of struck) {
    const since = now - note.from;
    if (since > lookAhead) {
      struck.delete(pitch);
      continue;
    }
    const bar = noteBar(
      stage,
      pitch,
      board,
      note.to === null ? 0 : now - note.to,
      since,
    );
    if (bar !== null) {
      drawNote(context, bar, to, noteColour);
    }
  }
  context.restore();
}

/** The song on its way to the keys. A note stands off the keybed by how long it
 * has left before it sounds, so it arrives on its own key as it is played. */
function drawSong(
  context: CanvasRenderingContext2D,
  stage: Stage,
  to: ToOutput,
  board: PitchRange,
  song: Song,
  position: number,
): void {
  context.save();
  for (const note of song.notes) {
    if (note.end <= position || note.start > position + lookAhead) {
      continue;
    }
    const bar = noteBar(
      stage,
      note.pitch,
      board,
      note.start - position,
      note.end - position,
    );
    if (bar !== null) {
      drawNote(context, bar, to, paletteColor(note.track));
    }
  }
  context.restore();
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
  const every = reader.range === null ? readBoardEveryMs : rereadBoardEveryMs;
  if (now - reader.at < every) {
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
  const song = loaded.status === "ready" ? loaded.song : null;
  const sounding = useMemo(
    () => new Set((song?.notes ?? []).map((note) => note.id)),
    [song],
  );
  const playback = usePlaybackEngine({
    song,
    sourceKey: params?.url ?? "",
    autoNotes: sounding,
    speed: params?.speed ?? 1,
    onRestart: () => {},
  });
  // The draw loop starts once and reads the song and the playhead off refs, so
  // loading a song never restarts the camera.
  const playhead = useRef(playback.getPosition);
  playhead.current = playback.getPosition;
  const playingSong = useRef<Song | null>(null);
  playingSong.current = song;
  const video = useRef<HTMLVideoElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const camera = useRef<KeybedCamera | null>(null);
  const hands = useRef<HandLayer | null>(null);
  const dragging = useRef<number | null>(null);
  const corners = useRef<Point[] | null>(null);
  const struck = useRef(new Map<number, Struck>());
  const board = useRef<BoardReader>({
    sheet: null,
    at: 0,
    range: null,
    played: null,
  });
  const view = useRef<View>("camera");
  const keysShown = useRef(true);
  const huntingSince = useRef<number | null>(null);
  const [showing, setShowing] = useState<View>("camera");
  const [showingKeys, setShowingKeys] = useState(true);
  const [hunting, setHunting] = useState(true);
  const [missing, setMissing] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

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
        const at = event.at / 1000;
        if (event.down && event.velocity > 0) {
          struck.current.set(event.pitch, { from: at, to: null });
          rememberPlayed(board.current, event.pitch);
          return;
        }
        const held = struck.current.get(event.pitch);
        if (held !== undefined) {
          held.to = at;
        }
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
  }, []);

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
      // The hands are cut out of the picture so they can be drawn back over the
      // notes. Failing to read them costs the stage nothing but that.
      void import("@/lib/vision/hands")
        .then(async (module) => {
          const layer = await module.createHandLayer();
          if (stop) {
            layer.close();
            return;
          }
          hands.current = layer;
        })
        .catch((reason: unknown) => {
          console.info(
            `stage: no hand layer, ${reason instanceof Error ? reason.message : reason}`,
          );
        });
      const context = canvas.current?.getContext("2d") ?? null;
      let lastSaid = "";

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
        setHunting(state.kind !== "held");
        if (state.kind === "held") {
          huntingSince.current = null;
          setMissing(false);
        } else {
          huntingSince.current ??= now;
          setMissing(now - huntingSince.current > giveUpAfterMs);
        }
        if (state.kind === "held" && dragging.current === null) {
          corners.current = [...state.keybed.quad];
        }
        const size = { width: element.videoWidth, height: element.videoHeight };
        clearFrame(context, output);
        if (state.kind !== "held") {
          // Once the hunt is long enough to be a failure, the picture is what
          // the reader needs: they can only fix the aim by seeing it.
          const searching = now - (huntingSince.current ?? now);
          context.filter =
            searching > giveUpAfterMs ? "none" : "blur(14px) brightness(0.6)";
          drawWholeFrame(context, element, size, output);
          context.filter = "none";
          return;
        }
        // The picture and everything drawn over it come from one keybed, so a
        // corner dragged moves the stage and the keys together.
        const keybed = {
          quad: corners.current ?? state.keybed.quad,
          playerEdgeIsFirst: state.keybed.playerEdgeIsFirst,
        };
        // Cutting the hands out costs a model run, and there is nothing for them
        // to be in front of until the board is known.
        if (board.current.range !== null) {
          hands.current?.look(element, now);
        }
        let to: ToOutput;
        let overlay: ((layer: CanvasImageSource) => void) | null = null;
        if (view.current === "camera") {
          drawWholeFrame(context, element, size, output);
          to = wholeFrameMap(size, output);
          overlay = (layer) => drawWholeFrame(context, layer, size, output);
        } else {
          const placement = placeKeybed(keybed, size, output);
          drawCameraLayer(
            context,
            element,
            size,
            placement,
            output,
            defaultFade,
          );
          to = placedMap(placement, size);
          overlay = (layer) => drawPlacedFrame(context, layer, size, placement);
        }
        const stage = stageSpace(keybed, size);
        if (stage !== null) {
          readTheBoard(board.current, stage, element, size, now);
          const keys = board.current.range;
          if (keys !== null) {
            drawRoll(
              context,
              stage,
              to,
              keys,
              struck.current,
              keysShown.current,
              now / 1000,
            );
            const playing = playingSong.current;
            if (playing !== null) {
              drawSong(context, stage, to, keys, playing, playhead.current());
            }
            // The hands are the one thing on the stage that is not behind the
            // notes: they are on the keys the notes are landing on.
            const skin = hands.current?.layer() ?? null;
            if (skin !== null) {
              overlay?.(skin);
            }
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
      hands.current?.close();
      hands.current = null;
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
      width: element?.videoWidth ?? output.width,
      height: element?.videoHeight ?? output.height,
    };
    const scale = Math.min(
      output.width / size.width,
      output.height / size.height,
    );
    const insetX = (output.width - size.width * scale) / 2;
    const insetY = (output.height - size.height * scale) / 2;
    const x = ((event.clientX - box.left) / box.width) * output.width;
    const y = ((event.clientY - box.top) / box.height) * output.height;
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
          {refused ?? song?.name ?? ""}
        </p>
        {song === null ? null : (
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
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        {hunting ? (
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
        <canvas
          ref={canvas}
          width={output.width}
          height={output.height}
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
          className="max-h-full max-w-full rounded-xl border border-line bg-void"
        />
        {/* The camera feeds the canvas and is never shown on its own, so what
            leaves this page is only ever what the canvas holds. */}
        <video ref={video} className="hidden" muted playsInline />
      </div>
    </div>
  );
}
