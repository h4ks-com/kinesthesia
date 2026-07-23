import type { Reach } from "@/lib/input/keyboard-map";
import { type NoteColor, pitchColor, trackColor } from "@/lib/midi/palette";
import {
  highestPitch,
  isBlackKey,
  type LiveNote,
  lowestPitch,
  noteName,
  type Song,
} from "@/lib/midi/song";
import {
  blackKeyLeft,
  blackKeyWidth,
  clampKeyWidth,
  defaultKeyWidth,
  type KeyboardMetrics,
  keyboardBand,
  keyboardMetrics,
  keyCenter,
  pitchAtPoint,
  whiteKeyLeft,
  whiteKeys,
} from "@/lib/render/keyboard";

const lookAhead = 3.5;
/** Real seconds of warning before an owed note lands. Scaled by playback speed
 * so a fast song still gives the same time to react, and capped at the look
 * ahead so a long rest before the next note shows nothing until it nears. */
const foreshadowLead = 0.8;
const maxDevicePixelRatio = 1.5;
/** How long a struck drum keeps its key lit. The note-off a MIDI writes for a
 * drum is arbitrary and often runs for a beat, which would hold the key long
 * after the hit it stands for. */
const drumDecay = 0.09;

type SparkKind = "note" | "strike" | "bloom";

const sparkBursts: Record<
  SparkKind,
  { count: number; speed: number; radius: number; white: number }
> = {
  note: { count: 14, speed: 1, radius: 1, white: 0.35 },
  strike: { count: 18, speed: 1.15, radius: 1.1, white: 0.55 },
  bloom: { count: 30, speed: 1.5, radius: 1.35, white: 0.85 },
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  radius: number;
  color: string;
};

export type Frame = {
  readonly song: Song;
  readonly position: number;
  /** Play mode's emitted notes, rising from the keys. Null in watch, learn and
   * match, where notes fall from the song instead. */
  readonly live: readonly LiveNote[] | null;
  /** The sustain pedal is down, marked discreetly along the strike line. */
  readonly sustain: boolean;
  /** Playback speed, so the foreshadow lead is a constant reaction time rather
   * than a fixed song distance that shrinks as the song speeds up. */
  readonly rate: number;
  /** The track the player is playing, so a struck key that is not sitting on a
   * sounding note still lights and sparks in their part's colour. */
  readonly playTrack: number;
  readonly hiddenTracks: ReadonlySet<number>;
  readonly pressed: ReadonlySet<number>;
  /** The pitches the player still owes at the current gate, so a strike that
   * lands on one can be celebrated differently from a wrong one. */
  readonly owed: ReadonlySet<number>;
  /** Note ids the player has to play. Everything else is drawn faintly, so a
   * reduced part still shows the song it came from. Null draws them all. */
  readonly yours: ReadonlySet<number> | null;
  /** What the computer keyboard can reach from here, marked over the keys so
   * the octave keys have something to move. */
  readonly reach: Reach | null;
  /** Which computer key plays each pitch, printed on the keys themselves.
   * Null leaves them bare. */
  readonly keyLabels: ReadonlyMap<number, string> | null;
  /** Fills flat and drops the glow, the sparks and the ramps, for anyone who
   * would rather read the notes than watch them. */
  readonly plain: boolean;
};

/** A fixed drawing surface for an offline render, where there is no laid-out
 * canvas to read a size or device ratio from. */
export type FixedSurface = {
  readonly width: number;
  readonly height: number;
  readonly ratio: number;
};

export class PianoRollRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly fixed: FixedSurface | null;
  private readonly particles: Particle[] = [];
  /** The keys an owed note is approaching, with how near it is (0 far, 1 at the
   * line), so learn and match can foreshadow what to press. */
  private readonly foreshadow = new Map<
    number,
    { color: NoteColor; strength: number }
  >();
  private previouslyActive = new Set<number>();
  private previouslyPressed = new Set<number>();
  private drumTracks: ReadonlySet<number> = new Set();
  private drumsFrom: Song | null = null;
  private shadow: CanvasGradient | null = null;
  private shadowAt = -1;
  private whiteFace: CanvasGradient | null = null;
  private blackFace: CanvasGradient | null = null;
  private facesAt = -1;
  private pan = 0;
  private keyWidth: number;

  constructor(
    canvas: HTMLCanvasElement,
    keyWidth: number = defaultKeyWidth,
    fixed: FixedSurface | null = null,
  ) {
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("Canvas 2D context is unavailable");
    }
    this.canvas = canvas;
    this.context = context;
    this.fixed = fixed;
    this.keyWidth = clampKeyWidth(keyWidth);
  }

  private get viewWidth(): number {
    return this.fixed?.width ?? this.canvas.clientWidth;
  }

  private get viewHeight(): number {
    return this.fixed?.height ?? this.canvas.clientHeight;
  }

  private get ratio(): number {
    return (
      this.fixed?.ratio ??
      Math.min(window.devicePixelRatio, maxDevicePixelRatio)
    );
  }

  get metrics(): KeyboardMetrics {
    return keyboardMetrics(this.viewWidth, this.keyWidth);
  }

  get panOffset(): number {
    return this.pan;
  }

  setPan(value: number): void {
    this.pan = Math.min(this.metrics.maxPan, Math.max(0, value));
  }

  /** Panning is measured in pixels, so a key width change keeps the same part
   * of the keyboard in view. */
  setKeyWidth(value: number): void {
    const previous = this.metrics;
    const centre = (this.pan + this.viewWidth / 2) / previous.total;
    this.keyWidth = clampKeyWidth(value);
    const next = this.metrics;
    this.setPan(centre * next.total - this.viewWidth / 2);
  }

  /** Brings a pitch into view, since a narrow screen shows a window onto the
   * keyboard and the part being played is rarely the part it opens on. */
  centreOn(pitch: number): void {
    const { whiteWidth } = this.metrics;
    this.setPan(keyCenter(pitch, whiteWidth) - this.viewWidth / 2);
  }

  pitchAt(x: number, y: number): number | null {
    return pitchAtPoint(x, y, {
      width: this.viewWidth,
      height: this.viewHeight,
      keyWidth: this.keyWidth,
      pan: this.pan,
    });
  }

  resize(): void {
    const ratio = this.ratio;
    const pixelWidth = Math.round(this.viewWidth * ratio);
    const pixelHeight = Math.round(this.viewHeight * ratio);
    if (
      this.canvas.width !== pixelWidth ||
      this.canvas.height !== pixelHeight
    ) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
  }

  draw(frame: Frame): void {
    const ctx = this.context;
    const ratio = this.ratio;
    const width = this.viewWidth;
    const height = this.viewHeight;
    this.resize();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const band = keyboardBand(height);
    const keyboardHeight = band.height;
    const keyboardTop = band.top;
    const { whiteWidth, total, maxPan } = this.metrics;
    this.pan = Math.min(maxPan, this.pan);

    ctx.fillStyle = "#060709";
    ctx.fillRect(0, 0, width, height);
    ctx.translate(-this.pan, 0);
    this.paintBackground(total, height, keyboardTop, whiteWidth, frame.plain);

    const active = new Map<number, NoteColor>();
    this.foreshadow.clear();
    if (frame.live === null) {
      this.paintNotes(frame, keyboardTop, whiteWidth, active);
    } else {
      this.paintLiveNotes(frame, frame.live, keyboardTop, whiteWidth, active);
    }
    for (const pitch of frame.pressed) {
      active.set(pitch, active.get(pitch) ?? trackColor(frame.playTrack));
    }

    this.paintKeyboardShadow(total, keyboardTop);
    if (frame.plain) {
      // emitSparks is what advances these, so keep them current here or turning
      // the effects back on would fire a burst for every note already sounding.
      this.previouslyActive = new Set(active.keys());
      this.previouslyPressed = new Set(frame.pressed);
    } else {
      this.paintGlow(active, keyboardTop, whiteWidth);
      this.emitSparks(frame, active, keyboardTop, whiteWidth);
    }
    this.paintKeyboard(
      frame,
      active,
      keyboardTop,
      keyboardHeight,
      whiteWidth,
      total,
    );
    this.paintParticles();
    if (frame.sustain) {
      this.paintSustain(keyboardTop, total);
    }
    this.paintReach(frame.reach, keyboardTop, whiteWidth, total);
    ctx.translate(this.pan, 0);
  }

  /** A soft lit bar riding the strike line while the pedal is down, so a held
   * sustain reads at a glance without competing with the notes. */
  private paintSustain(keyboardTop: number, total: number): void {
    const ctx = this.context;
    const y = keyboardTop - 3;
    const bar = ctx.createLinearGradient(0, y, total, y);
    bar.addColorStop(0, "rgba(123,184,255,0)");
    bar.addColorStop(0.5, "rgba(123,184,255,0.9)");
    bar.addColorStop(1, "rgba(123,184,255,0)");
    ctx.save();
    ctx.shadowColor = "rgba(123,184,255,0.8)";
    ctx.shadowBlur = 10;
    ctx.fillStyle = bar;
    ctx.fillRect(0, y, total, 2);
    ctx.restore();
  }

  /** A bar over the stretch the computer keyboard covers, drawn on top of the
   * keys so shifting the octave visibly slides it. */
  private paintReach(
    reach: Reach | null,
    keyboardTop: number,
    whiteWidth: number,
    total: number,
  ): void {
    if (reach === null) {
      return;
    }
    const left = Math.max(0, keyCenter(reach.low, whiteWidth) - whiteWidth / 2);
    const right = Math.min(
      total,
      keyCenter(reach.high, whiteWidth) + whiteWidth / 2,
    );
    if (right <= left) {
      return;
    }
    const ctx = this.context;
    const thickness = 3;
    ctx.save();
    ctx.fillStyle = "#4c9eff";
    ctx.shadowColor = "rgba(76,158,255,0.7)";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.roundRect(
      left,
      keyboardTop - thickness - 1,
      right - left,
      thickness,
      2,
    );
    ctx.fill();
    ctx.restore();
  }

  private paintBackground(
    width: number,
    height: number,
    keyboardTop: number,
    whiteWidth: number,
    plain: boolean,
  ): void {
    const ctx = this.context;
    if (plain) {
      ctx.fillStyle = "#080a10";
    } else {
      // Deepest at the strike line, so a bright note head has the most to sit
      // against exactly where it is being read.
      const background = ctx.createLinearGradient(0, 0, 0, height);
      background.addColorStop(0, "#0c1020");
      background.addColorStop(1, "#040509");
      ctx.fillStyle = background;
    }
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(150,180,255,0.055)";
    ctx.lineWidth = 1;
    for (const pitch of whiteKeys) {
      if (pitch % 12 !== 0) {
        continue;
      }
      const x = whiteKeyLeft(pitch, whiteWidth);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, keyboardTop);
      ctx.stroke();
    }
  }

  private paintNotes(
    frame: Frame,
    keyboardTop: number,
    whiteWidth: number,
    active: Map<number, NoteColor>,
  ): void {
    const ctx = this.context;
    const { position } = frame;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Which tracks are drums cannot change without the song changing, so it is
    // worked out per file rather than per frame.
    if (this.drumsFrom !== frame.song) {
      this.drumsFrom = frame.song;
      this.drumTracks = new Set(
        frame.song.tracks
          .filter((track) => track.percussion)
          .map((track) => track.index),
      );
    }
    const drums = this.drumTracks;
    const blackNote = blackKeyWidth(whiteWidth);
    const whiteNote = whiteWidth * 0.86;

    for (const note of frame.song.notes) {
      if (note.start > position + lookAhead) {
        break;
      }
      if (note.end < position || frame.hiddenTracks.has(note.track)) {
        continue;
      }
      const ghost = frame.yours !== null && !frame.yours.has(note.id);
      const color = trackColor(note.track);
      const sounding = note.start <= position;

      // A drum is an impulse: the mark falls to the line and is spent there,
      // and the key it lights decays on its own rather than on the note-off.
      if (drums.has(note.track)) {
        const struck = position - note.start;
        if (!ghost && struck >= 0 && struck < drumDecay) {
          active.set(note.pitch, color);
        }
        const strike = (keyboardTop * (struck + lookAhead)) / lookAhead;
        if (strike <= keyboardTop) {
          const half =
            Math.min(isBlackKey(note.pitch) ? blackNote : whiteNote, 13) / 2;
          const centre = keyCenter(note.pitch, whiteWidth);
          ctx.globalAlpha = ghost ? 0.22 : 0.74 + note.velocity * 0.26;
          ctx.fillStyle = frame.plain ? color.flat : color.glow;
          ctx.beginPath();
          ctx.moveTo(centre, strike - half * 1.6);
          ctx.lineTo(centre + half, strike);
          ctx.lineTo(centre, strike + half * 1.6);
          ctx.lineTo(centre - half, strike);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        continue;
      }

      if (sounding && !ghost) {
        active.set(note.pitch, color);
      }

      // Light the key an owed note is heading for, but only once it is within a
      // speed-scaled lead of the line, and only the nearest one per key.
      if (
        !ghost &&
        !sounding &&
        frame.owed.has(note.pitch) &&
        !this.foreshadow.has(note.pitch)
      ) {
        const lead = Math.min(foreshadowLead * frame.rate, lookAhead);
        const ahead = note.start - position;
        if (ahead <= lead) {
          this.foreshadow.set(note.pitch, {
            color,
            strength: 1 - ahead / lead,
          });
        }
      }

      const bottom = Math.min(
        keyboardTop,
        (keyboardTop * (position - note.start + lookAhead)) / lookAhead,
      );
      const top = (keyboardTop * (position - note.end + lookAhead)) / lookAhead;
      const noteWidth = isBlackKey(note.pitch) ? blackNote : whiteNote;
      const x = keyCenter(note.pitch, whiteWidth) - noteWidth / 2;
      const y = Math.min(top, bottom);
      const noteHeight = Math.max(2, bottom - y);

      // The hue holds across the body and only lifts in the last of the bar,
      // so the leading edge reads as lit without the note becoming a ramp. A
      // note being played drops the deep end and burns at its core instead.
      const gradient = frame.plain
        ? null
        : ctx.createLinearGradient(0, y, 0, y + noteHeight);
      if (gradient === null) {
        // Flat, but a note being played still has to read as different.
      } else if (sounding) {
        gradient.addColorStop(0, color.glow);
        gradient.addColorStop(0.4, color.core);
        gradient.addColorStop(1, color.core);
      } else {
        gradient.addColorStop(0, color.shade);
        gradient.addColorStop(0.3, color.glow);
        gradient.addColorStop(0.82, color.glow);
        gradient.addColorStop(1, color.core);
      }
      // Velocity only sets how firmly the note sits, since a MIDI whose notes
      // all carry one velocity must not end up a uniformly dim roll.
      const punch = 0.74 + note.velocity * 0.26;
      ctx.globalAlpha = ghost ? 0.22 : punch;
      ctx.fillStyle = gradient ?? (sounding ? color.glow : color.flat);
      roundRect(ctx, x, y, noteWidth, noteHeight, 4);
      ctx.fill();
      ctx.globalAlpha = 1;

      if (!ghost && !sounding && noteWidth >= 17 && noteHeight >= 20) {
        const centerX = x + noteWidth / 2;
        const centerY = y + noteHeight - 13;
        const label = noteName(note.pitch);
        // The chip reads against the note rather than competing with it: the
        // pitch keeps its colour, but only as the ring.
        ctx.beginPath();
        ctx.arc(centerX, centerY, 9, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(6,8,13,0.82)";
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = pitchColor(note.pitch);
        ctx.stroke();
        ctx.font = `${label.length > 1 ? "700 9px" : "700 11px"} system-ui, sans-serif`;
        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, centerX, centerY);
      }
    }
  }

  /** The reverse of paintNotes: a note leaves the keys the moment it is struck
   * and climbs, its foot pinned to the keyboard while held so the bar grows,
   * then lifting off once released. A held note lights its key, so the glow,
   * sparks and sink all read the same as playing along in any other mode. */
  private paintLiveNotes(
    frame: Frame,
    live: readonly LiveNote[],
    keyboardTop: number,
    whiteWidth: number,
    active: Map<number, NoteColor>,
  ): void {
    const ctx = this.context;
    const { position } = frame;
    const scale = keyboardTop / lookAhead;
    const blackNote = blackKeyWidth(whiteWidth);
    const whiteNote = whiteWidth * 0.86;

    for (const note of live) {
      const headAge = position - note.start;
      if (headAge < 0) {
        continue;
      }
      const held = note.end === null;
      const footAge = note.end === null ? 0 : position - note.end;
      const bottom = keyboardTop - footAge * scale;
      if (bottom < 0) {
        continue;
      }
      const color = trackColor(note.track);
      if (held) {
        active.set(note.pitch, color);
      }

      const top = keyboardTop - headAge * scale;
      const noteWidth = isBlackKey(note.pitch) ? blackNote : whiteNote;
      const x = keyCenter(note.pitch, whiteWidth) - noteWidth / 2;
      const y = Math.max(0, top);
      const noteHeight = Math.max(2, bottom - y);

      // Brightest at the leading edge climbing away from the keys, deepening
      // toward the foot once the note has been let go.
      let fill: string | CanvasGradient = color.glow;
      if (!frame.plain) {
        const gradient = ctx.createLinearGradient(0, y, 0, y + noteHeight);
        gradient.addColorStop(0, color.core);
        gradient.addColorStop(held ? 0.6 : 0.25, color.glow);
        gradient.addColorStop(1, held ? color.glow : color.shade);
        fill = gradient;
      } else {
        fill = color.flat;
      }
      ctx.globalAlpha = 0.74 + note.velocity * 0.26;
      ctx.fillStyle = fill;
      roundRect(ctx, x, y, noteWidth, noteHeight, 4);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  private paintGlow(
    active: ReadonlyMap<number, NoteColor>,
    keyboardTop: number,
    whiteWidth: number,
  ): void {
    const ctx = this.context;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const [pitch, color] of active) {
      const centerX = keyCenter(pitch, whiteWidth);
      const radius = whiteWidth * 1.9;
      const glow = ctx.createRadialGradient(
        centerX,
        keyboardTop,
        0,
        centerX,
        keyboardTop,
        radius,
      );
      glow.addColorStop(0, color.glow);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(centerX, keyboardTop, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** A key the song already lit gives nothing back when the player hits it, so
   * a strike sparks on its own account rather than only on a note starting. */
  private emitSparks(
    frame: Frame,
    active: ReadonlyMap<number, NoteColor>,
    keyboardTop: number,
    whiteWidth: number,
  ): void {
    const sparked = new Set<number>();
    for (const pitch of frame.pressed) {
      if (this.previouslyPressed.has(pitch)) {
        continue;
      }
      sparked.add(pitch);
      this.spawnSparks(
        keyCenter(pitch, whiteWidth),
        keyboardTop,
        active.get(pitch) ?? trackColor(frame.playTrack),
        frame.owed.has(pitch) ? "bloom" : "strike",
      );
    }
    for (const [pitch, color] of active) {
      if (this.previouslyActive.has(pitch) || sparked.has(pitch)) {
        continue;
      }
      this.spawnSparks(
        keyCenter(pitch, whiteWidth),
        keyboardTop,
        color,
        "note",
      );
    }
    this.previouslyActive = new Set(active.keys());
    this.previouslyPressed = new Set(frame.pressed);
  }

  private spawnSparks(
    centerX: number,
    keyboardTop: number,
    color: NoteColor,
    kind: SparkKind,
  ): void {
    const burst = sparkBursts[kind];
    const count = burst.count + Math.floor(Math.random() * 8);
    for (let index = 0; index < count; index += 1) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
      const speed = Math.random() * 4 * burst.speed + 1;
      this.particles.push({
        x: centerX + (Math.random() - 0.5) * 7,
        y: keyboardTop,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        radius: Math.random() * 2.2 * burst.radius + 0.7,
        color:
          Math.random() < burst.white
            ? "#ffffff"
            : Math.random() < 0.5
              ? color.core
              : color.glow,
      });
    }
  }

  private paintKeyboard(
    frame: Frame,
    active: ReadonlyMap<number, NoteColor>,
    keyboardTop: number,
    keyboardHeight: number,
    whiteWidth: number,
    width: number,
  ): void {
    const ctx = this.context;
    this.ensureKeyFaces(keyboardTop, keyboardHeight);
    const blackHeight = keyboardHeight * 0.6;

    for (const pitch of whiteKeys) {
      const x = whiteKeyLeft(pitch, whiteWidth);
      // A lit key sinks a couple pixels, exposing the keybed above it.
      const sink = active.has(pitch) ? 2 : 0;
      this.setKeyPaint(frame, active, pitch, this.whiteFace ?? "#dfe4ec", 20);
      ctx.fillRect(
        x + 0.5,
        keyboardTop + sink,
        whiteWidth - 1,
        keyboardHeight - sink,
      );
      ctx.shadowBlur = 0;
      // Washed before the black keys are laid over it, so the wash never spills
      // onto a black key sitting on top and the layering reads true.
      if (!frame.plain) {
        this.washForeshadow(
          pitch,
          active,
          x + 0.5,
          keyboardTop,
          whiteWidth - 1,
          keyboardHeight,
        );
      }
    }

    for (let pitch = lowestPitch; pitch <= highestPitch; pitch += 1) {
      if (!isBlackKey(pitch)) {
        continue;
      }
      const blackWidth = blackKeyWidth(whiteWidth);
      const x = blackKeyLeft(pitch, whiteWidth);
      // The shadow a raised black key casts on the whites just past its tip.
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillRect(x - 1, keyboardTop + blackHeight, blackWidth + 2, 4);
      const sink = active.has(pitch) ? 2 : 0;
      this.setKeyPaint(frame, active, pitch, this.blackFace ?? "#0b0e15", 16);
      ctx.fillRect(x, keyboardTop + sink, blackWidth, blackHeight - sink);
      ctx.shadowBlur = 0;
      if (!frame.plain) {
        this.washForeshadow(
          pitch,
          active,
          x,
          keyboardTop,
          blackWidth,
          blackHeight,
        );
      }
    }

    ctx.fillStyle = "#161c26";
    ctx.fillRect(0, keyboardTop - 2, width, 2);

    if (frame.keyLabels !== null) {
      this.paintKeyLabels(
        frame.keyLabels,
        keyboardTop,
        keyboardHeight,
        whiteWidth,
      );
    }
  }

  /** A soft wash over one key an owed note is approaching, brightening as it
   * nears, so the next thing to press reads before it lands. Drawn on the key
   * within its own draw pass, so a white key's wash is covered by the black
   * keys over it and the layering holds. Hands off to the full press glow once
   * the note lands and the key goes active. */
  private washForeshadow(
    pitch: number,
    active: ReadonlyMap<number, NoteColor>,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    const entry = this.foreshadow.get(pitch);
    if (entry === undefined || active.has(pitch)) {
      return;
    }
    const ctx = this.context;
    ctx.save();
    ctx.globalAlpha = 0.1 + entry.strength * 0.28;
    ctx.fillStyle = entry.color.glow;
    ctx.fillRect(x, y, width, height);
    ctx.globalAlpha = 0.25 + entry.strength * 0.5;
    ctx.fillStyle = entry.color.core;
    ctx.fillRect(x, y, width, 3);
    ctx.restore();
  }

  /** The letter that plays each key, sat near the front of the key where a
   * hand is not covering it. Skipped once the keys are too narrow to read. */
  private paintKeyLabels(
    labels: ReadonlyMap<number, string>,
    keyboardTop: number,
    keyboardHeight: number,
    whiteWidth: number,
  ): void {
    if (whiteWidth < 15) {
      return;
    }
    const ctx = this.context;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = "700 11px ui-monospace, SFMono-Regular, monospace";
    for (const [pitch, label] of labels) {
      if (pitch < lowestPitch || pitch > highestPitch) {
        continue;
      }
      const black = isBlackKey(pitch);
      const centre = keyCenter(pitch, whiteWidth);
      const baseline = black
        ? keyboardTop + keyboardHeight * 0.6 - 7
        : keyboardTop + keyboardHeight - 8;
      // A held key covers its own letter and the song lights keys the whole
      // time, so each letter carries its own contrasting edge to stay readable.
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.strokeStyle = black ? "rgba(6,8,13,0.85)" : "rgba(233,238,246,0.9)";
      ctx.strokeText(label, centre, baseline);
      ctx.fillStyle = black ? "#e9eef6" : "#161c27";
      ctx.fillText(label, centre, baseline);
    }
  }

  /** A shadow cast up the roll, so the keys read as standing in front of the
   * falling notes rather than butting into them. */
  private paintKeyboardShadow(width: number, keyboardTop: number): void {
    const ctx = this.context;
    const depth = 18;
    if (this.shadow === null || this.shadowAt !== keyboardTop) {
      const shadow = ctx.createLinearGradient(
        0,
        keyboardTop - depth,
        0,
        keyboardTop,
      );
      shadow.addColorStop(0, "rgba(0,0,0,0)");
      shadow.addColorStop(1, "rgba(0,0,0,0.55)");
      this.shadow = shadow;
      this.shadowAt = keyboardTop;
    }
    ctx.fillStyle = this.shadow;
    ctx.fillRect(0, keyboardTop - depth, width, depth);
  }

  /** Fake depth without a 3D pass: the key faces are shaded top to bottom so a
   * white key rounds toward a darker front lip and a black key reads as raised.
   * Cached because the shading only changes when the keyboard band moves. */
  private ensureKeyFaces(keyboardTop: number, keyboardHeight: number): void {
    if (this.whiteFace !== null && this.facesAt === keyboardTop) {
      return;
    }
    const ctx = this.context;
    const white = ctx.createLinearGradient(
      0,
      keyboardTop,
      0,
      keyboardTop + keyboardHeight,
    );
    white.addColorStop(0, "#f5f7fb");
    white.addColorStop(0.08, "#e8ecf3");
    white.addColorStop(0.82, "#d2d8e3");
    white.addColorStop(1, "#b7c0cf");
    this.whiteFace = white;

    const black = ctx.createLinearGradient(
      0,
      keyboardTop,
      0,
      keyboardTop + keyboardHeight * 0.6,
    );
    black.addColorStop(0, "#39414d");
    black.addColorStop(0.14, "#161d27");
    black.addColorStop(0.85, "#090c12");
    black.addColorStop(1, "#05070b");
    this.blackFace = black;
    this.facesAt = keyboardTop;
  }

  /** A pressed key goes white so the player can tell their own hit from a note
   * the song is already playing, and blooms when the hit is one they owe. */
  private setKeyPaint(
    frame: Frame,
    active: ReadonlyMap<number, NoteColor>,
    pitch: number,
    restingFill: string | CanvasGradient,
    blur: number,
  ): void {
    const ctx = this.context;
    const color = active.get(pitch);
    if (color === undefined) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = restingFill;
      return;
    }
    if (frame.plain) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = frame.pressed.has(pitch) ? "#ffffff" : color.flat;
      return;
    }
    if (!frame.pressed.has(pitch)) {
      ctx.shadowColor = color.glow;
      ctx.shadowBlur = blur;
      ctx.fillStyle = color.core;
      return;
    }
    const right = frame.owed.has(pitch);
    ctx.shadowColor = right ? "#ffffff" : color.glow;
    ctx.shadowBlur = right ? blur * 2 : blur * 1.4;
    ctx.fillStyle = "#ffffff";
  }

  private paintParticles(): void {
    const ctx = this.context;
    ctx.globalCompositeOperation = "lighter";
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      if (particle === undefined) {
        continue;
      }
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += 0.16;
      particle.life -= 0.03;
      if (particle.life <= 0) {
        this.particles.splice(index, 1);
        continue;
      }
      ctx.globalAlpha = Math.max(0, particle.life);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(
        particle.x,
        particle.y,
        particle.radius * particle.life + 0.4,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const limit = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + limit, y);
  ctx.arcTo(x + width, y, x + width, y + height, limit);
  ctx.arcTo(x + width, y + height, x, y + height, limit);
  ctx.arcTo(x, y + height, x, y, limit);
  ctx.arcTo(x, y, x + width, y, limit);
  ctx.closePath();
}
