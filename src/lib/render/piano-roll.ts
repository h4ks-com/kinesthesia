import type { Reach } from "@/lib/input/keyboard-map";
import type { ExpressionTrail } from "@/lib/midi/expression";
import { type NoteColor, pitchColor, trackColor } from "@/lib/midi/palette";
import {
  highestPitch,
  isBlackKey,
  type LiveNote,
  lowestPitch,
  noteName,
  type Song,
  type SongNote,
} from "@/lib/midi/song";
import { bentRows, momentAt, type TimeAtHeight } from "@/lib/render/bend-shape";
import { nextToPlay } from "@/lib/render/follow";
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
import { SparkField } from "@/lib/render/sparks";
import { lateWindow } from "@/lib/scoring/judge";
import type { NoteDirection, Strike, Traveller } from "@/lib/skins/types";

/** Seconds of song between the top of the roll and the keys. Anything drawn
 * behind the notes travels at this rate to move with them. */
export const lookAhead = 3.5;
/** Real seconds of warning before an owed note lands. Scaled by playback speed
 * so a fast song still gives the same time to react, and capped at the look
 * ahead so a long rest before the next note shows nothing until it nears. */
const foreshadowLead = 1.6;
const maxDevicePixelRatio = 1.5;
/** How long a struck drum keeps its key lit. The note-off a MIDI writes for a
 * drum is arbitrary and often runs for a beat, which would hold the key long
 * after the hit it stands for. */
const drumDecay = 0.09;
/** Below this a falling note is a sliver where a vertical gradient and rounded
 * corners cannot be seen, so it is filled flat and square. The bodies tall
 * enough to read a gradient keep it. */
const gradientNoteHeight = 14;
const roundNoteSize = 10;
/** Past this a playhead jump is a seek, and the notes passed over never
 * landed, so they spark nothing. */
const maxOnsetAdvance = 0.5;
/** How quickly the view travels to the note it should be sitting on, and how
 * long a finger's own panning wins. */
const followEase = 0.14;
const panHoldMs = 4000;
/** Shading that gives the keys a body. Flat fills, since every one of these is
 * laid for every key of every frame. */
const keybedFloor = "#0a0d14";
const keyEdgeLight = "rgba(255,255,255,0.5)";
const keyEdgeShade = "rgba(8,11,17,0.18)";
const blackKeyLip = "rgba(146,158,180,0.42)";
/** How far the near end of a pressed key drops toward the bed. */
const pressSink = 2;
/** What a note played as softly as possible keeps of its opacity. Never zero,
 * since a MIDI whose notes all carry one velocity must not read as a dim roll. */
const softestNote = 0.6;

function punchOf(velocity: number): number {
  return softestNote + velocity * (1 - softestNote);
}

export type Frame = {
  readonly song: Song;
  readonly position: number;
  /** Play mode's emitted notes, rising from the keys. Null in watch, learn and
   * match, where notes fall from the song instead. */
  readonly live: readonly LiveNote[] | null;
  /** The sustain pedal is down, marked discreetly along the strike line. */
  readonly sustain: boolean;
  /** Null outside play mode, where there is no live device to read. */
  readonly expression: ExpressionTrail | null;
  /** Which way the song's notes travel. Rising shoots them out of the keys as
   * they sound, which is a look rather than a way to read ahead. */
  readonly direction: NoteDirection;
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
  /** Pitches to bloom this frame without a local key press: the other side of a
   * match's judged hits, which arrive after the note's local onset and so
   * cannot ride the pressed channel. Empty everywhere but that side. */
  readonly hits: ReadonlySet<number>;
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
  /** Brings the note the player is next asked for into view, for a keyboard
   * wider than the screen. */
  readonly follow: boolean;
  /** Filled as the notes are drawn when a skin is behind the roll, so it can
   * answer to where they are without walking the song again. Null leaves the
   * roll opaque and costs nothing. */
  readonly report: SkinReport | null;
};

/** What the roll hands a skin. Written to during the note passes, so a skinned
 * frame costs one push per drawn note and nothing else. The geometry comes from
 * here too, so nothing has to measure the canvas a second time. */
export type SkinReport = {
  keyboardTop: number;
  travellers: Traveller[];
  strikes: Strike[];
};

function reportTraveller(
  report: SkinReport | null,
  pitch: number,
  velocity: number,
  top: number,
  whiteWidth: number,
  color: NoteColor,
): void {
  report?.travellers.push({
    x: keyCenter(pitch, whiteWidth),
    y: top,
    radius: whiteWidth * 0.5,
    color: color.glow,
    pitch,
    velocity,
  });
}

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
  private readonly sparks = new SparkField();
  /** The keys an owed note is approaching, with how near it is (0 far, 1 at the
   * line), so learn and match can foreshadow what to press. */
  private readonly foreshadow = new Map<
    number,
    { color: NoteColor; strength: number }
  >();
  private previouslyActive = new Set<number>();
  private previouslyPressed = new Set<number>();
  private previousHits = new Set<number>();
  /** Pitches whose note began since the last frame. A key the pedal is already
   * holding stays lit, so a note landing on it has no lighting change to spark
   * from and needs its own onset. */
  private readonly onsets = new Set<number>();
  private previousPosition: number | null = null;
  /** Null across a seek, so the notes skipped over spark nothing. */
  private onsetSince: number | null = null;
  private drumTracks: ReadonlySet<number> = new Set();
  private drumsFrom: Song | null = null;
  /** The longest note in the current song, so the scan can start at the first
   * note that could still be sounding. */
  private maxNoteDuration = 0;
  private shadow: CanvasGradient | null = null;
  private shadowAt = -1;
  private whiteFace: CanvasGradient | null = null;
  private blackFace: CanvasGradient | null = null;
  private whiteTilt: CanvasGradient | null = null;
  private facesAt = -1;
  private pan = 0;
  /** While a finger is panning, and for a while after, it decides where the
   * view sits rather than the song. */
  private panHeldUntil = 0;
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

  /** A finger has taken the view, so following stands off until they are done
   * looking. */
  holdPan(): void {
    this.panHeldUntil = performance.now() + panHoldMs;
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

  /** Eases the view toward the next note only once it has left the window:
   * re-centring a visible note drifts for no reason, which a split-screen half
   * feels on every hit. Only moves where the keyboard is wider than the screen. */
  private followNote(frame: Frame, whiteWidth: number, maxPan: number): void {
    if (!frame.follow || maxPan <= 0 || performance.now() < this.panHeldUntil) {
      return;
    }
    // What is still owed comes first: the song runs on past a note so it can be
    // played late, so the note being waited for may already have ended and the
    // song alone would point at the one after it. Walked rather than spread,
    // since this runs every frame.
    let owedLow: number | null = null;
    for (const owedPitch of frame.owed) {
      if (owedLow === null || owedPitch < owedLow) {
        owedLow = owedPitch;
      }
    }
    const pitch =
      owedLow ??
      nextToPlay(
        frame.song,
        frame.position,
        frame.hiddenTracks,
        frame.yours,
        firstFrom(frame.song.notes, frame.position - this.maxNoteDuration),
      );
    if (pitch === null) {
      return;
    }
    const target = keyCenter(pitch, whiteWidth);
    const margin = Math.min(whiteWidth, this.viewWidth / 3);
    if (
      target >= this.pan + margin &&
      target <= this.pan + this.viewWidth - margin
    ) {
      return;
    }
    const want =
      target < this.pan + margin
        ? target - margin
        : target - this.viewWidth + margin;
    this.pan += (Math.min(maxPan, Math.max(0, want)) - this.pan) * followEase;
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
    this.followNote(frame, whiteWidth, maxPan);

    if (frame.report === null) {
      ctx.fillStyle = "#060709";
      ctx.fillRect(0, 0, width, height);
    } else {
      ctx.clearRect(0, 0, width, height);
      frame.report.keyboardTop = keyboardTop;
    }
    ctx.translate(-this.pan, 0);
    if (frame.report === null) {
      this.paintBackground(total, height, keyboardTop, whiteWidth, frame.plain);
    }

    const active = new Map<number, NoteColor>();
    // Keys the pedal is holding after the hand has left. They stay pressed, and
    // dark: the colour belongs to the strike.
    const held = new Set<number>();
    this.foreshadow.clear();
    this.onsets.clear();
    const advance =
      this.previousPosition === null
        ? null
        : frame.position - this.previousPosition;
    this.onsetSince =
      advance !== null && advance > 0 && advance <= maxOnsetAdvance
        ? this.previousPosition
        : null;
    if (frame.live === null) {
      this.paintNotes(frame, keyboardTop, whiteWidth, active, held);
    } else {
      this.paintLiveNotes(
        frame,
        frame.live,
        keyboardTop,
        whiteWidth,
        active,
        held,
      );
    }
    this.previousPosition = frame.position;
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
      held,
      keyboardTop,
      keyboardHeight,
      whiteWidth,
      total,
    );
    this.sparks.paint(this.context);
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
    held: Set<number>,
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
      let longest = 0;
      for (const note of frame.song.notes) {
        longest = Math.max(longest, note.release - note.start);
      }
      this.maxNoteDuration = longest;
    }
    const drums = this.drumTracks;
    const blackNote = blackKeyWidth(whiteWidth);
    const whiteNote = whiteWidth * 0.86;

    // Notes are sorted by start, so every note still on screen starts within
    // [position - longest note - the late window, position + lookAhead]. The
    // late window is in there because a note stays owed for it after ending,
    // and a scan that had passed it would leave its key dark while the song
    // stood waiting for it.
    const notes = frame.song.notes;
    const horizon = position + lookAhead;
    const first = firstFrom(
      notes,
      position -
        this.maxNoteDuration -
        lateWindow -
        (frame.direction === "up" ? lookAhead : 0),
    );
    const since = this.onsetSince;
    const rising = frame.direction === "up";
    const riseScale = keyboardTop / lookAhead;
    const bendTime = momentAt(position, keyboardTop, riseScale, rising);
    for (let index = first; index < notes.length; index += 1) {
      const note = notes[index];
      if (note === undefined || note.start > horizon) {
        break;
      }
      if (frame.hiddenTracks.has(note.track)) {
        continue;
      }
      const ghost = frame.yours !== null && !frame.yours.has(note.id);
      const color = trackColor(note.track);
      const started = note.start <= position;
      // A key is lit by a note being played, not by one the pedal is holding
      // on after the hand has gone: the light stands for the strike.
      const sounding = started && position < note.end;
      const pedalled = started && !sounding && position < note.release;
      // Marked before any branch below returns, so a note whose whole length
      // falls inside one frame still counts as having landed.
      if (!ghost && started && since !== null && note.start > since) {
        this.onsets.add(note.pitch);
        frame.report?.strikes.push({
          x: keyCenter(note.pitch, whiteWidth),
          color: color.glow,
          pitch: note.pitch,
          velocity: note.velocity,
        });
      }
      // A rising note is only starting its climb when its end passes, so this
      // is the moment it leaves the keys rather than the moment it is spent.
      if (note.end < position && !rising) {
        // A note still owed once the song is past it is one being waited for,
        // and its key is the only thing telling the player what to press.
        if (!ghost && frame.owed.has(note.pitch)) {
          active.set(note.pitch, color);
        }
        // A drum key decays on its own, so the pedal has no say over it. The
        // key stays down while the pedal holds it, but unlit.
        if (!ghost && !drums.has(note.track) && pedalled) {
          held.add(note.pitch);
        }
        continue;
      }
      if (rising && !ghost && !drums.has(note.track) && pedalled) {
        held.add(note.pitch);
      }

      // A drum is an impulse: the mark falls to the line and is spent there,
      // and the key it lights decays on its own rather than on the note-off.
      if (drums.has(note.track)) {
        const struck = position - note.start;
        if (!ghost && struck >= 0 && struck < drumDecay) {
          active.set(note.pitch, color);
        }
        const strike = rising
          ? keyboardTop - struck * riseScale
          : (keyboardTop * (struck + lookAhead)) / lookAhead;
        if (rising ? struck >= 0 && strike >= 0 : strike <= keyboardTop) {
          const half =
            Math.min(isBlackKey(note.pitch) ? blackNote : whiteNote, 13) / 2;
          const centre = keyCenter(note.pitch, whiteWidth);
          ctx.globalAlpha = ghost ? 0.22 : punchOf(note.velocity);
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

      const bottom = rising
        ? keyboardTop - Math.max(0, position - note.end) * riseScale
        : Math.min(
            keyboardTop,
            (keyboardTop * (position - note.start + lookAhead)) / lookAhead,
          );
      const top = rising
        ? keyboardTop - Math.max(0, position - note.start) * riseScale
        : (keyboardTop * (position - note.end + lookAhead)) / lookAhead;
      if (rising && (bottom < 0 || note.start > position)) {
        continue;
      }
      const noteWidth = isBlackKey(note.pitch) ? blackNote : whiteNote;
      const x = keyCenter(note.pitch, whiteWidth) - noteWidth / 2;
      const y = Math.min(top, bottom);
      const noteHeight = Math.max(2, bottom - y);

      // Only a note climbing away from the keys travels through the scene; a
      // falling one is heading for the line and never reaches anything.
      if (rising && !ghost) {
        reportTraveller(
          frame.report,
          note.pitch,
          note.velocity,
          top,
          whiteWidth,
          color,
        );
      }

      // The hue holds across the body and only lifts in the last of the bar,
      // so the leading edge reads as lit without the note becoming a ramp. A
      // note being played drops the deep end and burns at its core instead.
      let fill: string | CanvasGradient;
      if (frame.plain) {
        fill = sounding ? color.glow : color.flat;
      } else if (noteHeight >= gradientNoteHeight) {
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
        fill = gradient;
      } else {
        fill = sounding ? color.core : color.glow;
      }
      ctx.globalAlpha = ghost ? 0.22 : punchOf(note.velocity);
      ctx.fillStyle = fill;
      // A falling note climbs into the future, so a height above the line is a
      // moment still to come and the file already knows the wheels there.
      const written = frame.song.expression;
      const bent =
        written.touched(note.track) &&
        written.moves(note.track, note.start, note.release) &&
        this.traceBentNote(
          written,
          note.track,
          bendTime,
          { x, y, width: noteWidth, height: noteHeight },
          whiteWidth,
        );
      if (bent) {
        ctx.fill();
      } else if (noteHeight >= roundNoteSize && noteWidth >= roundNoteSize) {
        roundRect(ctx, x, y, noteWidth, noteHeight, 4);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, noteWidth, noteHeight);
      }
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
   * then lifting off once released. A note being played lights its key, so the
   * glow, sparks and sink read the same as playing along in any other mode. */
  private paintLiveNotes(
    frame: Frame,
    live: readonly LiveNote[],
    keyboardTop: number,
    whiteWidth: number,
    active: Map<number, NoteColor>,
    held: Set<number>,
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
      const down = note.end === null;
      const footAge = note.end === null ? 0 : position - note.end;
      const bottom = keyboardTop - footAge * scale;
      const color = trackColor(note.track);
      // Claimed before the geometry cull, so a note whose bar has climbed off
      // the roll still owns its key. Down is lit; only pedalled is merely held.
      if (down) {
        active.set(note.pitch, color);
      } else if (note.release === null) {
        held.add(note.pitch);
      }
      if (bottom < 0) {
        continue;
      }
      const since = this.onsetSince;
      if (since !== null && note.start > since) {
        this.onsets.add(note.pitch);
        frame.report?.strikes.push({
          x: keyCenter(note.pitch, whiteWidth),
          color: color.glow,
          pitch: note.pitch,
          velocity: note.velocity,
        });
      }

      const top = keyboardTop - headAge * scale;
      reportTraveller(
        frame.report,
        note.pitch,
        note.velocity,
        top,
        whiteWidth,
        color,
      );
      const noteWidth = isBlackKey(note.pitch) ? blackNote : whiteNote;
      const x = keyCenter(note.pitch, whiteWidth) - noteWidth / 2;
      const y = Math.max(0, top);
      const noteHeight = Math.max(2, bottom - y);

      // Brightest at the leading edge climbing away from the keys, deepening
      // toward the foot once the note has been let go.
      let fill: string | CanvasGradient;
      if (frame.plain) {
        fill = color.flat;
      } else if (noteHeight >= gradientNoteHeight) {
        const gradient = ctx.createLinearGradient(0, y, 0, y + noteHeight);
        gradient.addColorStop(0, color.core);
        gradient.addColorStop(down ? 0.6 : 0.25, color.glow);
        gradient.addColorStop(1, down ? color.glow : color.shade);
        fill = gradient;
      } else {
        fill = color.glow;
      }
      ctx.globalAlpha = punchOf(note.velocity);
      ctx.fillStyle = fill;
      const trail = frame.expression;
      const bent =
        trail?.touched(note.track) === true &&
        this.traceBentNote(
          trail,
          note.track,
          momentAt(position, keyboardTop, scale, true),
          { x, y, width: noteWidth, height: noteHeight },
          whiteWidth,
        );
      if (bent) {
        ctx.fill();
      } else if (noteHeight >= roundNoteSize && noteWidth >= roundNoteSize) {
        roundRect(ctx, x, y, noteWidth, noteHeight, 4);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, noteWidth, noteHeight);
      }
      ctx.globalAlpha = 1;
    }
  }

  /** Lays the note along what the wheels were doing under it, and says whether
   * it did: a bar the wheels sat still through keeps its plain corners. */
  private traceBentNote(
    trail: ExpressionTrail,
    track: number,
    timeAt: TimeAtHeight,
    box: { x: number; y: number; width: number; height: number },
    whiteWidth: number,
  ): boolean {
    const rows = bentRows(
      trail,
      track,
      timeAt,
      { top: box.y, height: box.height },
      whiteWidth,
    );
    if (rows === null) {
      return false;
    }
    const ctx = this.context;
    const centre = box.x + box.width / 2;
    ctx.beginPath();
    for (const row of rows) {
      ctx.lineTo(centre + row.offset - box.width / 2, row.y);
    }
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row !== undefined) {
        ctx.lineTo(centre + row.offset + box.width / 2, row.y);
      }
    }
    ctx.closePath();
    return true;
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
      this.sparks.spawn(
        keyCenter(pitch, whiteWidth),
        keyboardTop,
        active.get(pitch) ?? trackColor(frame.playTrack),
        frame.owed.has(pitch) ? "bloom" : "strike",
      );
    }
    for (const [pitch, color] of active) {
      const fresh = !this.previouslyActive.has(pitch) || this.onsets.has(pitch);
      if (!fresh || sparked.has(pitch)) {
        continue;
      }
      this.sparks.spawn(
        keyCenter(pitch, whiteWidth),
        keyboardTop,
        color,
        "note",
      );
    }
    for (const pitch of frame.hits) {
      if (this.previousHits.has(pitch) || sparked.has(pitch)) {
        continue;
      }
      sparked.add(pitch);
      this.sparks.spawn(
        keyCenter(pitch, whiteWidth),
        keyboardTop,
        active.get(pitch) ?? trackColor(frame.playTrack),
        "bloom",
      );
    }
    this.previousHits = new Set(frame.hits);
    this.previouslyActive = new Set(active.keys());
    this.previouslyPressed = new Set(frame.pressed);
  }

  private paintKeyboard(
    frame: Frame,
    active: ReadonlyMap<number, NoteColor>,
    held: ReadonlySet<number>,
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
      // A key hinges at its far end, which is the top of the screen, so a
      // pressed one dips at the near end and comes up short of where it stood.
      const sink = active.has(pitch) || held.has(pitch) ? pressSink : 0;
      this.setKeyPaint(frame, active, pitch, this.whiteFace ?? "#dfe4ec", 20);
      ctx.fillRect(x + 0.5, keyboardTop, whiteWidth - 1, keyboardHeight - sink);
      ctx.shadowBlur = 0;
      // The bed the near end drops toward, at the front where it went down.
      if (sink > 0) {
        if (this.whiteTilt !== null) {
          ctx.fillStyle = this.whiteTilt;
          ctx.fillRect(
            x + 0.5,
            keyboardTop,
            whiteWidth - 1,
            keyboardHeight - sink,
          );
        }
        ctx.fillStyle = keybedFloor;
        ctx.fillRect(
          x + 0.5,
          keyboardTop + keyboardHeight - sink,
          whiteWidth - 1,
          sink,
        );
      }
      ctx.fillStyle = keyEdgeLight;
      ctx.fillRect(x + 0.5, keyboardTop, 1, keyboardHeight - sink);
      ctx.fillStyle = keyEdgeShade;
      ctx.fillRect(x + whiteWidth - 1.5, keyboardTop, 1, keyboardHeight - sink);
      // Washed before the black keys are laid over it, so the wash never spills
      // onto a black key sitting on top and the layering reads true.
      if (!frame.plain) {
        this.washForeshadow(
          pitch,
          active,
          x + 0.5,
          keyboardTop,
          whiteWidth - 1,
          keyboardHeight - sink,
        );
      }
    }

    for (let pitch = lowestPitch; pitch <= highestPitch; pitch += 1) {
      if (!isBlackKey(pitch)) {
        continue;
      }
      const blackWidth = blackKeyWidth(whiteWidth);
      const x = blackKeyLeft(pitch, whiteWidth);
      const sink = active.has(pitch) || held.has(pitch) ? pressSink : 0;
      // The shadow a black key casts on the whites just past its tip. A key
      // that has gone down sits nearer the bed, and its shadow shrinking is
      // most of what reads as pressed.
      ctx.fillStyle = sink > 0 ? "rgba(0,0,0,0.12)" : "rgba(0,0,0,0.28)";
      ctx.fillRect(
        x - 1,
        keyboardTop + blackHeight - sink,
        blackWidth + 2,
        sink > 0 ? 1 : 4,
      );
      this.setKeyPaint(frame, active, pitch, this.blackFace ?? "#0b0e15", 16);
      const blackFill = ctx.fillStyle;
      ctx.fillRect(x, keyboardTop, blackWidth, blackHeight - sink);
      ctx.shadowBlur = 0;
      if (sink > 0) {
        // The front of the key, turned down and away. Painted from the key's
        // own face rather than left as bare bed, or a lit key ends in a black
        // tab that reads as a hole punched out of it.
        ctx.fillStyle = keybedFloor;
        ctx.fillRect(x, keyboardTop + blackHeight - sink, blackWidth, sink);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = blackFill;
        ctx.fillRect(x, keyboardTop + blackHeight - sink, blackWidth, sink);
        ctx.globalAlpha = 1;
      } else {
        // The front face of a key standing proud, where it turns toward the
        // player.
        ctx.fillStyle = blackKeyLip;
        ctx.fillRect(x, keyboardTop + blackHeight - 2, blackWidth, 2);
        ctx.fillStyle = keyEdgeLight;
        ctx.fillRect(x, keyboardTop, 1, blackHeight - 2);
      }
      if (!frame.plain) {
        this.washForeshadow(
          pitch,
          active,
          x,
          keyboardTop,
          blackWidth,
          blackHeight - sink,
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

    // A key hinges at its far end, so pressing turns its face up into the
    // light and a specular band gathers against the hinge. It only ever adds
    // light: a pressed key is usually a key carrying a note, and shading its
    // face would spend the bloom to say what the gap at the near end already
    // says. Depth is the bright hinge against the dark bed, not a shadow.
    const tilt = ctx.createLinearGradient(
      0,
      keyboardTop,
      0,
      keyboardTop + keyboardHeight,
    );
    tilt.addColorStop(0, "rgba(255,255,255,0.5)");
    tilt.addColorStop(0.09, "rgba(255,255,255,0.16)");
    tilt.addColorStop(0.34, "rgba(255,255,255,0)");
    this.whiteTilt = tilt;

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
}

/** First index whose note starts at or after `from`. The list is sorted by
 * start. */
function firstFrom(notes: readonly SongNote[], from: number): number {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((notes[mid]?.start ?? 0) < from) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
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
