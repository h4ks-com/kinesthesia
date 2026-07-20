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
  type PlayerMode,
  playerModes,
  speeds,
} from "@/lib/player-url";
import { currentViewer } from "@/server/auth";
import { config } from "@/server/config";
import type { Score } from "@/server/db/schema";
import { analyseMidi } from "@/server/midi/analyse";
import { midiSourceIds, midiSources } from "@/server/midi/registry";
import { searchMidi } from "@/server/midi/search";
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
      z.object({ id: z.enum(midiSourceIds), label: z.string() }),
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
  url: z.string().url().describe("Direct link to the .mid file"),
  name: z.string().default("").describe("Name to report it under"),
};

const infoRoute = createRoute({
  method: "get",
  path: "/midi/info",
  summary: "Read a MIDI file",
  description:
    "Downloads a .mid and reports how long it runs, how many notes it holds and what is on each track.",
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
  const { url, name } = c.req.valid("query");
  try {
    const summary = await analyseMidi(url, name);
    return c.json({ ...summary, tracks: [...summary.tracks] }, 200);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Unreadable MIDI" },
      502,
    );
  }
});

api.openapi(sourcesRoute, (c) =>
  c.json({ sources: midiSources.map(({ id, label }) => ({ id, label })) }, 200),
);

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

api.openapi(createRoomRoute, (c) =>
  c.json(roomResponse(createRoom(c.req.valid("json"))), 200),
);

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
  description: "Public leaderboard of scores from signed in players.",
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
    "Stores a finished run against the signed in player. Requires Logto to be configured and a signed in session.",
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
  description: "Aggregate stats for the signed in player.",
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
  program: z.number().int().min(0).max(127),
  attack: z.number().int().min(0).max(1000),
  release: z.number().int().min(0).max(4000),
  brightness: z.number().int().min(200).max(20000),
  volume: z.number().int().min(0).max(150),
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
  summary: "How people made a song sound",
  description:
    "Every saved instrument and shaping for a song, newest first. One per person.",
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
  summary: "Save how a song sounds",
  description:
    "Stores the signed in player's instrument and shaping for a song, replacing the one they had.",
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
  summary: "Drop how you made a song sound",
  description:
    "Removes the signed in player's voicing, back to the file's own.",
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
  url: z.string().url().describe("Direct link to the .mid file"),
  name: z.string().default("").describe("Song name to show in the player"),
  source: z
    .string()
    .optional()
    .describe("Provider the file came from, from search_midi"),
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
};

type PlayerLinkInput = {
  readonly url: string;
  readonly name: string;
  readonly source?: string;
  readonly mode: PlayerMode;
  readonly speed?: number;
  readonly transpose?: number;
  readonly tracks?: readonly number[];
  readonly simplified?: boolean;
  readonly melodyRate?: number;
  readonly focus?: boolean;
};

type PlayerLink = { ok: true; url: string } | { ok: false; why: string };

/** Every value goes through the same clamp the player uses, so a link this
 * returns cannot ask for a speed or a key the player would refuse. */
function playerLink(input: PlayerLinkInput): PlayerLink {
  if (!/^https?:\/\//i.test(input.url)) {
    return { ok: false, why: "the song must be an http or https .mid URL" };
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
      url: input.url,
      name: input.name,
      source: input.source ?? null,
      tracks: input.tracks ?? null,
      speed: asSpeed(input.speed ?? defaultSpeed),
      simplified: input.simplified ?? false,
      melodyRate: clampMelodyRate(input.melodyRate ?? defaultMelodyRate),
      transpose: clampTranspose(input.transpose ?? defaultTranspose),
      focus: input.focus ?? false,
      start: defaultStart,
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

const mcpInstructions = `Kinesthesia is a MIDI file search engine. Look up songs
by name and get, for every match, a direct .mid download URL that any program
reading MIDI can fetch. Use it whenever someone wants a MIDI file for a song.
Each match also carries a player link that opens the song in a browser: /watch
plays it back, /learn waits for the player to hit each note, /multiplayer plays
it with two people together.

Search only knows a song's name. midi_info reads the file itself and reports how
long it runs, how many notes it holds and what is on each track, which is how to
answer how long or how hard a song is, and how to pick a track to play.

Those links take the song as it comes. To open one at a different speed, in
another key, on chosen tracks, or stripped back for recording, build the link
with player_link rather than editing the query string by hand: it validates
every value and refuses a combination the player would ignore.`;

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
        "Find MIDI files by song name. Returns, for each match, the source, a direct .mid download URL to fetch the file, and browser links to play it back (playUrl), practise it (learnUrl) or play it with someone (multiplayerUrl).",
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
        "Download a .mid and report how long it runs, how many notes it holds, and what is on each track. Use it to answer how long or how hard a song is, and to choose the tracks argument for player_link rather than guessing.",
      inputSchema: infoInputShape,
    },
    async ({ url, name }) => {
      try {
        const summary = await analyseMidi(url, name);
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
        "Turn a .mid URL into a browser link that opens it exactly as asked: the mode to open in, the speed, the key, which tracks the player owes, whether the part is reduced to one note at a time, and whether the page is stripped back to the keys and the falling notes for recording. Take the .mid URL from search_midi.",
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
