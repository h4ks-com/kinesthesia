import { z } from "@hono/zod-openapi";
import { midiSourceIds } from "@/server/midi/registry";

export const searchInputShape = {
  q: z.string().min(1).describe("Song or file name to look for"),
  source: z
    .enum(midiSourceIds)
    .optional()
    .describe("Restrict the search to a single source"),
  limit: z.coerce.number().int().min(1).max(50).default(10),
};

export const infoInputShape = {
  source: z.enum(midiSourceIds).describe("Provider the id came from"),
  id: z.string().min(1).describe("The file's id within that source"),
  name: z.string().default("").describe("Name to report it under"),
};

const digestTrackSchema = z.object({
  index: z
    .number()
    .int()
    .describe("Track number, for the tracks player option"),
  name: z.string(),
  instrument: z.string(),
  percussion: z.boolean().describe("A drum kit, which is never transposed"),
  notes: z.number().int(),
  range: z
    .tuple([z.string(), z.string()])
    .describe("Lowest and highest note names on this track"),
  bothHands: z
    .boolean()
    .describe(
      "Whether this track holds both hands, so the hand player option splits it into two real parts",
    ),
});

const tempoSchema = z.object({
  bpm: z.number(),
  explicit: z.boolean().describe("False where the file names no tempo"),
  changes: z.number().int(),
});

const meterSchema = z.object({
  beats: z.number().int(),
  value: z.number().int(),
  explicit: z
    .boolean()
    .describe("False where the file names no time signature"),
  changes: z.number().int(),
});

const keyEstimateSchema = z.object({
  tonic: z.string(),
  mode: z.enum(["major", "minor"]),
  correlation: z
    .number()
    .describe("How well the notes fit this key, 0 to 1. Low means chromatic"),
  margin: z.number().describe("Lead over the runner-up key"),
  runnerUp: z.string(),
});

const harmonySpanSchema = z.object({
  bars: z.string().describe("A single bar, or a range like 5-8"),
  chord: z.string(),
});

/** The whole file boiled down to what a caller needs to reason about it: what
 * the song info panel shows, midi_info reports and GET /api/midi/info returns,
 * so the three read from the same shape. */
export const digestSchema = z
  .object({
    name: z.string(),
    durationSeconds: z.number(),
    totalNotes: z.number().int(),
    tempo: tempoSchema,
    meter: meterSchema,
    key: keyEstimateSchema
      .nullable()
      .describe("Null where the music is too chromatic to name a key for"),
    tracks: z.array(digestTrackSchema),
    playedTrack: z
      .number()
      .int()
      .nullable()
      .describe("The track the player claims unless told otherwise"),
    lowestPitch: z
      .number()
      .int()
      .describe("MIDI note number, 21 is the lowest key"),
    highestPitch: z
      .number()
      .int()
      .describe("MIDI note number, 108 is the highest key"),
    density: z
      .number()
      .describe(
        "Notes per second across the file, as a sense of how busy it is",
      ),
    harmony: z.array(harmonySpanSchema),
  })
  .openapi("SongReport");
