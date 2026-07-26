import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import type { Context } from "hono";
import { readMidi } from "@/lib/midi/analysis";
import { isPlayableUrl } from "@/lib/player-url";
import { currentViewer } from "@/server/auth";
import { config } from "@/server/config";
import type { Score } from "@/server/db/schema";
import { sourceFetch } from "@/server/http/fetch";
import { mcpHandler } from "@/server/mcp";
import { analyseMidi } from "@/server/midi/analyse";
import { infoInputShape, searchInputShape } from "@/server/midi/inputs";
import {
  midiSourceIds,
  midiSources,
  sourceFileUrl,
} from "@/server/midi/registry";
import { searchMidi } from "@/server/midi/search";
import {
  closeRoom,
  createRoom,
  findRoom,
  type MultiplayerRoom,
} from "@/server/multiplayer/rooms";
import { saveScore, statsFor, topScores } from "@/server/scores/store";
import { bucketEnabled, uploadMidi } from "@/server/storage/bucket";
import {
  deleteVoicing,
  saveVoicing,
  voicingsFor,
} from "@/server/voicings/store";

const midiSearchItemSchema = z
  .object({
    id: z.string(),
    source: z.enum(midiSourceIds),
    name: z.string(),
    plays: z.number(),
    downloadUrl: z.string().describe("Direct link to the .mid file"),
    sourceUrl: z.string().describe("Page this file came from"),
    playUrl: z.string().describe("Link that plays the file back in a browser"),
    learnUrl: z
      .string()
      .describe("Link that waits for the player to hit each note"),
    multiplayerUrl: z
      .string()
      .describe("Link that opens this song for two players together"),
  })
  .openapi("MidiSearchItem");

const searchResponseSchema = z
  .object({ results: z.array(midiSearchItemSchema) })
  .openapi("MidiSearchResponse");

const sourcesResponseSchema = z
  .object({
    sources: z.array(
      z.object({
        id: z.enum(midiSourceIds),
        label: z.string(),
        blurb: z.string(),
        homeUrl: z.string(),
        license: z.string(),
      }),
    ),
  })
  .openapi("SourcesResponse");

const searchRoute = createRoute({
  method: "get",
  path: "/midi/search",
  summary: "Search MIDI files",
  description:
    "Searches every configured source and returns the direct download link plus a player link for each match.",
  request: { query: z.object(searchInputShape) },
  responses: {
    200: {
      description: "Matching MIDI files, most played first",
      content: { "application/json": { schema: searchResponseSchema } },
    },
  },
});

const trackSummarySchema = z.object({
  index: z
    .number()
    .int()
    .describe("Track number, for the tracks player option"),
  name: z.string(),
  instrument: z.string(),
  percussion: z.boolean().describe("A drum kit, which is never transposed"),
  notes: z.number().int(),
});

const midiSummarySchema = z.object({
  name: z.string(),
  duration: z.number().describe("How long the song runs, in seconds"),
  notes: z.number().int().describe("Notes in the whole file"),
  tracks: z.array(trackSummarySchema),
  playedTrack: z
    .number()
    .int()
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
    .describe("Notes per second across the file, as a sense of how busy it is"),
});

const infoRoute = createRoute({
  method: "get",
  path: "/midi/info",
  summary: "Read a MIDI file",
  description:
    "Reads a source's file and reports how long it runs, how many notes it holds and what is on each track. Take the source and id from a search result.",
  request: { query: z.object(infoInputShape) },
  responses: {
    200: {
      description: "What the file holds",
      content: { "application/json": { schema: midiSummarySchema } },
    },
    502: {
      description: "The file could not be downloaded or read",
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
    },
  },
});

const sourcesRoute = createRoute({
  method: "get",
  path: "/midi/sources",
  summary: "List MIDI sources",
  responses: {
    200: {
      description: "Sources available to search",
      content: { "application/json": { schema: sourcesResponseSchema } },
    },
  },
});

export const api = new OpenAPIHono().basePath("/api");

api.openapi(searchRoute, async (c) => {
  const { q, source, limit } = c.req.valid("query");
  const results = await searchMidi({ query: q, source: source ?? null, limit });
  return c.json({ results }, 200);
});

api.openapi(infoRoute, async (c) => {
  const { source, id, name } = c.req.valid("query");
  const fileUrl = sourceFileUrl(source, id);
  if (fileUrl === null) {
    return c.json({ error: "Unknown source or id" }, 502);
  }
  try {
    const summary = await analyseMidi(fileUrl, name);
    return c.json({ ...summary, tracks: [...summary.tracks] }, 200);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Unreadable MIDI" },
      502,
    );
  }
});

api.openapi(sourcesRoute, (c) =>
  c.json(
    {
      sources: midiSources.map(({ id, label, blurb, homeUrl, license }) => ({
        id,
        label,
        blurb,
        homeUrl,
        license,
      })),
    },
    200,
  ),
);

/** Streams a source's file through our own origin, so a provider that sends no
 * cross origin headers still plays in a browser. Binary, so it is a plain route
 * rather than a documented JSON one. */
api.get("/midi/file", async (c) => {
  const fileUrl = sourceFileUrl(
    c.req.query("source") ?? "",
    c.req.query("id") ?? "",
  );
  if (fileUrl === null) {
    return c.json({ error: "Unknown source or id" }, 400);
  }
  try {
    const upstream = await sourceFetch(fileUrl);
    if (!upstream.ok) {
      return c.json({ error: "The file could not be fetched" }, 502);
    }
    return c.body(await upstream.arrayBuffer(), 200, {
      "content-type": "audio/midi",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=86400",
    });
  } catch {
    return c.json({ error: "The file could not be fetched" }, 502);
  }
});

/** Short links for generated files and projects. A browser opening one lands on
 * the player; a fetch of one (what the player does when an agent has wrapped the
 * link back into ?url=) gets the raw .mid. So the link resolves whether it is
 * opened or wrapped, and an agent pasting it into chat cannot break it. */
function shortLink(c: Context, midiUrl: string): Response {
  const dest = c.req.header("sec-fetch-dest");
  const navigation =
    dest === "document" ||
    (dest === undefined &&
      (c.req.header("accept") ?? "").includes("text/html"));
  if (navigation) {
    return c.redirect(
      `${config.appBaseUrl}/watch?url=${encodeURIComponent(midiUrl)}`,
      302,
    );
  }
  return c.redirect(midiUrl, 302);
}

api.get("/g/:uuid", (c) => {
  const uuid = c.req.param("uuid");
  const bucket = config.bucket;
  if (bucket === null || !/^[0-9a-f-]{36}$/.test(uuid)) {
    return c.json({ error: "Unknown file" }, 404);
  }
  return shortLink(c, `${bucket.publicBase}/gen/${uuid}.mid`);
});

api.get("/p/:id", (c) => {
  const id = c.req.param("id");
  const bucket = config.bucket;
  if (bucket === null || !/^pj_[0-9a-f-]{36}$/.test(id)) {
    return c.json({ error: "Unknown project" }, 404);
  }
  return shortLink(c, `${bucket.publicBase}/docs/${id}.mid`);
});

const roomSchema = z
  .object({
    code: z.string(),
    peerId: z.string(),
    url: z.string(),
    name: z.string(),
    source: z.string().nullable(),
    tracks: z.array(z.number().int()),
    speed: z.number(),
    simplified: z.boolean(),
    melodyRate: z.number().int(),
    transpose: z.number().int(),
    coop: z.boolean(),
  })
  .openapi("MultiplayerRoom");

const createRoomRoute = createRoute({
  method: "post",
  path: "/multiplayer/rooms",
  summary: "Open a multiplayer room",
  description:
    "Registers the host peer so a second player can find it by code. Gameplay then runs peer to peer.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            peerId: z.string().min(1),
            url: z.string().url(),
            name: z.string(),
            source: z.string().nullable().default(null),
            tracks: z.array(z.number().int()).default([]),
            speed: z.number().positive().max(4).default(1),
            simplified: z.boolean().default(false),
            melodyRate: z.number().int().min(1).max(12).default(8),
            transpose: z.number().int().min(-12).max(12).default(0),
            coop: z.boolean().default(false),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The room that was opened",
      content: { "application/json": { schema: roomSchema } },
    },
    400: {
      description: "The song url is not from an allowed origin",
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
    },
  },
});

const joinRoomRoute = createRoute({
  method: "get",
  path: "/multiplayer/rooms/{code}",
  summary: "Look up a multiplayer room",
  request: { params: z.object({ code: z.string().length(5) }) },
  responses: {
    200: {
      description: "The room behind that code",
      content: { "application/json": { schema: roomSchema } },
    },
    404: {
      description: "No such room",
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
    },
  },
});

const closeRoomRoute = createRoute({
  method: "delete",
  path: "/multiplayer/rooms/{code}",
  summary: "Close a multiplayer room",
  description:
    "The host closes the room once a player has joined, so the invite cannot pull anyone else in.",
  request: { params: z.object({ code: z.string().length(5) }) },
  responses: {
    204: { description: "The room is closed" },
  },
});

function roomResponse(room: MultiplayerRoom) {
  return { ...room, tracks: [...room.tracks] };
}

api.openapi(createRoomRoute, (c) => {
  const room = c.req.valid("json");
  // A joiner loads this url straight from the room, so it is held to the same
  // allowlist as a url typed into the address bar.
  if (!isPlayableUrl(room.url, config.trustedMidiOrigins)) {
    return c.json({ error: "The song url is not from an allowed origin" }, 400);
  }
  return c.json(roomResponse(createRoom(room)), 200);
});

api.openapi(joinRoomRoute, (c) => {
  const room = findRoom(c.req.valid("param").code);
  if (room === null) {
    return c.json({ error: "That room is not open" }, 404);
  }
  return c.json(roomResponse(room), 200);
});

api.openapi(closeRoomRoute, (c) => {
  closeRoom(c.req.valid("param").code);
  return c.body(null, 204);
});

const scoreSchema = z
  .object({
    id: z.number(),
    player: z.string(),
    song: z.string(),
    url: z.string(),
    mode: z.string(),
    points: z.number(),
    accuracy: z.number(),
    bestCombo: z.number(),
    playedAt: z.number(),
  })
  .openapi("Score");

/** The account id stays server side; a leaderboard only needs the display name. */
function publicScore(row: Score) {
  return {
    id: row.id,
    player: row.playerName,
    song: row.song,
    url: row.url,
    mode: row.mode,
    points: row.points,
    accuracy: row.accuracy,
    bestCombo: row.bestCombo,
    playedAt: row.playedAt,
  };
}

const leaderboardRoute = createRoute({
  method: "get",
  path: "/scores",
  summary: "Top scores",
  description: "Public leaderboard of scores from authenticated users.",
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  },
  responses: {
    200: {
      description: "Highest scoring runs",
      content: {
        "application/json": {
          schema: z.object({ scores: z.array(scoreSchema) }),
        },
      },
    },
  },
});

const submitScoreRoute = createRoute({
  method: "post",
  path: "/scores",
  summary: "Record a score",
  description:
    "Stores a finished run against the authenticated user. Requires Logto to be configured and an authenticated session.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            song: z.string().min(1),
            url: z.string().url(),
            mode: z.enum(["learn", "battle", "coop"]),
            points: z.number().int().min(0),
            accuracy: z.number().min(0).max(1),
            bestCombo: z.number().int().min(0),
            speed: z.number().positive().max(4).default(1),
            simplified: z.boolean().default(false),
            melodyRate: z
              .number()
              .int()
              .min(1)
              .max(12)
              .nullable()
              .default(null),
            outcome: z.enum(["win", "loss", "draw"]).nullable().default(null),
            opponentPoints: z.number().int().min(0).nullable().default(null),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The score that was stored",
      content: { "application/json": { schema: scoreSchema } },
    },
    401: {
      description: "Nobody is signed in, or sign in is not configured",
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
    },
  },
});

const statsRoute = createRoute({
  method: "get",
  path: "/scores/me",
  summary: "Your totals",
  description: "Aggregate stats for the authenticated user.",
  responses: {
    200: {
      description: "Totals across every run you recorded",
      content: {
        "application/json": {
          schema: z
            .object({
              player: z.string(),
              runs: z.number(),
              points: z.number(),
              bestCombo: z.number(),
              accuracy: z.number(),
            })
            .openapi("PlayerStats"),
        },
      },
    },
    401: {
      description: "Nobody is signed in",
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
    },
  },
});

api.openapi(statsRoute, async (c) => {
  const viewer = await currentViewer();
  if (viewer === null) {
    return c.json({ error: "Sign in to see your totals" }, 401);
  }
  const stats = await statsFor(viewer.id);
  return c.json({ player: viewer.name, ...stats }, 200);
});

api.openapi(leaderboardRoute, async (c) => {
  const rows = await topScores(c.req.valid("query").limit);
  return c.json({ scores: rows.map(publicScore) }, 200);
});

api.openapi(submitScoreRoute, async (c) => {
  const viewer = await currentViewer();
  if (viewer === null) {
    return c.json({ error: "Sign in to record a score" }, 401);
  }
  const stored = await saveScore({
    ...c.req.valid("json"),
    playerId: viewer.id,
    playerName: viewer.name,
  });
  return c.json(publicScore(stored), 200);
});

const voicingShape = z.object({
  program: z
    .number()
    .int()
    .min(0)
    .max(127)
    .describe("General MIDI program number for the track's instrument"),
  attack: z
    .number()
    .int()
    .min(0)
    .max(1000)
    .describe("Amplitude envelope attack, milliseconds"),
  release: z
    .number()
    .int()
    .min(0)
    .max(4000)
    .describe("Amplitude envelope release, milliseconds"),
  brightness: z
    .number()
    .int()
    .min(200)
    .max(20000)
    .describe("Low-pass filter cutoff, hertz"),
  volume: z.number().int().min(0).max(150).describe("Track gain, percent"),
});

const songVoicingShape = z.record(z.string(), voicingShape);

const savedVoicingSchema = z.object({
  authorId: z.string(),
  authorName: z.string(),
  tracks: songVoicingShape,
  updatedAt: z.number(),
});

const songQuery = {
  url: z.string().url().describe("The .mid the voicing belongs to"),
  source: z.string().default("").describe("Provider, empty for a bare URL"),
};

const listVoicingsRoute = createRoute({
  method: "get",
  path: "/voicings",
  summary: "List song voicings",
  description:
    "Per-track voicings saved for a song, newest first, one per author. A voicing sets each track's instrument, envelope, filter and gain.",
  request: { query: z.object(songQuery) },
  responses: {
    200: {
      description: "Saved voicings for the song",
      content: {
        "application/json": {
          schema: z.object({ voicings: z.array(savedVoicingSchema) }),
        },
      },
    },
  },
});

const saveVoicingRoute = createRoute({
  method: "put",
  path: "/voicings",
  summary: "Save a song voicing",
  description:
    "Stores the authenticated user's per-track voicing for a song, replacing their previous one.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ ...songQuery, tracks: songVoicingShape }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The voicing that was stored",
      content: { "application/json": { schema: savedVoicingSchema } },
    },
    401: {
      description: "Nobody is signed in, or sign in is not configured",
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
    },
  },
});

const deleteVoicingRoute = createRoute({
  method: "delete",
  path: "/voicings",
  summary: "Delete a song voicing",
  description:
    "Removes the authenticated user's voicing for a song, reverting to the file's own instruments.",
  request: { query: z.object(songQuery) },
  responses: {
    200: {
      description: "The voicing is gone",
      content: {
        "application/json": { schema: z.object({ deleted: z.boolean() }) },
      },
    },
    401: {
      description: "Nobody is signed in, or sign in is not configured",
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
    },
  },
});

/** A stored row is only ever written through the schema above, but it outlives
 * the code that wrote it, so it is read back through the same schema. */
function readTracks(raw: string): z.infer<typeof songVoicingShape> {
  try {
    const parsed = songVoicingShape.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {};
    }
    throw error;
  }
}

api.openapi(listVoicingsRoute, async (c) => {
  const song = c.req.valid("query");
  const saved = await voicingsFor(song);
  return c.json(
    {
      voicings: saved.map((entry) => ({
        ...entry,
        tracks: readTracks(entry.tracks),
      })),
    },
    200,
  );
});

api.openapi(saveVoicingRoute, async (c) => {
  const viewer = await currentViewer();
  if (viewer === null) {
    return c.json({ error: "Sign in to save how a song sounds" }, 401);
  }
  const { tracks, ...song } = c.req.valid("json");
  const saved = await saveVoicing({
    authorId: viewer.id,
    authorName: viewer.name,
    song,
    tracks: JSON.stringify(tracks),
  });
  return c.json({ ...saved, tracks: readTracks(saved.tracks) }, 200);
});

api.openapi(deleteVoicingRoute, async (c) => {
  const viewer = await currentViewer();
  if (viewer === null) {
    return c.json({ error: "Sign in to change how a song sounds" }, 401);
  }
  await deleteVoicing(viewer.id, c.req.valid("query"));
  return c.json({ deleted: true }, 200);
});

const shareUploadRoute = createRoute({
  method: "post",
  path: "/uploads",
  summary: "Publish an uploaded MIDI",
  description:
    "Copies a signed-in player's own MIDI to the public object store and returns the url that serves it. The copy is permanent: the link is meant to keep resolving for anyone it is given to.",
  request: {
    body: { content: { "audio/midi": { schema: z.any() } } },
  },
  responses: {
    200: {
      description: "Where the file now lives",
      content: {
        "application/json": { schema: z.object({ url: z.string() }) },
      },
    },
    401: {
      description: "Not signed in",
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
    },
    413: {
      description: "Larger than the server accepts",
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
    },
    503: {
      description: "No object store is configured",
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
    },
  },
});

api.openapi(shareUploadRoute, async (c) => {
  const viewer = await currentViewer();
  if (viewer === null) {
    return c.json({ error: "Sign in to share a file" }, 401);
  }
  if (!bucketEnabled()) {
    return c.json({ error: "Sharing is unavailable on this server" }, 503);
  }
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) {
    return c.json({ error: "That file is empty" }, 413);
  }
  if (body.byteLength > config.maxMidiBytes) {
    return c.json({ error: "That file is too large to share" }, 413);
  }
  const bytes = new Uint8Array(body);
  // Reading it proves it is a MIDI before it is given a public url that is
  // meant to keep resolving.
  try {
    readMidi(bytes);
  } catch {
    return c.json({ error: "That file is not a valid MIDI" }, 413);
  }
  const url = await uploadMidi(`shared/${crypto.randomUUID()}.mid`, bytes);
  return c.json({ url }, 200);
});

api.doc31("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Kinesthesia API",
    version: "0.1.0",
    description: "Search MIDI files and get links to play them.",
  },
});

api.get(
  "/docs",
  Scalar({ url: "/api/openapi.json", pageTitle: "Kinesthesia API" }),
);

api.all("/mcp", mcpHandler);
