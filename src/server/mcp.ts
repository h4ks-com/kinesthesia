import { createHash, timingSafeEqual } from "node:crypto";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "@hono/zod-openapi";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "hono";
import { digest, readMidi } from "@/lib/midi/analysis";
import {
  clampMelodyRate,
  defaultMelodyRate,
  melodyRates,
} from "@/lib/midi/melody";
import {
  addChords,
  addNotes,
  addText,
  createProject,
  duplicate,
  EditError,
  importProject,
  insertBars,
  type Project,
  projectBytes,
  projectDigest,
  setInstrument,
  setTempo,
  transpose,
} from "@/lib/midi/project";
import { clampTranspose, defaultTranspose } from "@/lib/midi/song";
import {
  asSpeed,
  buildPlayerUrl,
  defaultSpeed,
  defaultStart,
  type PlayerMode,
  playerModes,
  readSkinChoice,
  speeds,
} from "@/lib/player-url";
import { skinIds, skinReads } from "@/lib/skins/types";
import { isPlayableUrl } from "@/lib/trusted-url";
import { config } from "@/server/config";
import { sourceFetch } from "@/server/http/fetch";
import { analyseMidi } from "@/server/midi/analyse";
import { infoInputShape, searchInputShape } from "@/server/midi/inputs";
import {
  findSource,
  midiSourceIds,
  sourceFileUrl,
} from "@/server/midi/registry";
import { fileEndpoint, searchMidi } from "@/server/midi/search";
import {
  bucketEnabled,
  getJson,
  putJson,
  uploadMidi,
} from "@/server/storage/bucket";

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
  skin: z
    .string()
    .optional()
    .describe(
      "Background drawn behind the notes, purely cosmetic. Either the name of one this build ships, or a picture written the way a CSS background is: url(https://host/a.jpg) followed by scroll or fixed and brightness(60%). fixed lays one copy over the roll and holds it still; scroll tiles the picture and travels it with the notes. The picture must be on an origin the deployment trusts, the same allowlist a .mid url is held to. Some shipped backgrounds send the notes out of the keys instead of onto them, and those are watch only. Left out for the plain roll. A listener who has already picked their own background keeps it, so this decides the look only for someone who never has",
    ),
  rise: z
    .boolean()
    .optional()
    .describe(
      "Send the notes out of the keys as they sound instead of onto them. A look rather than a way to read ahead, so it is watch only. Some backgrounds turn it on by themselves. Kept by a listener who has set it for themselves, like the background",
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
  readonly source: (typeof midiSourceIds)[number] | undefined;
  readonly id: string | undefined;
  readonly url: string | undefined;
  readonly name: string;
  readonly mode: PlayerMode;
  readonly speed: number | undefined;
  readonly transpose: number | undefined;
  readonly tracks: readonly number[] | undefined;
  readonly simplified: boolean | undefined;
  readonly melodyRate: number | undefined;
  readonly focus: boolean | undefined;
  readonly skin: string | undefined;
  readonly rise: boolean | undefined;
  readonly start: number | undefined;
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
  const choice =
    input.skin === undefined
      ? null
      : readSkinChoice(input.skin, config.trustedMidiOrigins);
  if (input.skin !== undefined && choice === null) {
    return {
      ok: false,
      why: `unknown background: ${input.skin}. Try ${skinIds.join(" or ")}, or a picture on a trusted host written as url(https://host/a.jpg) repeat scroll brightness(60%)`,
    };
  }
  const skin = choice?.kind === "built-in" ? choice.id : null;
  if (skin !== null && input.mode !== "watch" && !skinReads(skin, "down")) {
    const falling = skinIds.filter((id) => skinReads(id, "down"));
    return {
      ok: false,
      why: `${skin} sends the notes out of the keys, and a mode that is played needs them approaching. In ${input.mode} try ${falling.join(" or ")}`,
    };
  }
  if (input.rise === true && input.mode !== "watch") {
    return {
      ok: false,
      why: "notes may only leave the keys in watch, since a mode that is played needs them approaching",
    };
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
      rise: input.rise ?? false,
      skin: choice,
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

function mcpAuthorized(header: string | undefined): boolean {
  const expected = config.mcpTokenHash;
  // With no hash set the endpoint is open only outside production, so a
  // deployment that forgets MCP_TOKEN_HASH refuses every request rather than
  // exposing the write tools unauthenticated.
  if (expected === null) {
    return process.env.NODE_ENV !== "production";
  }
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (token === null) {
    return false;
  }
  const got = Buffer.from(createHash("sha256").update(token).digest("hex"));
  const want = Buffer.from(expected);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** The real .mid url behind a source+id, or a trusted direct url, held to the
 * same origin allowlist as a pasted link. */
function midiFetchUrl(input: {
  source: string | undefined;
  id: string | undefined;
  url: string | undefined;
}): { url: string } | { error: string } {
  if (input.url !== undefined) {
    if (!isPlayableUrl(input.url, config.trustedMidiOrigins)) {
      return { error: "the url must be a .mid from a trusted origin" };
    }
    return { url: input.url };
  }
  if (input.source !== undefined && input.id !== undefined) {
    const url = sourceFileUrl(input.source, input.id);
    if (url === null) {
      return { error: `unknown source or id: ${input.source}` };
    }
    return { url };
  }
  return { error: "pass a source and id from search_midi, or a url" };
}

/** Stores a generated .mid in the public bucket and hands back both the raw
 * file url and a player link, so nothing binary crosses the MCP channel. */
async function publishGenerated(
  bytes: Uint8Array,
): Promise<{ downloadUrl: string; playUrl: string }> {
  const id = crypto.randomUUID();
  const downloadUrl = await uploadMidi(`gen/${id}.mid`, bytes);
  return { downloadUrl, playUrl: `${config.appBaseUrl}/api/g/${id}` };
}

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function toolError(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function toolJson(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

const analyzeInputShape = {
  source: z
    .enum(midiSourceIds)
    .optional()
    .describe("Provider the id came from, from search_midi"),
  id: z.string().min(1).optional().describe("The file's id within that source"),
  url: z
    .string()
    .url()
    .optional()
    .describe("A direct .mid url from a trusted origin, in place of source+id"),
  name: z.string().default("").describe("Name to report it under"),
};

const textInputShape = {
  text: z
    .string()
    .min(1)
    .max(120)
    .describe("Message to spell out on the keys; wraps to fit, A-Z and spaces"),
  name: z.string().default("text").describe("Name to show in the player"),
  bpm: z.coerce.number().int().min(20).max(300).default(120),
};

const arpInputShape = {
  chords: z
    .array(z.string().min(1))
    .min(1)
    .max(64)
    .describe("Chord symbols, one per bar, e.g. Cmaj7 Am7 Dm7 G7"),
  bpm: z.coerce.number().int().min(20).max(300).default(120),
  octave: z.coerce.number().int().min(1).max(7).default(4),
  name: z.string().default("arpeggio").describe("Name to show in the player"),
};

function projectKeys(id: string): { spec: string; midi: string } {
  return { spec: `docs/${id}.json`, midi: `docs/${id}.mid` };
}

async function loadProject(id: string): Promise<Project> {
  const spec = await getJson<Project>(projectKeys(id).spec);
  if (spec === null) {
    throw new EditError(`no project with id ${id}`);
  }
  return spec;
}

/** Persists the spec and the rendered .mid under the project's stable keys, so
 * the player link a caller already has keeps resolving to the latest edit. */
async function saveProject(
  project: Project,
): Promise<{ id: string; url: string; digest: unknown }> {
  const keys = projectKeys(project.id);
  // The .mid lands before the spec, so a failed render leaves the spec (which
  // loadProject reads) unchanged and a retry re-applies the edit exactly once.
  await uploadMidi(keys.midi, projectBytes(project));
  await putJson(keys.spec, project);
  return {
    id: project.id,
    url: `${config.appBaseUrl}/api/p/${project.id}`,
    digest: projectDigest(project),
  };
}

async function commit(build: () => Promise<Project>): Promise<ToolResult> {
  if (!bucketEnabled()) {
    return toolError(
      "This deployment has no object store, so projects cannot be stored.",
    );
  }
  try {
    return toolJson(await saveProject(await build()));
  } catch (error) {
    if (error instanceof EditError) {
      return toolError(error.message);
    }
    console.error("project edit failed", error);
    return toolError("The edit could not be applied.");
  }
}

function newProjectId(): string {
  return `pj_${crypto.randomUUID()}`;
}

const styleArg = z
  .enum(["block", "up", "down"])
  .default("block")
  .describe("How the chords are voiced across each bar");
const trackArg = z
  .union([z.number().int().min(0), z.literal("new")])
  .optional()
  .describe('Track index to add to, or "new" for a fresh track');
const channelArg = z
  .number()
  .int()
  .min(0)
  .max(15)
  .optional()
  .describe("MIDI channel for a new track (9 is percussion)");
const idArg = z.string().min(1).describe("Project id from create_project");

const createProjectShape = {
  name: z.string().default("project"),
  bpm: z.coerce.number().int().min(20).max(300).default(120),
};
const importProjectShape = { ...analyzeInputShape };
const getProjectShape = { id: idArg };
const addChordsShape = {
  id: idArg,
  track: trackArg,
  channel: channelArg,
  chords: z.array(z.string().min(1)).min(1).max(64),
  style: styleArg,
  octave: z.coerce.number().int().min(1).max(7).default(3),
  atBar: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Bar to start at; omit to append after the last bar"),
};
const addTextShape = {
  id: idArg,
  track: trackArg,
  channel: channelArg,
  text: z
    .string()
    .min(1)
    .max(120)
    .describe("Wraps word by word to fit the keys"),
  atBar: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Bar to start at; omit to append after the last bar"),
};
const insertBarsShape = {
  id: idArg,
  atBar: z.coerce
    .number()
    .int()
    .min(1)
    .describe("Bar to open the gap at (1 prepends)"),
  bars: z.coerce
    .number()
    .int()
    .min(1)
    .max(64)
    .describe("How many empty bars to open"),
  track: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("One track, or all if omitted"),
};
const duplicateShape = {
  id: idArg,
  track: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("One track, or all if omitted"),
  fromBar: z.coerce.number().int().min(1),
  toBar: z.coerce.number().int().min(1),
  atBar: z.coerce
    .number()
    .int()
    .min(1)
    .describe("Bar to paste the first copy at"),
  times: z.coerce.number().int().min(1).max(64).default(1),
};
const transposeShape = {
  id: idArg,
  track: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("One track, or all if omitted"),
  by: z
    .union([z.number().int(), z.string()])
    .describe('Semitones, or an interval like "P5"'),
};
const setTempoShape = {
  id: idArg,
  bpm: z.coerce.number().int().min(20).max(300),
};
const setInstrumentShape = {
  id: idArg,
  track: z.number().int().min(0),
  program: z.coerce
    .number()
    .int()
    .min(0)
    .max(127)
    .describe("General MIDI program number"),
};
const addNotesShape = {
  id: idArg,
  track: trackArg,
  channel: channelArg,
  notes: z
    .array(
      z.object({
        note: z.string().describe('Note name with octave, e.g. "C4"'),
        at: z
          .union([z.string(), z.number()])
          .describe('Position as "bar:beat" or a beat number'),
        dur: z
          .union([z.string(), z.number()])
          .describe('Length as "1/4" or a number of beats'),
        velocity: z.number().min(0).max(1).optional(),
      }),
    )
    .min(1)
    .max(256),
};

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
in another key, on chosen tracks, partway through, stripped back for recording,
or against a background, build it with player_link, passing the same source and
id: it validates every value and refuses a combination the player would ignore.

A background may also be a picture rather than one this build ships. Write it the
way a CSS background is written, url(https://host/a.jpg) followed by scroll or
fixed and brightness(60%); the defaults are fixed and brightness(100%). A picture
either sits still and covers the roll, or travels with the notes, and travelling
means tiled because one copy would run out. The picture has to sit on an origin
the deployment trusts, the same allowlist a .mid url is held to, and a picture
somebody saved on their own device cannot be linked to at all.

The background is the skin argument, and it is decoration only: it never changes
the song, the notes or the timing. Everything about it rides in the link and
nothing is saved to the listener's device, so a link opens looking the way it was
sent. Watch takes any of them. Some send the notes out of the keys rather than
onto them, and those are refused in learn and multiplayer, where the approach is
how a player knows what to play; player_link names the ones that still work
there when it refuses. The rise argument turns the notes around on its own, for
a background that reads either way or for the plain roll, and is watch only for
the same reason.

A link that names a background shows it, whatever the listener has picked before,
because naming one is showing something on purpose. A link that says nothing
about it leaves their own choice alone. The visit does not overwrite what they
have saved, so their background is back the next time they open a link that is
quiet about it.

player_link also accepts a direct .mid url in place of source and id, as long as
the url is on an origin the deployment trusts. That is how a file from elsewhere,
such as a paste service the deployment allows, is opened in the player.

analyze_midi goes deeper than midi_info: it reads a file and reports its tempo
(and whether that is written down or a default), time signature, estimated key
with a confidence, and a bar-by-bar chord timeline. Use it to answer what key a
song is in or what its chords are. A low key confidence means the music is too
chromatic to name a key for.

make_text and arpeggiate create a new .mid and return a player link plus the raw
file url. make_text spells a short message out across the keys as falling notes.
arpeggiate turns a list of chord symbols, one per bar, into a rolling arpeggio.
Both refuse input the file cannot represent rather than writing a broken file.

For anything beyond a one-shot file, work in a project. create_project opens an
empty one and returns an id and a player link; import_project opens an existing
file the same way. Then build it up: add_chords lays a progression on a track or
a new one, add_text writes a caption, add_notes places individual notes, and
duplicate, transpose, set_tempo and set_instrument reshape what is there. Every
edit takes the project id, targets a track and channel, and returns the updated
state; the player link never changes, so it always plays the latest edit. Call
get_project to see the current tempo, key, tracks and chord timeline before
deciding the next edit. An edit that cannot be represented is refused with a
reason rather than corrupting the project.

To make something that sounds musical rather than random: pick a key and stay in
it. A major key's chords are I ii iii IV V vi (in C: C Dm Em F G Am); progressions
that reliably work are I V vi IV, ii V I, I vi IV V, and I IV V. Keep a melody on
the notes of that key's scale. Give each part its own track and channel so they
layer: bass low (octave 2) on one channel, chords in the middle (octave 3) on
another, melody high (octave 5) on a third, drums on channel 9. Build a short
phrase of a few bars, then duplicate it to repeat, and vary the last repeat. Use
analyze_midi or get_project to hear back the key and chords and check they line
up. Prefer add_chords with style up for a flowing part and block for a pad; keep
octaves apart so parts do not collide. Append to extend, insert_bars to put
something in front or in the middle.`;

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
      const fileUrl = sourceFileUrl(source, id);
      if (fileUrl === null) {
        return {
          content: [{ type: "text", text: `Unknown source or id: ${source}` }],
          isError: true,
        };
      }
      try {
        const summary = await analyseMidi(fileUrl, name);
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

  mcp.registerTool(
    "analyze_midi",
    {
      title: "Analyze a MIDI file",
      description:
        "Read a file and report its tempo, time signature, estimated key with a confidence, and a bar-by-bar chord timeline. Use it to answer what key a song is in or what its chords are. Take the source and id from search_midi, or pass a trusted .mid url.",
      inputSchema: analyzeInputShape,
    },
    async (input): Promise<ToolResult> => {
      const resolved = midiFetchUrl(input);
      if ("error" in resolved) {
        return toolError(resolved.error);
      }
      try {
        const response = await sourceFetch(resolved.url);
        if (!response.ok) {
          return toolError(
            `Could not download that MIDI (status ${response.status})`,
          );
        }
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > config.maxMidiBytes) {
          return toolError("That MIDI file is too large to analyze.");
        }
        return toolJson(digest(readMidi(buffer), input.name));
      } catch (error) {
        return toolError(
          error instanceof Error ? error.message : "Unreadable MIDI",
        );
      }
    },
  );

  mcp.registerTool(
    "make_text",
    {
      title: "Write text as a MIDI",
      description:
        "Spell a short message out across the keys as falling notes and return a player link plus the raw .mid url. A-Z and spaces render; other characters become blanks.",
      inputSchema: textInputShape,
    },
    async ({ text, name, bpm }): Promise<ToolResult> => {
      if (!bucketEnabled()) {
        return toolError(
          "This deployment has no object store, so a generated file cannot be shared.",
        );
      }
      try {
        const project = addText(createProject("oneshot", { name, bpm }), {
          track: "new",
          text,
        });
        if ((project.tracks[0]?.notes.length ?? 0) === 0) {
          return toolError("That text has nothing to draw.");
        }
        return toolJson(await publishGenerated(projectBytes(project)));
      } catch (error) {
        return toolError(
          error instanceof Error ? error.message : "Could not store the file.",
        );
      }
    },
  );

  mcp.registerTool(
    "arpeggiate",
    {
      title: "Arpeggiate a chord progression",
      description:
        "Turn a list of chord symbols, one per bar, into a rolling arpeggio whose notes ring into the held chord, and return a player link plus the raw .mid url. Refuses a chord symbol it cannot read.",
      inputSchema: arpInputShape,
    },
    async ({ chords, bpm, octave, name }): Promise<ToolResult> => {
      if (!bucketEnabled()) {
        return toolError(
          "This deployment has no object store, so a generated file cannot be shared.",
        );
      }
      try {
        const project = addChords(createProject("oneshot", { name, bpm }), {
          track: "new",
          chords,
          style: "up",
          octave,
        });
        return toolJson(await publishGenerated(projectBytes(project)));
      } catch (error) {
        return toolError(
          error instanceof Error ? error.message : "Could not store the file.",
        );
      }
    },
  );

  mcp.registerTool(
    "create_project",
    {
      title: "Start a project",
      description:
        "Open an empty editable project and return its id and a player link. Add content with add_chords, add_text and add_notes, reshape it with duplicate, transpose, set_tempo and set_instrument, and the link always plays the latest state.",
      inputSchema: createProjectShape,
    },
    ({ name, bpm }): Promise<ToolResult> =>
      commit(async () => createProject(newProjectId(), { name, bpm })),
  );

  mcp.registerTool(
    "import_project",
    {
      title: "Open an existing MIDI as a project",
      description:
        "Load a file (from search_midi's source and id, or a trusted url) into an editable project so you can add to it and reshape it. Returns the project id and a player link.",
      inputSchema: importProjectShape,
    },
    (input): Promise<ToolResult> =>
      commit(async () => {
        const resolved = midiFetchUrl(input);
        if ("error" in resolved) {
          throw new EditError(resolved.error);
        }
        const response = await sourceFetch(resolved.url);
        if (!response.ok) {
          throw new EditError(
            `Could not download that MIDI (status ${response.status})`,
          );
        }
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > config.maxMidiBytes) {
          throw new EditError("That MIDI file is too large to open.");
        }
        return importProject(
          newProjectId(),
          readMidi(buffer),
          input.name === "" ? "imported" : input.name,
        );
      }),
  );

  mcp.registerTool(
    "get_project",
    {
      title: "Inspect a project",
      description:
        "Report a project's tempo, meter, bar count, key, tracks (with channels) and chord timeline, so you can decide the next edit.",
      inputSchema: getProjectShape,
    },
    async ({ id }): Promise<ToolResult> => {
      if (!bucketEnabled()) {
        return toolError("This deployment has no object store.");
      }
      try {
        return toolJson(projectDigest(await loadProject(id)));
      } catch (error) {
        return toolError(
          error instanceof Error ? error.message : "No such project.",
        );
      }
    },
  );

  mcp.registerTool(
    "add_chords",
    {
      title: "Add chords to a project",
      description:
        "Add a chord progression, one chord per bar, to a track (or a new one) starting at a bar. Voice it as blocks or a rolling arpeggio. Refuses a chord it cannot read.",
      inputSchema: addChordsShape,
    },
    ({
      id,
      track,
      channel,
      chords,
      style,
      octave,
      atBar,
    }): Promise<ToolResult> =>
      commit(async () =>
        addChords(await loadProject(id), {
          ...(track !== undefined && { track }),
          ...(channel !== undefined && { channel }),
          chords,
          style,
          octave,
          ...(atBar !== undefined && { atBar }),
        }),
      ),
  );

  mcp.registerTool(
    "add_text",
    {
      title: "Add text to a project",
      description:
        "Spell a short message across the keys as falling notes on a track (or a new one), starting at a bar. Add it over an existing song for a caption.",
      inputSchema: addTextShape,
    },
    ({ id, track, channel, text, atBar }): Promise<ToolResult> =>
      commit(async () =>
        addText(await loadProject(id), {
          ...(track !== undefined && { track }),
          ...(channel !== undefined && { channel }),
          text,
          ...(atBar !== undefined && { atBar }),
        }),
      ),
  );

  mcp.registerTool(
    "add_notes",
    {
      title: "Add notes to a project",
      description:
        "Place individual notes on a track for full control. Each note has a name (C4), a position (bar:beat or a beat number) and a length (1/4 or a beat count).",
      inputSchema: addNotesShape,
    },
    ({ id, track, channel, notes }): Promise<ToolResult> =>
      commit(async () =>
        addNotes(await loadProject(id), {
          ...(track !== undefined && { track }),
          ...(channel !== undefined && { channel }),
          notes,
        }),
      ),
  );

  mcp.registerTool(
    "duplicate",
    {
      title: "Duplicate part of a project",
      description:
        "Copy a bar range and paste it at another bar, optionally several times, to loop or repeat a section. Acts on one track or all of them.",
      inputSchema: duplicateShape,
    },
    ({ id, track, fromBar, toBar, atBar, times }): Promise<ToolResult> =>
      commit(async () =>
        duplicate(await loadProject(id), {
          ...(track !== undefined && { track }),
          fromBar,
          toBar,
          atBar,
          times,
        }),
      ),
  );

  mcp.registerTool(
    "insert_bars",
    {
      title: "Open bars in a project",
      description:
        "Shift later content along to open empty bars at a point, so you can prepend (atBar 1) or insert a section in the middle, then add content into the gap.",
      inputSchema: insertBarsShape,
    },
    ({ id, atBar, bars, track }): Promise<ToolResult> =>
      commit(async () =>
        insertBars(await loadProject(id), {
          atBar,
          bars,
          ...(track !== undefined && { track }),
        }),
      ),
  );

  mcp.registerTool(
    "transpose",
    {
      title: "Transpose a project",
      description:
        "Move a track, or the whole project, by an interval or a number of semitones. Refuses a move that would run notes off the keyboard; percussion is left alone.",
      inputSchema: transposeShape,
    },
    ({ id, track, by }): Promise<ToolResult> =>
      commit(async () =>
        transpose(await loadProject(id), {
          ...(track !== undefined && { track }),
          by,
        }),
      ),
  );

  mcp.registerTool(
    "set_tempo",
    {
      title: "Set a project's tempo",
      description:
        "Change the beats-per-minute; the notes keep their bar positions.",
      inputSchema: setTempoShape,
    },
    ({ id, bpm }): Promise<ToolResult> =>
      commit(async () => setTempo(await loadProject(id), bpm)),
  );

  mcp.registerTool(
    "set_instrument",
    {
      title: "Set a track's instrument",
      description:
        "Change one track's General MIDI instrument by program number.",
      inputSchema: setInstrumentShape,
    },
    ({ id, track, program }): Promise<ToolResult> =>
      commit(async () =>
        setInstrument(await loadProject(id), { track, program }),
      ),
  );

  return mcp;
}

// A Protocol binds to exactly one transport for its lifetime, so a shared
// server would reject every request after the first. Stateless transport lets a
// client call a tool in a single POST with no session handshake.
export async function mcpHandler(c: Context): Promise<Response | undefined> {
  if (!mcpAuthorized(c.req.header("authorization"))) {
    return c.json({ error: "A valid bearer token is required" }, 401, {
      "www-authenticate": "Bearer",
    });
  }
  // Each request builds its own server, so there is no session to resume.
  const transport = new StreamableHTTPTransport();
  await createMcpServer().connect(transport);
  return transport.handleRequest(c);
}
