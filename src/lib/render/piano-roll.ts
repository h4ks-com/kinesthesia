import type { Reach } from "@/lib/input/keyboard-map";
import { type NoteColor, pitchColor, trackColor } from "@/lib/midi/palette";
import {
  highestPitch,
  isBlackKey,
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
};

export class PianoRollRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly particles: Particle[] = [];
  private previouslyActive = new Set<number>();
  private previouslyPressed = new Set<number>();
  private drumTracks: ReadonlySet<number> = new Set();
  private drumsFrom: Song | null = null;
  private shadow: CanvasGradient | null = null;
  private shadowAt = -1;
  private pan = 0;
  private keyWidth: number;

  constructor(canvas: HTMLCanvasElement, keyWidth: number = defaultKeyWidth) {
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("Canvas 2D context is unavailable");
    }
    this.canvas = canvas;
    this.context = context;
    this.keyWidth = clampKeyWidth(keyWidth);
  }

  get metrics(): KeyboardMetrics {
    return keyboardMetrics(this.canvas.clientWidth, this.keyWidth);
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
    const centre = (this.pan + this.canvas.clientWidth / 2) / previous.total;
    this.keyWidth = clampKeyWidth(value);
    const next = this.metrics;
    this.setPan(centre * next.total - this.canvas.clientWidth / 2);
  }

  /** Brings a pitch into view, since a narrow screen shows a window onto the
   * keyboard and the part being played is rarely the part it opens on. */
  centreOn(pitch: number): void {
    const { whiteWidth } = this.metrics;
    this.setPan(keyCenter(pitch, whiteWidth) - this.canvas.clientWidth / 2);
  }

  pitchAt(x: number, y: number): number | null {
    return pitchAtPoint(x, y, {
      width: this.canvas.clientWidth,
      height: this.canvas.clientHeight,
      keyWidth: this.keyWidth,
      pan: this.pan,
    });
  }

  resize(): void {
    const ratio = Math.min(window.devicePixelRatio, maxDevicePixelRatio);
    const pixelWidth = Math.round(this.canvas.clientWidth * ratio);
    const pixelHeight = Math.round(this.canvas.clientHeight * ratio);
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
    const ratio = Math.min(window.devicePixelRatio, maxDevicePixelRatio);
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
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
    this.paintBackground(total, height, keyboardTop, whiteWidth);

    const active = new Map<number, NoteColor>();
    this.paintNotes(frame, keyboardTop, whiteWidth, active);
    for (const pitch of frame.pressed) {
      active.set(pitch, active.get(pitch) ?? trackColor(0));
    }

    this.paintKeyboardShadow(total, keyboardTop);
    this.paintGlow(active, keyboardTop, whiteWidth);
    this.emitSparks(frame, active, keyboardTop, whiteWidth);
    this.paintKeyboard(
      frame,
      active,
      keyboardTop,
      keyboardHeight,
      whiteWidth,
      total,
    );
    this.paintParticles();
    this.paintReach(frame.reach, keyboardTop, whiteWidth, total);
    ctx.translate(this.pan, 0);
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
  ): void {
    const ctx = this.context;
    // Deepest at the strike line, so a bright note head has the most to sit
    // against exactly where it is being read.
    const background = ctx.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, "#0c1020");
    background.addColorStop(1, "#040509");
    ctx.fillStyle = background;
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
          ctx.fillStyle = color.glow;
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
      const gradient = ctx.createLinearGradient(0, y, 0, y + noteHeight);
      if (sounding) {
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
      ctx.fillStyle = gradient;
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
        active.get(pitch) ?? trackColor(0),
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

    for (const pitch of whiteKeys) {
      const x = whiteKeyLeft(pitch, whiteWidth);
      this.setKeyPaint(frame, active, pitch, "#dfe4ec", 20);
      ctx.fillRect(x + 0.5, keyboardTop, whiteWidth - 1, keyboardHeight);
    }

    ctx.shadowBlur = 0;
    for (let pitch = lowestPitch; pitch <= highestPitch; pitch += 1) {
      if (!isBlackKey(pitch)) {
        continue;
      }
      const blackWidth = blackKeyWidth(whiteWidth);
      const x = blackKeyLeft(pitch, whiteWidth);
      this.setKeyPaint(frame, active, pitch, "#0b0e15", 16);
      ctx.fillRect(x, keyboardTop, blackWidth, keyboardHeight * 0.6);
    }

    ctx.shadowBlur = 0;
    ctx.fillStyle = "#161c26";
    ctx.fillRect(0, keyboardTop - 2, width, 2);
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

  /** A pressed key goes white so the player can tell their own hit from a note
   * the song is already playing, and blooms when the hit is one they owe. */
  private setKeyPaint(
    frame: Frame,
    active: ReadonlyMap<number, NoteColor>,
    pitch: number,
    restingColor: string,
    blur: number,
  ): void {
    const ctx = this.context;
    const color = active.get(pitch);
    if (color === undefined) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = restingColor;
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
