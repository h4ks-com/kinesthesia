# Architecture

Next.js App Router app. One Hono instance serves the whole API, and Zod schemas
are the single source for request validation, the OpenAPI spec, the docs page
and the MCP tools.

## Map

```
src/app/
  api/[[...route]]/route.ts   mounts the Hono app at /api
src/server/
  api.ts                      routes, OpenAPI spec, Scalar docs, MCP server
  config.ts                   environment
  http/fetch.ts               proxy aware fetch for outbound source calls
  midi/
    types.ts                  MidiSource contract and result shapes
    registry.ts               sources available to search
    bitmidi.ts                BitMidi adapter
    search.ts                 searches sources and attaches player links
src/lib/
  player-url.ts               builds and parses player URLs
```

## Endpoints

```
GET /api/midi/search    search across sources
GET /api/midi/sources   list sources
GET /api/openapi.json   generated spec
GET /api/docs           Scalar reference
ALL /api/mcp            MCP over streamable HTTP
```

## Adding a MIDI source

Implement `MidiSource` in `src/server/midi/`, then add it to `registry.ts`.
Search, the spec and the MCP tool all read the registry, so nothing else changes.

## Notes

Browsers fetch `.mid` files straight from the source, so playback needs no
proxy. Only server side search does, and only when the host IP is blocked, which
is what `MIDI_SOURCE_PROXY_URL` is for.
