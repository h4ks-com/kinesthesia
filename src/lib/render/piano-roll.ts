import { type NoteColor, pitchColor, trackColor } from "@/lib/midi/palette";
import {
  highestPitch,
  isBlackKey,
  lowestPitch,
  noteName,
  type Song,
} from "@/lib/midi/song";

const lookAhead = 3.5;
const maxDevicePixelRatio = 1.5;

const whiteKeys: number[] = [];
for (let pitch = lowestPitch; pitch <= highestPitch; pitch += 1) {
  if (!isBlackKey(pitch)) {
    whiteKeys.push(pitch);
  }
}
const whiteIndex = new Map<number, number>(
  whiteKeys.map((pitch, index) => [pitch, index]),
);

function keyCenter(pitch: number, whiteWidth: number): number {
  if (!isBlackKey(pitch)) {
    return ((whiteIndex.get(pitch) ?? 0) + 0.5) * whiteWidth;
  }
  return ((whiteIndex.get(pitch - 1) ?? 0) + 1) * whiteWidth;
}

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
};

export class PianoRollRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly particles: Particle[] = [];
  private previouslyActive = new Set<number>();

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("Canvas 2D context is unavailable");
    }
    this.canvas = canvas;
    this.context = context;
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

    const keyboardHeight = Math.min(120, height * 0.22);
    const keyboardTop = height - keyboardHeight;
    const whiteWidth = width / whiteKeys.length;

    this.paintBackground(width, height, keyboardTop, whiteWidth);

    const active = new Map<number, NoteColor>();
    this.paintNotes(frame, keyboardTop, whiteWidth, active);
    for (const pitch of frame.pressed) {
      active.set(pitch, active.get(pitch) ?? trackColor(0));
    }

    this.paintGlow(active, keyboardTop, whiteWidth);
    this.emitSparks(active, keyboardTop, whiteWidth);
    this.paintKeyboard(active, keyboardTop, keyboardHeight, whiteWidth, width);
    this.paintParticles();
  }

  private paintBackground(
    width: number,
    height: number,
    keyboardTop: number,
    whiteWidth: number,
  ): void {
    const ctx = this.context;
    const background = ctx.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, "#080a12");
    background.addColorStop(1, "#05060a");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    for (const pitch of whiteKeys) {
      if (pitch % 12 !== 0) {
        continue;
      }
      const x = (whiteIndex.get(pitch) ?? 0) * whiteWidth;
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

    for (const note of frame.song.notes) {
      if (note.start > position + lookAhead) {
        break;
      }
      if (note.end < position || frame.hiddenTracks.has(note.track)) {
        continue;
      }
      const color = trackColor(note.track);
      if (note.start <= position) {
        active.set(note.pitch, color);
      }

      const bottom = Math.min(
        keyboardTop,
        (keyboardTop * (position - note.start + lookAhead)) / lookAhead,
      );
      const top = (keyboardTop * (position - note.end + lookAhead)) / lookAhead;
      const noteWidth = isBlackKey(note.pitch)
        ? whiteWidth * 0.6
        : whiteWidth * 0.86;
      const x = keyCenter(note.pitch, whiteWidth) - noteWidth / 2;
      const y = Math.min(top, bottom);
      const noteHeight = Math.max(2, bottom - y);

      const gradient = ctx.createLinearGradient(0, y, 0, y + noteHeight);
      gradient.addColorStop(0, color.core);
      gradient.addColorStop(0.5, color.glow);
      gradient.addColorStop(1, color.glow);
      ctx.fillStyle = gradient;
      roundRect(ctx, x, y, noteWidth, noteHeight, 4);
      ctx.fill();

      if (position < note.start && noteWidth >= 17 && noteHeight >= 20) {
        const centerX = x + noteWidth / 2;
        const centerY = Math.min(y + noteHeight - 13, keyboardTop - 13);
        const label = noteName(note.pitch);
        ctx.beginPath();
        ctx.arc(centerX, centerY, 9, 0, Math.PI * 2);
        ctx.fillStyle = pitchColor(note.pitch);
        ctx.fill();
        ctx.font = `${label.length > 1 ? "700 9px" : "700 11px"} system-ui, sans-serif`;
        ctx.fillStyle = "rgba(8,10,16,0.92)";
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

  private emitSparks(
    active: ReadonlyMap<number, NoteColor>,
    keyboardTop: number,
    whiteWidth: number,
  ): void {
    for (const [pitch, color] of active) {
      if (this.previouslyActive.has(pitch)) {
        continue;
      }
      const centerX = keyCenter(pitch, whiteWidth);
      const count = 14 + Math.floor(Math.random() * 8);
      for (let index = 0; index < count; index += 1) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
        const speed = Math.random() * 4 + 1;
        this.particles.push({
          x: centerX + (Math.random() - 0.5) * 7,
          y: keyboardTop,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          radius: Math.random() * 2.2 + 0.7,
          color:
            Math.random() < 0.35
              ? "#ffffff"
              : Math.random() < 0.5
                ? color.core
                : color.glow,
        });
      }
    }
    this.previouslyActive = new Set(active.keys());
  }

  private paintKeyboard(
    active: ReadonlyMap<number, NoteColor>,
    keyboardTop: number,
    keyboardHeight: number,
    whiteWidth: number,
    width: number,
  ): void {
    const ctx = this.context;

    for (const pitch of whiteKeys) {
      const x = (whiteIndex.get(pitch) ?? 0) * whiteWidth;
      const color = active.get(pitch);
      if (color === undefined) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#dfe4ec";
      } else {
        ctx.shadowColor = color.glow;
        ctx.shadowBlur = 20;
        ctx.fillStyle = color.core;
      }
      ctx.fillRect(x + 0.5, keyboardTop, whiteWidth - 1, keyboardHeight);
    }

    ctx.shadowBlur = 0;
    for (let pitch = lowestPitch; pitch <= highestPitch; pitch += 1) {
      if (!isBlackKey(pitch)) {
        continue;
      }
      const blackWidth = whiteWidth * 0.6;
      const x = keyCenter(pitch, whiteWidth) - blackWidth / 2;
      const color = active.get(pitch);
      if (color === undefined) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#0b0e15";
      } else {
        ctx.shadowColor = color.glow;
        ctx.shadowBlur = 16;
        ctx.fillStyle = color.core;
      }
      ctx.fillRect(x, keyboardTop, blackWidth, keyboardHeight * 0.6);
    }

    ctx.shadowBlur = 0;
    ctx.fillStyle = "#161c26";
    ctx.fillRect(0, keyboardTop - 2, width, 2);
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
