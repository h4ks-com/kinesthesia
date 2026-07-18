import { describe, expect, it } from "vitest";
import { type MelodyOptions, reduceToMelody } from "@/lib/midi/melody";
import type { Song, SongNote, SongTrack } from "@/lib/midi/song";

/** Tunes everyone knows, so a reduction that wanders off the melody is obvious.
 * Pitches are the common piano keys for each, middle C being 60. */
const twinkle = [60, 60, 67, 67, 69, 69, 67] as const;
const odeToJoy = [
  64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62,
] as const;
const mario = [76, 76, 76, 72, 76, 79, 67] as const;
const jingleBells = [64, 64, 64, 64, 64, 64, 64, 67, 60, 62, 64] as const;

const beat = 0.5;
const chordOf: Record<string, readonly number[]> = {
  C: [48, 52, 55],
  F: [41, 45, 48],
  G: [43, 47, 50],
};

let nextId = 0;

function pitched(index: number): SongTrack {
  return {
    index,
    name: `track ${index}`,
    instrument: "acoustic grand piano",
    program: 0,
    percussion: false,
    noteCount: 0,
  };
}

/** Lays a melody over block chords, the shape of almost every simple piano
 * arrangement, so the reduction has accompaniment it has to see past. */
function arrangement(
  melody: readonly number[],
  chords: readonly string[],
  barsPerChord = 2,
): Song {
  const notes: SongNote[] = [];
  melody.forEach((pitch, step) => {
    nextId += 1;
    notes.push({
      id: nextId,
      pitch,
      start: step * beat,
      end: step * beat + beat * 0.9,
      velocity: 0.8,
      track: 0,
    });
  });
  chords.forEach((name, index) => {
    const start = index * beat * barsPerChord;
    for (const pitch of chordOf[name] ?? []) {
      nextId += 1;
      notes.push({
        id: nextId,
        pitch,
        start,
        end: start + beat * barsPerChord * 0.95,
        velocity: 0.6,
        track: 0,
      });
    }
  });
  return {
    name: "arrangement",
    duration: melody.length * beat,
    notes: notes.sort((left, right) => left.start - right.start),
    tracks: [pitched(0)],
  };
}

const full: MelodyOptions = { tracks: new Set([0]), maxNotesPerSecond: 12 };

describe("reduceToMelody on tunes with a known shape", () => {
  it("recovers Twinkle Twinkle over its chords", () => {
    const line = reduceToMelody(
      arrangement(twinkle, ["C", "C", "F", "C"]),
      full,
    );
    expect(line.map((each) => each.pitch)).toEqual([...twinkle]);
  });

  it("recovers Ode to Joy over its chords", () => {
    const line = reduceToMelody(
      arrangement(odeToJoy, ["C", "C", "C", "G", "C", "G", "G"]),
      full,
    );
    expect(line.map((each) => each.pitch)).toEqual([...odeToJoy]);
  });

  it("keeps the octave drop at the end of the Mario phrase", () => {
    const line = reduceToMelody(arrangement(mario, ["C", "C", "C", "C"]), full);
    expect(line.map((each) => each.pitch)).toEqual([...mario]);
  });

  it("keeps the dip below the repeated note in Jingle Bells", () => {
    const line = reduceToMelody(
      arrangement(jingleBells, ["C", "C", "C", "C", "C"]),
      full,
    );
    expect(line.map((each) => each.pitch)).toEqual([...jingleBells]);
  });

  /** An arpeggio sits close under a low melody, so register alone cannot part
   * the hands. Holding the line to the speed of the tune is what recovers it,
   * which is why the note speed is a control the player can reach. */
  it("follows an arpeggiated accompaniment once held to the speed of the tune", () => {
    const notes: SongNote[] = [];
    twinkle.forEach((pitch, step) => {
      nextId += 1;
      notes.push({
        id: nextId,
        pitch,
        start: step * beat,
        end: step * beat + beat * 0.9,
        velocity: 0.8,
        track: 0,
      });
      (chordOf.C ?? []).forEach((low, voice) => {
        nextId += 1;
        notes.push({
          id: nextId,
          pitch: low,
          start: step * beat + voice * (beat / 3),
          end: step * beat + voice * (beat / 3) + beat / 4,
          velocity: 0.5,
          track: 0,
        });
      });
    });
    const song: Song = {
      name: "arpeggiated",
      duration: twinkle.length * beat,
      notes: notes.sort((left, right) => left.start - right.start),
      tracks: [pitched(0)],
    };
    const atTuneSpeed: MelodyOptions = {
      tracks: new Set([0]),
      maxNotesPerSecond: 2,
    };
    expect(reduceToMelody(song, atTuneSpeed).map((each) => each.pitch)).toEqual(
      [...twinkle],
    );
  });
});
