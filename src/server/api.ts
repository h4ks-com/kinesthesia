import { StreamableHTTPTransport } from "@hono/mcp";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Scalar } from "@scalar/hono-api-reference";
import {
  clampMelodyRate,
  defaultMelodyRate,
  melodyRates,
} from "@/lib/midi/melody";
import { clampTranspose, defaultTranspose } from "@/lib/midi/song";
import {
  asSpeed,
  buildPlayerUrl,
  defaultSpeed,
  defaultStart,
  isPlayableUrl,
  type PlayerMode,
  playerModes,
  speeds,
} from "@/lib/player-url";
import { currentViewer } from "@/server/auth";
import { config } from "@/server/config";
import type { Score } from "@/server/db/schema";
import { sourceFetch } from "@/server/http/fetch";
import { analyseMidi } from "@/server/midi/analyse";
import { isSafeId } from "@/server/midi/id";
import { findSource, midiSourceIds, midiSources } from "@/server/midi/registry";
import { fileEndpoint, searchMidi } from "@/server/midi/search";
import {
  closeRoom,
  createRoom,
  findRoom,
  type MultiplayerRoom,
} from "@/server/multiplayer/rooms";
import { saveScore, statsFor, topScores } from "@/server/scores/store";
import {
  deleteVoicing,
  saveVoicing,
  voicingsFor,
} from "@/server/voicings/store";

const searchInputShape = {
  q: z.string().min(1).describe("Song or file name to look for"),
  source: z
    .enum(midiSourceIds)
    .optional()
    .describe("Restrict the search to a single source"),
  limit: z.coerce.number().int().min(1).max(50).default(10),
};

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

const infoInputShape = {
  source: z.enum(midiSourceIds).describe("Provider the id came from"),
  id: z.string().min(1).describe("The file's id within that source"),
  name: z.string().default("").describe("Name to report it under"),
};

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
  const provider = findSource(source);
  if (provider === null || !isSafeId(id)) {
    return c.json({ error: "Unknown source or id" }, 502);
  }
  try {
    const summary = await analyseMidi(provider.fileUrl(id), name);
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
  const source = c.req.query("source") ?? "";
  const id = c.req.query("id") ?? "";
  const provider = findSource(source);
  if (provider === null || !isSafeId(id)) {
    return c.json({ error: "Unknown source or id" }, 400);
  }
  try {
    const upstream = await sourceFetch(provider.fileUrl(id));
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

const playerLinkShape = {
  source: z
    .enum(midiSourceIds)
    .optional()
    .describe("Provider the id came from, from search_midi"),
  id: z.string().min(1).optional().describe("The song's id within that source"),
  url: z
    .string()
    .url()
    .optional()
    .describe(
      "A direct .mid url from a trusted origin, in place of source and id",
    ),
  name: z.string().default("").describe("Song name to show in the player"),
  mode: z
    .enum(playerModes)
    .default("watch")
    .describe(
      "watch plays it back, learn waits for each note, multiplayer plays it with two people",
    ),
  speed: z
    .number()
    .optional()
    .describe(`Playback speed, one of ${speeds.join(", ")}`),
  transpose: z
    .number()
    .int()
    .optional()
    .describe(
      "Semitones to move the song by, -12 to 12. Percussion stays where it is",
    ),
  tracks: z
    .array(z.number().int().min(0))
    .optional()
    .describe(
      "Track numbers the player owes. Everything else is played for them",
    ),
  simplified: z
    .boolean()
    .optional()
    .describe("Reduce the part they owe to one note at a time"),
  melodyRate: z
    .number()
    .int()
    .optional()
    .describe(
      `Most notes per second a simplified part asks for, ${melodyRates[0]} to ${melodyRates[melodyRates.length - 1]}`,
    ),
  focus: z
    .boolean()
    .optional()
    .describe(
      "Strip the page back to the keys and the falling notes, for recording. Watch only",
    ),
  start: z
    .number()
    .min(0)
    .optional()
    .describe(
      "Seconds into the song to open at, so the link starts partway through. Use midi_info to find the point",
    ),
};

type PlayerLinkInput = {
  readonly source?: (typeof midiSourceIds)[number];
  readonly id?: string;
  readonly url?: string;
  readonly name: string;
  readonly mode: PlayerMode;
  readonly speed?: number;
  readonly transpose?: number;
  readonly tracks?: readonly number[];
  readonly simplified?: boolean;
  readonly melodyRate?: number;
  readonly focus?: boolean;
  readonly start?: number;
};

type PlayerLink = { ok: true; url: string } | { ok: false; why: string };

/** Every value goes through the same clamp the player uses, so a link this
 * returns cannot ask for a speed or a key the player would refuse. */
function playerLink(input: PlayerLinkInput): PlayerLink {
  let file: string;
  let source: string | null;
  if (input.url !== undefined) {
    if (!isPlayableUrl(input.url, config.trustedMidiOrigins)) {
      return { ok: false, why: "the url must be a .mid from a trusted origin" };
    }
    file = input.url;
    source = null;
  } else if (input.source !== undefined && input.id !== undefined) {
    if (findSource(input.source) === null) {
      return { ok: false, why: `unknown source: ${input.source}` };
    }
    file = fileEndpoint(input.source, input.id);
    source = input.source;
  } else {
    return {
      ok: false,
      why: "pass a source and id from search_midi, or a url",
    };
  }
  if (
    input.speed !== undefined &&
    !speeds.some((option) => option === input.speed)
  ) {
    return { ok: false, why: `speed must be one of ${speeds.join(", ")}` };
  }
  if (input.focus === true && input.mode !== "watch") {
    return {
      ok: false,
      why: "focus strips the scoring chrome, so it is only offered in watch",
    };
  }
  const built = new URL(
    buildPlayerUrl(config.appBaseUrl, input.mode, {
      url: file,
      name: input.name,
      source,
      tracks: input.tracks ?? null,
      speed: asSpeed(input.speed ?? defaultSpeed),
      simplified: input.simplified ?? false,
      melodyRate: clampMelodyRate(input.melodyRate ?? defaultMelodyRate),
      transpose: clampTranspose(input.transpose ?? defaultTranspose),
      focus: input.focus ?? false,
      start: input.start ?? defaultStart,
    }),
  );
  // A setting left at its default is otherwise dropped, which hands it back to
  // whatever the listener's device remembers for the song. Naming one is an
  // instruction, so it is written down even when it matches the default.
  if (input.speed !== undefined) {
    built.searchParams.set("speed", String(asSpeed(input.speed)));
  }
  if (input.transpose !== undefined) {
    built.searchParams.set(
      "transpose",
      String(clampTranspose(input.transpose)),
    );
  }
  if (input.simplified !== undefined) {
    built.searchParams.set("simple", input.simplified ? "1" : "0");
  }
  if (input.melodyRate !== undefined) {
    built.searchParams.set("rate", String(clampMelodyRate(input.melodyRate)));
  }
  return { ok: true, url: built.toString() };
}

const mcpInstructions = `Kinesthesia is a MIDI file search engine over several
sources. search_midi looks a song up by name and returns, for every match, the
source it came from and its id within that source, a downloadUrl any program
reading MIDI can fetch, and player links that open it in a browser: /watch plays
it back, /learn waits for the player to hit each note, /multiplayer plays it with
two people together.

A song is named by its source and id everywhere. midi_info takes a source and id
and reports how long the file runs, how many notes it holds and what is on each
track, which is how to answer how long or how hard a song is and how to pick a
track to play.

Those player links take the song as it comes. To open one at a different speed,
in another key, on chosen tracks, partway through, or stripped back for
recording, build it with player_link, passing the same source and id: it
validates every value and refuses a combination the player would ignore.

player_link also accepts a direct .mid url in place of source and id, as long as
the url is on an origin the deployment trusts. That is how a file from elsewhere,
such as a paste service the deployment allows, is opened in the player.`;

function createMcpServer(): McpServer {
  const mcp = new McpServer(
    { name: "kinesthesia", version: "0.1.0" },
    { instructions: mcpInstructions },
  );

  mcp.registerTool(
    "search_midi",
    {
      title: "Search MIDI files",
      description:
        "Find MIDI files by song name across every source. Returns, for each match, its source and id, a downloadUrl to fetch the .mid, and browser links to play it back (playUrl), practise it (learnUrl) or play it with someone (multiplayerUrl). Pass the source and id to midi_info or player_link.",
      inputSchema: searchInputShape,
    },
    async ({ q, source, limit }) => {
      const results = await searchMidi({
        query: q,
        source: source ?? null,
        limit: limit ?? 10,
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }],
      };
    },
  );

  mcp.registerTool(
    "midi_info",
    {
      title: "Read a MIDI file",
      description:
        "Read a source's file and report how long it runs, how many notes it holds, and what is on each track. Use it to answer how long or how hard a song is, and to choose the tracks argument for player_link rather than guessing. Take the source and id from search_midi.",
      inputSchema: infoInputShape,
    },
    async ({ source, id, name }) => {
      const provider = findSource(source);
      if (provider === null || !isSafeId(id)) {
        return {
          content: [{ type: "text", text: `Unknown source or id: ${source}` }],
          isError: true,
        };
      }
      try {
        const summary = await analyseMidi(provider.fileUrl(id), name);
        return {
          content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : "Unreadable MIDI",
            },
          ],
          isError: true,
        };
      }
    },
  );

  mcp.registerTool(
    "player_link",
    {
      title: "Build a player link",
      description:
        "Turn a source and id (from search_midi), or a direct .mid url from a trusted origin, into a browser link that opens the song exactly as asked: the mode to open in, the speed, the key, which tracks the player owes, whether the part is reduced to one note at a time, how many seconds in to start, and whether the page is stripped back to the keys and the falling notes for recording.",
      inputSchema: playerLinkShape,
    },
    async (input) => {
      const link = playerLink(input);
      return {
        content: [
          {
            type: "text",
            text:
              link.ok === true
                ? link.url
                : `That link cannot be built: ${link.why}`,
          },
        ],
        isError: link.ok === false,
      };
    },
  );

  return mcp;
}

// A Protocol binds to exactly one transport for its lifetime, so a shared
// server would reject every request after the first. Stateless transport lets a
// client call a tool in a single POST with no session handshake.
api.all("/mcp", async (c) => {
  const transport = new StreamableHTTPTransport({
    sessionIdGenerator: undefined,
  });
  await createMcpServer().connect(transport);
  return transport.handleRequest(c);
});
