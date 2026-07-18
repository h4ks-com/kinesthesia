import { StreamableHTTPTransport } from "@hono/mcp";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Scalar } from "@scalar/hono-api-reference";
import { midiSourceIds, midiSources } from "@/server/midi/registry";
import { searchMidi } from "@/server/midi/search";

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
    playUrl: z.string().describe("Link that opens the file in the player"),
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

api.openapi(sourcesRoute, (c) =>
  c.json({ sources: midiSources.map(({ id, label }) => ({ id, label })) }, 200),
);

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

const mcp = new McpServer({ name: "kinesthesia", version: "0.1.0" });

mcp.registerTool(
  "search_midi",
  {
    title: "Search MIDI files",
    description:
      "Search MIDI files by song name. Returns the source, a direct download link and a player link for each match.",
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

api.all("/mcp", async (c) => {
  const transport = new StreamableHTTPTransport();
  await mcp.connect(transport);
  return transport.handleRequest(c);
});
