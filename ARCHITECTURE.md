# Architecture

Next.js App Router app. One Hono instance serves the whole API, and Zod schemas
are the single source for request validation, the OpenAPI spec, the docs page
and the MCP tools.

## Map

```
src/app/
  page.tsx                    search home
  watch|learn|multiplayer/page.tsx  read the URL, hand params to the player
  api/[[...route]]/route.ts   mounts the Hono app at /api
src/server/
  api.ts                      routes, OpenAPI spec, Scalar docs, MCP server
  config.ts                   environment
  auth.ts                     optional Logto session and sign in actions
  http/fetch.ts               proxy aware fetch for outbound source calls
  multiplayer/rooms.ts        room codes pointing at a host peer, per match
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
  player.tsx                  composes the hooks below into a mode, and hosts a
                              match through its aside, overlay and footer slots
  player-header.tsx           title, score, focus mode and mode switching
  part-controls.tsx           tracks, simplify and note density for one side
  player-transport.tsx        play, clock, scrubber, speed, key and settings
  settings-menu.tsx           key size, octave, timing and input
  piano-roll-view.tsx         canvas, the frame loop, touch input and panning
  track-menu.tsx              show, hide, solo and claim tracks
  hit-flag.tsx                the per-note perfect, good or miss verdict
  multiplayer.tsx             set up, invite, then the split view
  multiplayer-invite.tsx      the invite, at the end of the shared bar
  opponent-panel.tsx          the other side: match type, their part, their
                              score and roll, silent by design
src/lib/
  player-url.ts               builds and parses player URLs
  search-params.ts            route search params to URLSearchParams
  format/clock.ts             seconds as m:ss
  midi/song.ts                parses a .mid into a flat note list, moves it to another key
  midi/melody.ts              reduces a part to one playable note at a time
  midi/part.ts                a side's tracks and the notes sounding right now
  midi/use-part-roll.ts       a part as the getters the roll draws with
  midi/palette.ts             per track and per pitch colours
  audio/transport.ts          song position on the audio clock
  audio/engine.ts             instruments and the look ahead scheduler
  audio/instruments.ts        one voice per General MIDI program
  audio/voicing.ts            the instrument and shaping a track sounds with
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
  scoring/submission.ts       the one shape a recorded run is posted in
  scoring/use-run-record.ts   sends a finished run to the leaderboard
  input/use-note-input.ts     keyboard, MIDI and octave in one listener
  multiplayer/protocol.ts     messages exchanged between peers
  multiplayer/ice.ts          STUN, plus a TURN relay when configured
  storage/idb.ts              the IndexedDB connection and one query helper
  storage/library.ts          recents and favourites, and the word filter the
                              home page runs over them
  storage/settings.ts         remembered settings, per song and global
```

## How playback stays in time

`AudioContext.currentTime` is the only clock. `Transport` reports the song
position from it, the engine schedules notes a fifth of a second ahead against
it, and the canvas reads it once per animation frame. Nothing measures time with
`setTimeout`, so the drawing can never drift away from the audio or step
backwards.

## Modes

`watch` plays every track. `learn` and `multiplayer` hand the chosen tracks to
the player: the notes they owe are muted and the roll shows only them. Simplify
reduces that part to one note at a time, and the notes it drops are played by
the engine and drawn faintly, so the song still sounds whole. The reduction is
a pure function of the file and the part parameters, because both sides of a
match derive it separately and have to agree. `learn` pauses when it reaches a
note the player owes and resumes once they press it, while `multiplayer` plays
straight through and simply counts the miss. Each judged note pops a `hit-flag`,
green, gold or red, high on the roll clear of the keys.

`multiplayer` opens on the song itself and the host prepares the whole match.
Their own half is the player they already know; the other half is
`opponent-panel`, which is where the other player is set up, in order: the match
type, then the part they get. Both halves draw the same `part-controls` — tracks,
simplify, note density — so the two read as one instrument, and a side that is
not yours to set shows them disabled rather than missing. A **battle** mirrors
the host's own line onto their side and locks it; a **co-op** hands their part
over to the host to build.

The match hangs off the player through its `aside`, `overlay` and footer slots,
which puts one transport under both halves rather than one per side. That bar
carries the clock, the timeline, the shared speed and the invite, and because the
other half draws off the player's own clock, scrubbing walks both rolls together
and reads ahead on what each side is about to play. Speed and key are global to
a match, so they sit on that bar; what the settings menu keeps is only what this
device does with the song: key size, octave, timing and input.

Sending the invite is the last step and ends setup. It opens a room, freezes both
parts and takes the play and seek controls away, so from then on neither side is
played or edited, only watched. Opening the invite link joins straight away and
adopts what the host prepared, so nobody types a code.

Once connected it shows both players side by side, stacked on a narrow screen.
Each side hears only itself and rolls from its own clock; because both start
together and share the song and speed, the opponent's roll scrolls off the local
position and stays smooth without a single note event on the wire. Their `hello`
carries the part they are playing, so their roll and keys are drawn the way they
see it, and only their running score and each `hit` cross over.

A match plays together and never pauses. Both tap Ready, which unlocks their
audio in a gesture; the host then sends `begin` and both run one countdown and
start from zero, so the transport is hidden and nobody can pause or seek. When
the song ends each shows the result by points and can agree to a rematch or
leave. Each side beats a steady `ping`, since a closed tab fires no clean
disconnect; a silence longer than a few beats reads as the other player gone,
which stops the round and shows that they left. The room is closed the moment a
player joins, so an invite pulls in nobody else. A finished match records its
run for a signed in player: a battle keeps the win-loss outcome, a co-op keeps
the other player's points with no winner.

## Endpoints

```
GET  /api/midi/search         search across sources
GET  /api/midi/sources        list sources
POST /api/multiplayer/rooms        open a room
GET  /api/multiplayer/rooms/{code} look one up
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

Multiplayer rooms live in memory, so they are lost on restart and do not span
replicas. Web MIDI is unavailable in Safari, which is why the computer keyboard
path is not optional.

Signing in is optional. With no Logto values set, `authConfig` is null, the
header renders no button and the app is fully anonymous with recents and
favourites kept in the browser.

Settings are remembered in the browser. Per song settings (speed, tracks,
simplify and its note rate, key) come back when the song opens in any mode; global
settings (key width, timing offset) hold across every song. A link that states
a song setting outright still wins, so a shared view reproduces itself. A locked
match neither reads nor writes this memory, since its part is the prepared one.

Focus mode strips watch back to the keys and the falling notes, for recording.
It rides in the link so a focused view reproduces itself, and stays out of that
per song memory because it belongs to the recording rather than to the song.
Only watch offers it, so no mode that scores can hide what it is scoring.

A finished run is recorded with the settings that made it easier or harder, so
a leaderboard can say what a score was worth: speed, whether the part was
simplified, and the note rate it was reduced to. A run is kept as `learn`, a
competitive `battle` or a shared `coop`; a battle also records its win-loss
outcome and the opponent's points, while a co-op keeps the opponent's points
with no outcome.

Scores live in SQLite through Drizzle over the libSQL driver. The driver matters:
`bun:sqlite` exists only under Bun and `node:sqlite` only under Node, while this
app runs under both (`next start` uses Node, the container runs `bun server.js`).
Migrations in `drizzle/` are generated with `bun run db:generate` and applied
automatically on the first query, so a fresh volume comes up ready. Pointing
`DATABASE_URL` at a libSQL host with `DATABASE_AUTH_TOKEN` moves it off the file
with no code change.
