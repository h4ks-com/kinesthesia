# Architecture

Next.js App Router app. One Hono instance serves the whole API, and Zod schemas
are the single source for request validation, the OpenAPI spec, the docs page
and the MCP tools.

## Map

```
src/app/
  page.tsx                    search home
  watch|play|battle/page.tsx  read the URL, hand params to the player
  api/[[...route]]/route.ts   mounts the Hono app at /api
src/server/
  api.ts                      routes, OpenAPI spec, Scalar docs, MCP server
  config.ts                   environment
  http/fetch.ts               proxy aware fetch for outbound source calls
  battle/rooms.ts             room codes pointing at a host peer
  midi/
    types.ts                  MidiSource contract and result shapes
    registry.ts               sources available to search
    bitmidi.ts                BitMidi adapter
    search.ts                 searches sources and attaches player links
src/components/
  player.tsx                  transport, gating, scoring, input wiring
  piano-roll-view.tsx         canvas element and the animation frame loop
  track-menu.tsx              show, hide and claim tracks
  battle.tsx                  room handshake, then renders the player
src/lib/
  player-url.ts               builds and parses player URLs
  search-params.ts            route search params to URLSearchParams
  midi/song.ts                parses a .mid into a flat note list
  midi/palette.ts             per track and per pitch colours
  audio/transport.ts          song position on the audio clock
  audio/engine.ts             piano samples and the look ahead scheduler
  render/piano-roll.ts        draws notes, keyboard, glow and sparks
  input/keyboard-map.ts       computer keyboard to pitch
  input/web-midi.ts           MIDI devices, including hot plug
  scoring/judge.ts            hit windows, combo and accuracy
  battle/protocol.ts          messages exchanged between peers
```

## How playback stays in time

`AudioContext.currentTime` is the only clock. `Transport` reports the song
position from it, the engine schedules notes a fifth of a second ahead against
it, and the canvas reads it once per animation frame. Nothing measures time with
`setTimeout`, so the drawing can never drift away from the audio or step
backwards.

## Modes

`watch` plays every track. `play` and `battle` hand the chosen tracks to the
player: those tracks are muted, the transport pauses when it reaches a note the
player owes, and it resumes once they press it. `battle` adds a peer connection
that carries score updates.

## Endpoints

```
GET  /api/midi/search         search across sources
GET  /api/midi/sources        list sources
POST /api/battle/rooms        open a room
GET  /api/battle/rooms/{code} look one up
GET  /api/openapi.json        generated spec
GET  /api/docs                Scalar reference
ALL  /api/mcp                 MCP over streamable HTTP
```

## Adding a MIDI source

Implement `MidiSource` in `src/server/midi/`, then add it to `registry.ts`.
Search, the spec and the MCP tool all read the registry, so nothing else changes.

## Notes

Browsers fetch `.mid` files straight from the source, so playback needs no
proxy. Only server side search does, and only when the host IP is blocked, which
is what `MIDI_SOURCE_PROXY_URL` is for.

Battle rooms live in memory, so they are lost on restart and do not span
replicas. Web MIDI is unavailable in Safari, which is why the computer keyboard
path is not optional.
