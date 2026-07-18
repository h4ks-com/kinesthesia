# Architecture

Next.js App Router app. One Hono instance serves the whole API, and Zod schemas
are the single source for request validation, the OpenAPI spec, the docs page
and the MCP tools.

## Map

```
src/app/
  page.tsx                    search home
  watch|learn|battle/page.tsx  read the URL, hand params to the player
  api/[[...route]]/route.ts   mounts the Hono app at /api
src/server/
  api.ts                      routes, OpenAPI spec, Scalar docs, MCP server
  config.ts                   environment
  auth.ts                     optional Logto session and sign in actions
  http/fetch.ts               proxy aware fetch for outbound source calls
  battle/rooms.ts             room codes pointing at a host peer
  db/schema.ts                Drizzle tables
  db/client.ts                libSQL connection and migration runner
  scores/store.ts             leaderboard queries
  midi/
    types.ts                  MidiSource contract and result shapes
    registry.ts               sources available to search
    bitmidi.ts                BitMidi adapter
    search.ts                 searches sources and attaches player links
src/components/
  song-row.tsx                one song with its favourite and mode links
  library-section.tsx         preview, expand and bound a saved list
  player.tsx                  composes the hooks below into a mode
  player-header.tsx           title, score, tracks and mode switching
  player-transport.tsx        play, clock, scrubber and settings
  settings-menu.tsx           speed and octave in one place
  piano-roll-view.tsx         canvas, the frame loop, touch input and panning
  track-menu.tsx              show, hide, solo and claim tracks
  battle.tsx                  room handshake, then the split view
  opponent-view.tsx           the other player's roll, silent by design
src/lib/
  player-url.ts               builds and parses player URLs
  search-params.ts            route search params to URLSearchParams
  midi/song.ts                parses a .mid into a flat note list
  midi/melody.ts              reduces a part to one playable note at a time
  midi/palette.ts             per track and per pitch colours
  audio/transport.ts          song position on the audio clock
  audio/engine.ts             instruments and the look ahead scheduler
  audio/instruments.ts        one voice per General MIDI program
  audio/general-midi.ts       program number to soundfont name
  audio/percussion.ts         drum note number to kit sample
  audio/use-playback-engine.ts  engine lifecycle, transport and speed
  midi/use-song.ts            loads and remembers a song
  render/keyboard.ts          key geometry, sizing and the pitch under a point
  render/piano-roll.ts        draws notes, keyboard, glow and sparks
  input/keyboard-map.ts       computer keyboard to pitch
  input/web-midi.ts           MIDI devices, including hot plug
  scoring/judge.ts            hit windows, combo and accuracy
  scoring/gates.ts            chords the player owes, as one unit each
  scoring/use-gates.ts        waiting, judging and missing
  input/use-note-input.ts     keyboard, MIDI and octave in one listener
  battle/protocol.ts          messages exchanged between peers
  battle/ice.ts               STUN, plus a TURN relay when configured
  storage/library.ts          recents and favourites in IndexedDB, and the
                              word filter the home page runs over them
```

## How playback stays in time

`AudioContext.currentTime` is the only clock. `Transport` reports the song
position from it, the engine schedules notes a fifth of a second ahead against
it, and the canvas reads it once per animation frame. Nothing measures time with
`setTimeout`, so the drawing can never drift away from the audio or step
backwards.

## Modes

`watch` plays every track. `learn` and `battle` hand the chosen tracks to the
player: the notes they owe are muted and the roll shows only them. Simplify
reduces that part to one note at a time, and the notes it drops are played by
the engine and drawn faintly, so the song still sounds whole. The reduction is
a pure function of the file and the URL parameters, because both sides of a
battle derive it separately and have to agree. `learn` pauses when
it reaches a note the player owes and resumes once they press it, while `battle`
plays straight through and simply counts the miss.

`battle` shows both players side by side, stacked on a narrow screen. Each side
hears only itself; the opponent's roll, keys and score are drawn from the
messages arriving over the peer connection.

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

`/api/mcp` builds a fresh `McpServer` per request and uses a stateless
transport, so a client calls a tool in one POST. An MCP `Protocol` binds to a
single transport for its lifetime, so sharing one server across requests makes
every request after the first fail with `Already connected to a transport`.
The server's `instructions` are the context an LLM client gets about what
kinesthesia is, alongside each tool's own description.

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

Signing in is optional. With no Logto values set, `authConfig` is null, the
header renders no button and the app is fully anonymous with recents and
favourites kept in the browser.

Scores live in SQLite through Drizzle over the libSQL driver. The driver matters:
`bun:sqlite` exists only under Bun and `node:sqlite` only under Node, while this
app runs under both (`next start` uses Node, the container runs `bun server.js`).
Migrations in `drizzle/` are generated with `bun run db:generate` and applied
automatically on the first query, so a fresh volume comes up ready. Pointing
`DATABASE_URL` at a libSQL host with `DATABASE_AUTH_TOKEN` moves it off the file
with no code change.
