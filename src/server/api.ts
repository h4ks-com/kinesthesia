import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import type { Context } from "hono";
import { apiBase, renderReportPath } from "@/lib/analytics-report";
import { readMidi } from "@/lib/midi/analysis";
import { renderQualityIds } from "@/lib/render/export";
import { renderKinds } from "@/lib/render/handback";
import { skinSource, skins } from "@/lib/skins/registry";
import { runtimeBundle } from "@/lib/skins/runtime/stamp";
import { skinIds } from "@/lib/skins/types";
import { isPlayableUrl } from "@/lib/trusted-url";
import { longestText, track } from "@/server/analytics/track";
import { currentViewer } from "@/server/auth";
import { config } from "@/server/config";
import type { Score } from "@/server/db/schema";
import { sourceFetch } from "@/server/http/fetch";
import { mcpAuthorized, mcpHandler } from "@/server/mcp";
import { analyseMidi } from "@/server/midi/analyse";
import {
  digestSchema,
  infoInputShape,
  searchInputShape,
} from "@/server/midi/inputs";
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
import { claimJob, failJob, finishJob } from "@/server/render/jobs";
import { saveScore, statsFor, topScores } from "@/server/scores/store";
import {
  addCustomSkin,
  listCustomSkins,
  readCustomSkin,
  removeCustomSkin,
} from "@/server/skins/store";
import { bucketEnabled, uploadFile, uploadMidi } from "@/server/storage/bucket";
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

const infoRoute = createRoute({
  method: "get",
  path: "/midi/info",
  summary: "Read a MIDI file",
  description:
    "Reads a source's file and reports its duration, tempo, time signature, estimated key, chord progression and what is on each track. The same report the song info panel and the midi_info MCP tool show. Take the source and id from a search result.",
  request: { query: z.object(infoInputShape) },
  responses: {
    200: {
      description: "What the file holds",
      content: { "application/json": { schema: digestSchema } },
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

export const api = new OpenAPIHono().basePath(apiBase);

/** A day, which no render or song reaches. */
const longestSong = 86_400;

/** Anything a caller writes that only ever becomes an event property, cut to fit
 * so a long one is still counted. */
const shortText = z
  .string()
  .optional()
  .transform((text) => text?.slice(0, longestText));

api.openapi(searchRoute, async (c) => {
  const { q, source, limit } = c.req.valid("query");
  const results = await searchMidi({ query: q, source: source ?? null, limit });
  // What was searched for, since which songs people go looking for is the point
  // of asking. How many came back says whether the sources are answering.
  track(
    "song_searched",
    c.req.raw.headers,
    // Cut to fit, since the box takes any length and none of it is ours.
    {
      query: q.slice(0, longestText),
      source: source ?? null,
      results: results.length,
    },
    await currentViewer(),
  );
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
    return c.json(
      {
        ...summary,
        tracks: summary.tracks.map((track) => ({
          ...track,
          range: [track.range[0], track.range[1]],
        })),
        harmony: [...summary.harmony],
      },
      200,
    );
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

/** A render runs entirely in the browser that asked for it, so the only way the
 * server hears how one went is the player saying so. Nothing is returned, and a
 * deployment with no analytics simply drops it. */
const renderReportRoute = createRoute({
  method: "post",
  path: renderReportPath,
  summary: "Report how a render went",
  description:
    "Used by the player once it has finished encoding, so renders can be counted. Names the song and how it was encoded, and carries no file.",
  request: {
    body: {
      content: {
        "application/json": {
          // Anything the page writes is cut to fit rather than refused, since a
          // song with a long title would otherwise be the one render nobody
          // hears about.
          schema: z.object({
            kind: z.enum(renderKinds),
            quality: z.enum(renderQualityIds),
            songSeconds: z.number().min(0).max(longestSong),
            elapsedSeconds: z.number().min(0).max(longestSong),
            song: shortText,
            realtime: z.boolean().optional(),
            error: shortText,
          }),
        },
      },
    },
  },
  responses: { 204: { description: "Counted" } },
});

api.openapi(renderReportRoute, async (c) => {
  const { kind, quality, songSeconds, elapsedSeconds, song, realtime, error } =
    c.req.valid("json");
  const shared = {
    kind,
    // Audio comes out as a wav whatever is picked, so a quality on one would
    // split a dashboard by something that had no effect.
    quality: kind === "video" ? quality : null,
    song: song ?? null,
    song_seconds: songSeconds,
    elapsed_seconds: elapsedSeconds,
  };
  const person = await currentViewer();
  if (error === undefined) {
    track(
      "render_finished",
      c.req.raw.headers,
      { ...shared, realtime: realtime ?? null },
      person,
    );
  } else {
    track(
      "render_failed",
      c.req.raw.headers,
      { ...shared, reason: error },
      person,
    );
  }
  return c.body(null, 204);
});

/** Streams a source's file through our own origin, so a provider that sends no
 * cross origin headers still plays in a browser. Binary, so it is a plain route
 * rather than a documented JSON one. */
api.get("/midi/file", async (c) => {
  const id = c.req.query("id") ?? "";
  if (id.startsWith("pj_")) {
    return c.json(
      { error: `That is a project id. Open it at /api/p/${id}` },
      404,
    );
  }
  const fileUrl = sourceFileUrl(c.req.query("source") ?? "", id);
  if (fileUrl === null) {
    return c.json({ error: "Unknown source or id" }, 400);
  }
  try {
    const upstream = await sourceFetch(fileUrl);
    // Told apart so a caller knows whether to fix the id or try again later.
    if (upstream.status === 404 || upstream.status === 410) {
      return c.json({ error: "That source has no file with that id" }, 404);
    }
    if (!upstream.ok) {
      return c.json({ error: "The file could not be fetched" }, 502);
    }
    const bytes = await upstream.arrayBuffer();
    track(
      "song_fetched",
      c.req.raw.headers,
      {
        source: c.req.query("source") ?? null,
        song: id,
        bytes: bytes.byteLength,
      },
      await currentViewer(),
    );
    return c.body(bytes, 200, {
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

/** The worker every background is drawn inside. Served rather than bundled
 * because only a response can carry the policy that forbids it the network, and
 * that policy is most of what makes running someone else's drawing code safe. */
api.get("/skins/runtime.js", (c) =>
  c.body(runtimeBundle, 200, {
    "content-type": "text/javascript; charset=utf-8",
    "content-security-policy":
      "default-src 'none'; script-src 'unsafe-eval'; connect-src 'none'",
    // Safe to keep for good: the address carries what it holds.
    "cache-control": "public, max-age=31536000, immutable",
  }),
);

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

api.openapi(createRoomRoute, async (c) => {
  const room = c.req.valid("json");
  // A joiner loads this url straight from the room, so it is held to the same
  // allowlist as a url typed into the address bar.
  if (!isPlayableUrl(room.url, config.trustedMidiOrigins)) {
    return c.json({ error: "The song url is not from an allowed origin" }, 400);
  }
  track(
    "match_created",
    c.req.raw.headers,
    { coop: room.coop, song: room.name, source: room.source },
    await currentViewer(),
  );
  return c.json(roomResponse(createRoom(room)), 200);
});

api.openapi(joinRoomRoute, async (c) => {
  const room = findRoom(c.req.valid("param").code);
  if (room === null) {
    return c.json({ error: "That room is not open" }, 404);
  }
  track(
    "match_joined",
    c.req.raw.headers,
    { coop: room.coop, song: room.name, source: room.source },
    await currentViewer(),
  );
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
  track(
    "score_submitted",
    c.req.raw.headers,
    {
      mode: stored.mode,
      song: stored.song,
      points: stored.points,
      accuracy: stored.accuracy,
      best_combo: stored.bestCombo,
    },
    viewer,
  );
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
  const saved = await voicingsFor(c.req.valid("query").url);
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
  const { tracks, url } = c.req.valid("json");
  const saved = await saveVoicing({
    authorId: viewer.id,
    authorName: viewer.name,
    url,
    tracks: JSON.stringify(tracks),
  });
  return c.json({ ...saved, tracks: readTracks(saved.tracks) }, 200);
});

api.openapi(deleteVoicingRoute, async (c) => {
  const viewer = await currentViewer();
  if (viewer === null) {
    return c.json({ error: "Sign in to change how a song sounds" }, 401);
  }
  await deleteVoicing(viewer.id, c.req.valid("query").url);
  return c.json({ deleted: true }, 200);
});

/** The object store is shared with the generated files the MCP tools write and
 * has a fixed size, so one account cannot be allowed to fill it. Held in memory
 * like the multiplayer rooms: a restart forgives, which is the right trade for
 * a limit this generous. */
const sharesPerHour = 30;
const shareWindowMs = 60 * 60 * 1000;
const shareTimes = new Map<string, number[]>();

function withinShareRate(viewerId: string): boolean {
  const now = Date.now();
  const recent = (shareTimes.get(viewerId) ?? []).filter(
    (at) => now - at < shareWindowMs,
  );
  if (recent.length >= sharesPerHour) {
    shareTimes.set(viewerId, recent);
    return false;
  }
  recent.push(now);
  shareTimes.set(viewerId, recent);
  return true;
}

const tooLarge = "That file is over the size this server accepts";

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
    400: {
      description: "Empty, or not a MIDI this server will play",
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
    429: {
      description: "Too many shares from this account for now",
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
    return c.json({ error: "Sharing is turned off here" }, 503);
  }
  if (!withinShareRate(viewer.id)) {
    return c.json({ error: "That is a lot of sharing. Try again later" }, 429);
  }
  // Checked before the body is read, so an oversized one is refused rather
  // than held in memory first.
  const declared = Number(c.req.header("content-length") ?? "");
  if (!Number.isFinite(declared) || declared > config.maxMidiBytes) {
    return c.json({ error: tooLarge }, 413);
  }
  const body = await c.req.arrayBuffer();
  if (body.byteLength > config.maxMidiBytes) {
    return c.json({ error: tooLarge }, 413);
  }
  if (body.byteLength === 0) {
    return c.json({ error: "That file is empty" }, 400);
  }
  const bytes = new Uint8Array(body);
  try {
    readMidi(bytes);
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error && error.message.startsWith("That MIDI")
            ? error.message
            : "That doesn't look like a MIDI file",
      },
      400,
    );
  }
  const url = await uploadMidi(`shared/${crypto.randomUUID()}.mid`, bytes);
  track(
    "upload_published",
    c.req.raw.headers,
    { bytes: bytes.byteLength },
    viewer,
  );
  return c.json({ url }, 200);
});

/** How big a rendered video may be. A long song at the encoder's bitrate is
 * tens of megabytes, and the cap only exists so a wedged render cannot fill the
 * bucket. */
const mostRenderBytes = 512 * 1024 * 1024;

/** The containers a render can come out in, which is what the encoder picks
 * between. Held to a list because the value names the stored file and the type
 * it is served as. */
const renderExtensions = ["webm", "mp4", "wav"] as const;
const renderTypes = {
  webm: "video/webm",
  mp4: "video/mp4",
  wav: "audio/wav",
} as const;

const renderArtifactRoute = createRoute({
  method: "post",
  path: "/renders/{id}",
  summary: "Hand back a finished render",
  description:
    "Used by the page doing the rendering, which proves itself with the key its own url carried. Not a public endpoint: a render is started through the MCP tool.",
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({
      key: z.string().min(1),
      extension: z.enum(renderExtensions),
    }),
    body: { content: { "application/octet-stream": { schema: z.any() } } },
  },
  responses: {
    200: {
      description: "Where the file now lives",
      content: {
        "application/json": { schema: z.object({ url: z.string() }) },
      },
    },
    403: {
      description: "No such render, or the wrong key",
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
      description: "The finished render could not be stored",
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
    },
  },
});

api.openapi(renderArtifactRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { key, extension } = c.req.valid("query");
  const job = claimJob(id, key);
  if (job === null) {
    return c.json({ error: "No render is waiting on that" }, 403);
  }
  // Checked before the body is read, and a request that declares nothing is
  // refused rather than buffered whole to find out how big it was.
  const declared = Number(c.req.header("content-length") ?? "");
  if (!Number.isFinite(declared) || declared > mostRenderBytes) {
    failJob(job, "The render came out larger than this server accepts");
    return c.json({ error: tooLarge }, 413);
  }
  const body = await c.req.arrayBuffer();
  if (body.byteLength > mostRenderBytes) {
    failJob(job, "The render came out larger than this server accepts");
    return c.json({ error: tooLarge }, 413);
  }
  try {
    const url = await uploadFile(
      `renders/${job.id}.${extension}`,
      new Uint8Array(body),
      renderTypes[extension],
    );
    finishJob(job, url);
    return c.json({ url }, 200);
  } catch (reason: unknown) {
    // Said out loud, because the object store's own reason is the only thing
    // that separates a bucket that is full from one that refused the write, and
    // the caller is only ever told that it did not land.
    console.error(
      `render ${job.id} could not be stored (${body.byteLength} bytes):`,
      reason,
    );
    // Left running, the job would hold a browser open until its deadline for a
    // render that is already over.
    failJob(job, "The finished render could not be stored");
    return c.json({ error: "The finished render could not be stored" }, 503);
  }
});

const renderClaimRoute = createRoute({
  method: "get",
  path: "/renders/{id}",
  summary: "Ask whether a render is really waiting",
  description:
    "Used by the page before it starts work, so a link somebody was handed cannot set a stranger's browser rendering.",
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({ key: z.string().min(1) }),
  },
  responses: {
    200: {
      description: "It is waiting",
      content: {
        "application/json": { schema: z.object({ waiting: z.boolean() }) },
      },
    },
    403: {
      description: "No such render, or the wrong key",
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
    },
  },
});

api.openapi(renderClaimRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { key } = c.req.valid("query");
  if (claimJob(id, key) === null) {
    return c.json({ error: "No render is waiting on that" }, 403);
  }
  return c.json({ waiting: true }, 200);
});

const renderFailedRoute = createRoute({
  method: "post",
  path: "/renders/{id}/failed",
  summary: "Report a render that could not finish",
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({ key: z.string() }),
    body: {
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
    },
  },
  responses: {
    200: {
      description: "Noted",
      content: {
        "application/json": { schema: z.object({ ok: z.boolean() }) },
      },
    },
    403: {
      description: "No such render, or the wrong key",
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
    },
  },
});

api.openapi(renderFailedRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { key } = c.req.valid("query");
  const job = claimJob(id, key);
  if (job === null) {
    return c.json({ error: "No render is waiting on that" }, 403);
  }
  failJob(job, c.req.valid("json").error.slice(0, 300));
  return c.json({ ok: true }, 200);
});

/** Backgrounds anyone may read and use, and only an agent may change. Listing
 * and reading are open because the picker is anonymous; adding and removing
 * take the one credential this deployment has for something that is not a
 * person. The ones this build ships are compiled in, so they are absent from
 * every write path rather than defended in one. */
const customSkinSchema = z.object({
  id: z.string(),
  name: z.string(),
  blurb: z.string(),
  addedAt: z.number(),
});

const listSkinsRoute = createRoute({
  method: "get",
  path: "/skins",
  summary: "List the backgrounds available",
  description:
    "Every background the roll can draw: the ones this build ships and the ones that have been added. Open to anyone, since choosing one needs no account.",
  responses: {
    200: {
      description: "What may be drawn behind the notes",
      content: {
        "application/json": {
          schema: z.object({
            builtIn: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                blurb: z.string(),
                directions: z.array(z.string()),
              }),
            ),
            custom: z.array(customSkinSchema),
          }),
        },
      },
    },
  },
});

api.openapi(listSkinsRoute, async (c) => {
  const custom = bucketEnabled() ? await listCustomSkins() : [];
  return c.json(
    {
      builtIn: skins.map((skin) => ({
        id: skin.id,
        name: skin.name,
        blurb: skin.blurb,
        directions: [...skin.directions],
      })),
      custom: [...custom],
    },
    200,
  );
});

const readSkinRoute = createRoute({
  method: "get",
  path: "/skins/{id}",
  summary: "Read a background's script",
  description:
    "The source a background is drawn by, whether it ships with this build or was added. Reading one is how you learn the shape before writing your own.",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "The script",
      content: { "text/plain": { schema: z.any() } },
    },
    404: {
      description: "No background by that name",
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
    },
  },
});

api.openapi(readSkinRoute, async (c) => {
  const { id } = c.req.valid("param");
  const built = skinIds.find((known) => known === id);
  if (built !== undefined) {
    return c.text(skinSource(built), 200, skinSourceHeaders);
  }
  const source = bucketEnabled() ? await readCustomSkin(id) : null;
  if (source === null) {
    return c.json({ error: "No background by that name" }, 404);
  }
  return c.text(source, 200, skinSourceHeaders);
});

/** Read as text, never run as a script. Every reader here fetches this and
 * hands the string to a worker, so nothing needs it to be executable, and
 * serving an added background as javascript from our own origin would turn one
 * token into a same-origin script anyone could point a tag at. */
const skinSourceHeaders = {
  "content-type": "text/plain; charset=utf-8",
  "x-content-type-options": "nosniff",
};

const addSkinRoute = createRoute({
  method: "post",
  path: "/skins",
  summary: "Add a background",
  description:
    "Stores a background script so anyone can pick it. Its name and blurb are read off its own background() call. Where a render browser is configured the script is run there first and refused with the reason where it will not draw. Takes the same bearer token the MCP endpoint does: a background is code, and code is not something a page may add on a visitor's say-so.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ source: z.string().min(1) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Added",
      content: { "application/json": { schema: customSkinSchema } },
    },
    400: {
      description: "The script was refused",
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
    },
    401: {
      description: "A valid bearer token is required",
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

api.openapi(addSkinRoute, async (c) => {
  // Stricter than the MCP endpoint, which stays open in a dev checkout: what is
  // stored here is executed in every visitor's browser, so it takes a token
  // wherever it runs.
  if (config.mcpTokenHash === null) {
    return c.json(
      { error: "Adding a background needs MCP_TOKEN_HASH set" },
      401,
    );
  }
  if (!mcpAuthorized(c.req.header("authorization"))) {
    return c.json({ error: "A valid bearer token is required" }, 401);
  }
  if (!bucketEnabled()) {
    return c.json({ error: "Backgrounds cannot be kept here" }, 503);
  }
  const { source } = c.req.valid("json");
  const added = await addCustomSkin(source);
  return added.ok ? c.json(added.skin, 200) : c.json({ error: added.why }, 400);
});

const removeSkinRoute = createRoute({
  method: "delete",
  path: "/skins/{id}",
  summary: "Remove an added background",
  description:
    "Takes an added background out of every listing. The ones this build ships cannot be removed; they are not stored anywhere to remove from.",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "Removed",
      content: {
        "application/json": { schema: z.object({ ok: z.boolean() }) },
      },
    },
    401: {
      description: "A valid bearer token is required",
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
    },
    404: {
      description: "No added background by that name",
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
    },
  },
});

api.openapi(removeSkinRoute, async (c) => {
  if (config.mcpTokenHash === null) {
    return c.json(
      { error: "Removing a background needs MCP_TOKEN_HASH set" },
      401,
    );
  }
  if (!mcpAuthorized(c.req.header("authorization"))) {
    return c.json({ error: "A valid bearer token is required" }, 401);
  }
  const { id } = c.req.valid("param");
  const gone = bucketEnabled() ? await removeCustomSkin(id) : false;
  return gone
    ? c.json({ ok: true }, 200)
    : c.json({ error: "No added background by that name" }, 404);
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
