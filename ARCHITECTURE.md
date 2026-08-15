# Architecture

Next.js App Router app. One Hono instance serves the whole API, and Zod schemas
are the single source for request validation, the OpenAPI spec, the docs page
and the MCP tools.

## Map

```
src/app/
  page.tsx                    search home
  sources/page.tsx            the sources a search runs over, and their licensing
  watch|learn|multiplayer/page.tsx  read the URL, hand params to the player
  play/page.tsx               the free roam player, which reads no song
  api/[[...route]]/route.ts   mounts the Hono app at /api
src/server/
  api.ts                      routes, OpenAPI spec, Scalar docs, and where the
                              MCP handler is mounted
  mcp.ts                      the MCP server, its tools and instructions, and
                              the player links it builds for agents
  config.ts                   environment
  auth.ts                     optional Logto session and sign in actions
  analytics/track.ts          the one place a usage event leaves this server,
                              off unless a key is configured. An address is read
                              for a country and a daily hash, never sent
  http/fetch.ts               proxy aware fetch for outbound source calls
  multiplayer/rooms.ts        room codes pointing at a host peer, per match
  db/schema.ts                Drizzle tables
  db/client.ts                libSQL connection and migration runner
  scores/store.ts             leaderboard queries
  voicings/store.ts           how people made a song sound, one save each
  storage/bucket.ts           uploads generated MIDI and project specs to the object store
  render/jobs.ts              renders in flight, each with the one key that may
                              hand its file back. In memory, like the rooms
  render/browser.ts           drives a render in a browser somewhere else, over
                              the DevTools protocol, and holds the limits on how
                              many may run
  skins/store.ts              backgrounds somebody added, and what is refused
  skins/declared.ts           the name a script gives itself, parsed out of its
                              own background() call without running it
  skins/check.ts              runs a submitted background in the render browser
                              before it is kept, so its author hears why it
                              would not draw. Skipped where there is no browser
  skins/doc.ts                how to write one, for whoever asks
  midi/
    types.ts                  MidiSource contract and result shapes
    registry.ts               sources available to search, and the source and
                              id to .mid url resolution
    bitmidi.ts                BitMidi adapter
    mutopia.ts                Mutopia adapter
    id.ts                     rejects a file id that could climb out of its path
    search.ts                 searches sources, proxies files and attaches links
    relevance.ts              orders results by what they carry of the query,
                              since a source ranks two words worse than one
    analyse.ts                reads a .mid with the player's own parser and
                              hands back its report: the same one the song
                              info panel shows
    inputs.ts                 the search and info inputs both surfaces validate
                              with
src/components/
  song-row.tsx                one song with its favourite and mode links
  share-upload.tsx            publishes one of your own files, behind a confirm
  skin-picker.tsx             the backgrounds, each running live before it is picked
  added-backgrounds.tsx       the section for ones added over the api, each
                              fetched and run only once its tile is looked at
  custom-backgrounds.tsx      adding a picture of your own, and shaping the one
                              in use
  library-section.tsx         preview, expand and bound a saved list
  player.tsx                  composes the hooks below into a mode, and hosts a
                              match through its aside, overlay and footer slots
  player-header.tsx           the song menu, score, focus, and one control each
                              for mode and notation view
  sheet-view.tsx              sheet music for the open song: two cursors that
                              step with playback, an eased scroll that follows
                              them while it plays and yields to the reader when
                              it stops, a seekable progress rail and an
                              ink-on-paper option
  song-menu.tsx               what you can do with the open song: see its
                              analysis, download it, copy its link, favourite
                              it, put it online
  song-info-panel.tsx         tempo, key, meter, tracks and the chord
                              progression, read off the song already in memory
  chord-timeline.tsx          the chord progression as a strip against real
                              time rather than bar numbers, coloured by root
  part-controls.tsx           tracks, simplify, note density and hand for one
                              side
  player-transport.tsx        play, clock, scrubber, speed, key and settings
  settings-menu.tsx           key size, octave, timing and input
  render-menu.tsx             render the watch view to a video or audio file
  piano-roll-view.tsx         canvas, the frame loop, touch input and panning
  track-menu.tsx              show, hide, solo and claim tracks, and the way
                              into how each one sounds
  sound-view.tsx              one track's instrument and shaping, in place of
                              the track list
  instrument-picker.tsx       the 128 General MIDI programs, grouped and searchable
  envelope-editor.tsx         attack, volume and release as a curve you drag
  hit-flag.tsx                the per-note perfect, good or miss verdict
  lead-meter.tsx              which way a battle is going, on the seam
  walkthrough.tsx             the first-run tour: spotlight, dialog, nav
  multiplayer.tsx             set up, invite, then the split view
  multiplayer-invite.tsx      the invite, at the end of the shared bar
  opponent-panel.tsx          the other side: match type, their part, their
                              score and roll, silent by design
  play-view.tsx               free roam: keys shoot notes up out of the keyboard
  parts-menu.tsx              the parts you play into and each one's instrument
src/lib/
  player-url.ts               builds and parses player URLs
  download.ts                 hands a blob to the browser as a named file
  analytics-report.ts         the two names the analytics route, the page that
                              posts to it and the build config have to agree on
  trusted-url.ts              whether a url may be opened at all, which the
                              player, the pictures and the MCP tools all ask
  use-player-settings.ts      the settings a song plays with, restored from this
                              device and written back to the URL
  use-background.ts           picks, remembers and resolves the background and
                              which way the notes travel
  search-params.ts            route search params to URLSearchParams
  format/clock.ts             seconds as m:ss
  midi/song.ts                parses a .mid into a flat note list, moves it to
                              another key, and carries its digest alongside it
  midi/sustain.ts             pedal spans, and how far past its end a note sounds under them
  midi/expression.ts          the bend and modulation wheels over time, per track
  midi/melody.ts              reduces a part to one playable note at a time
  midi/analysis.ts            detects tempo, key and chords, and the digest
                              that reports them: the one report the song info
                              panel, midi_info and GET /api/midi/info all read,
                              so the three can never drift apart
  midi/compose.ts             chord voicing, a 5x7 text font and note primitives
  midi/project.ts             an editable song: beat-timed tracks and the edit ops
  midi/part.ts                a side's tracks and the notes sounding right now
  midi/hands.ts               which hand plays each note of a track, for a
                              file that puts both hands on one
  midi/use-part-roll.ts       a part as the getters the roll draws with
  midi/palette.ts             per track and per pitch colours
  play/use-play-notes.ts      the notes play mode emits, rising from the keys
  audio/transport.ts          song position on the audio clock
  audio/stage.ts              the one audio device and its decoded recordings,
                              held for the life of the page and lent to players
  audio/engine.ts             the look ahead scheduler, on a borrowed stage
  audio/instruments.ts        one sampler voice per General MIDI program, for the
                              drums and for anything the recordings fail
  audio/sample-voices.ts      plays every melodic note on a voice it holds, so a
                              bend, an envelope and a pause all reach it
  audio/soundfont-samples.ts  a soundfont file as decoded buffers, each marked
                              where it loops
  audio/voicing.ts            the instrument and shaping a track sounds with
  audio/use-song-voicing.ts   whose sound is playing, kept on this device and
                              saved to your account
  audio/general-midi.ts       program number to soundfont name
  audio/percussion.ts         drum note number to kit sample
  audio/use-playback-engine.ts  engine lifecycle, transport and speed
  midi/use-song.ts            loads and remembers a song
  sheet/types.ts              the shapes the notation converter reads and
                              writes, and the global notation view and colour
                              theme settings
  sheet/spelling.ts           a key's diatonic pitch spelling, table and
                              fifths, and the chromatic notes it implies
  sheet/staff-split.ts        notes onto the grand staff by their own pitch
                              median, not a fixed line
  sheet/notation.ts           quantises onto a 16th note grid, carries each
                              written moment's heard time through the
                              reduction, ties notes across a barline, and
                              writes it all as MusicXML
  sheet/convert.ts            the pure song to MusicXML pipeline the tests
                              exercise directly
  sheet/load.ts               rereads a file's own MIDI for the tempo, meter
                              and key the converter needs, which `Song` does
                              not carry
  tour/steps.ts               what the walkthrough points at, per mode
  tour/use-walkthrough.ts     first-run auto play and the replay it hands back
  render/keyboard.ts          key geometry, sizing and the pitch under a point
  render/bend-shape.ts        where a bar sits row by row once the wheels have
                              moved under it, as arithmetic with no canvas
  render/piano-roll.ts        draws notes, keyboard, glow and the bend trace,
                              and play mode's live notes rising from the keys
  render/sparks.ts            the swarm thrown up from the keys, and its ceiling
  skins/types.ts              what a background is told, what it must answer,
                              and which way each one reads
  skins/backdrop.ts           a picture behind the roll, written and read the way
                              a CSS background is, and the older shape a device
                              may have saved
  skins/picture.ts            draws that picture: covering and still, or tiled
                              down the roll and travelling with the notes
  skins/registry.ts           the backgrounds on offer, which suit a direction,
                              and which way notes travel under one
  skins/use-added-skins.ts    the backgrounds somebody added, read from the
                              listing wherever they are offered
  use-nearby.ts               whether an element has come near enough to be
                              looked at, for work worth putting off until then
  render/export.ts            the watch view as a render job: qualities and frame
  render/audio.ts             offline audio render to a WAV, at the live voicing
  render/video.ts             offline video render, WebCodecs with a recorder fallback
  render/video-support.ts     what this browser can encode, without loading an
                              encoder to find out
  render/handback.ts          a render the address asked for: proving one was
                              wanted, and returning the file to the server
  skins/api.ts                the whole surface a background is written against
  skins/runtime/source.ts     the worker every background is drawn inside, and
                              everything it is denied before one runs
  skins/runtime/stdlib.ts     what a background is given to draw with
  skins/runtime/host.ts       runs one somewhere it cannot reach anything, and
                              stops it when it throws or falls behind
  skins/runtime/stamp.ts      the worker's address, stamped with its contents
  skins/scripts/              every background this build ships, as scripts
  midi/harmony.ts             what is sounding, named, and read back by a cursor
  input/keyboard-map.ts       computer keyboard to pitch
  input/web-midi.ts           MIDI devices, including hot plug
  input/midi-shortcuts.ts     controller buttons and sliders bound to backgrounds,
                              one button each and one slider across all, on the
                              device and fired in any mode
  scoring/judge.ts            hit windows, combo and accuracy
  scoring/gates.ts            chords the player owes, as one unit each
  scoring/use-gates.ts        waiting, judging and missing
  scoring/lead.ts             the live margin, as a share of the pot
  scoring/submission.ts       the one shape a recorded run is posted in
  scoring/use-run-record.ts   sends a finished run to the leaderboard
  input/use-note-input.ts     keyboard, MIDI and octave in one listener
  multiplayer/protocol.ts     messages exchanged between peers
  multiplayer/ice.ts          STUN, plus a TURN relay when configured
  storage/idb.ts              the IndexedDB connection and one query helper
  storage/library.ts          recents and favourites, and the word filter the
                              home page runs over them
  storage/settings.ts         remembered settings, per song and global, plus
                              how a song sounds on this device
  storage/uploads.ts          bytes of uploaded MIDI files, keyed by local: url,
                              and where one was published if it has been
  storage/publish.ts          puts one of your own files in the object store and
                              records the address it answers to
  storage/pictures.ts         background images, kept on this device only and
                              never uploaded
```

## How playback stays in time

`AudioContext.currentTime` is the only clock. `Transport` reports the song
position from it, the engine schedules notes a fifth of a second ahead against
it, and the canvas reads it once per animation frame. Nothing measures time with
`setTimeout`, so the drawing can never drift away from the audio or step
backwards.

## Notation view

`sheet-view.tsx` shows the open song as sheet music, off, half above the
falling notes, or full in their place. The header's View control, one eye
icon, opens a vertical list naming the three: Notes, Split, Sheet only.
Notation reads across the page and the
notes fall down it, so the two are stacked rather than set side by side and
each keeps the whole width. `src/lib/sheet/` turns a song into MusicXML:
`convert.ts` quantises every note onto a 16th note grid, splits the notes
across the grand staff by the same hand assignment the player uses, spells each
pitch from the key `midi/analysis.ts` already detects, and writes measures,
rests and
ties across a barline as plain MusicXML 3.1. Every onset earns an event, so a
note struck while another is still ringing is written into the chord that
follows rather than dropped, which is busier than an engraver would set it and
is what lets the cursor stop on every note that sounds. It is pure and knows
nothing of a
live song; `load.ts` is the one place that rereads a file's own MIDI for the
tempo, meter and key `Song` does not carry, and hands the converter a plain
note list built from the notes already playing, transposed and past their
runway.

OpenSheetMusicDisplay, loaded only once the view opens, draws the MusicXML
with two of its own cursors: the first highlights the notes sounding now, the
second sits one onset ahead and marks what comes next as a narrow bar in the
warning colour, so the two read apart at a glance. Both are steppers with no
way to seek, so the view keeps an index into the note onsets `convert.ts`
reports and steps each cursor forward on every animation frame the song's own
clock has crossed the next onset, resetting and fast-forwarding both back up to
position on a seek backward. Those onsets are the seconds the notes are heard
at, carried through the reduction beside their place on the grid: the grid
holds one tempo because that is what reads well, so it is never the clock a
performance keeps.

A vertical rail beside the notation reads the same clock: its fill and
playhead move every frame, and dragging or clicking it seeks exactly like the
transport's own scrubber. While the song plays the notation belongs to it: the
panel refuses pointer input and keeps the current system in view by easing its
own scroll toward a point a third of the way down rather than jumping to it.
Stopped, it belongs to the reader, holds wherever they leave it, and moves only
to chase a seek. OSMD's own built-in follow would fight this over the same
scroll position, so it stays off, and the panel tells its own scroll apart from
one the reader made by comparing against the value it last wrote itself.

A small button in the notation panel's own corner inverts it to dark ink on
light paper instead of the app's usual light on dark, the way printed
notation reads. Its colours come from the same CSS custom properties the rest
of the app defines (`--text` or `--ink`, `--accent`, `--warn`) rather than a
second set of hex values. The notation view choice and this inversion are
both global settings, remembered the way key width and timing offset are, so
they hold across every song and every mode, including focus mode, which
shares the same stage the roll and the notation split.

## Modes

The header's Mode control, one popover, opens a vertical list naming all
three, Watch first since it is the default, then Learn, then Multiplayer; the
current one shows as selected and the others are real links. Multiplayer is
disabled in the list for a device local file, which cannot be shared, and the
whole control disappears once inside a match, since a match's mode is fixed.

`watch` plays every track. `learn` and `multiplayer` hand the chosen tracks to
the player: the notes they owe are muted and the roll shows only them. Simplify
reduces that part to one note at a time, and the notes it drops are played by
the engine and drawn faintly, so the song still sounds whole. The reduction is
a pure function of the file and the part parameters, because both sides of a
match derive it separately and have to agree. `learn` pauses when it reaches a
note the player owes and resumes once they press it, while `multiplayer` plays
straight through and simply counts the miss. Each judged note pops a `hit-flag`,
green, gold or red, high on the roll clear of the keys.

`play` is the reverse of the others: there is no song and nothing falls. Each
key you press, from touch, the computer keyboard or a MIDI device, shoots a note
up out of the keyboard that blooms while held and drifts off once released,
drawn on the same free running audio clock the roll already reads. You keep a
set of parts, each an instrument shaped the same way as any track, and choose
the one touch and the keyboard play into; a MIDI note picks its part by the
channel it arrives on, so a split or multitimbral controller drives several at
once. It has no timeline, so the transport bar keeps its height but stays empty.

`multiplayer` opens on the song itself and the host prepares the whole match.
Their own half is the player they already know; the other half is
`opponent-panel`, which is where the other player is set up, in order: the match
type, then the part they get. Both halves draw the same `part-controls` — tracks,
simplify, note density and hand — so the two read as one instrument, and a side
that is not yours to set shows them disabled rather than missing. A `hand`
narrows a chosen track to the left or right hand of it, for a file that puts
both on one track; it is a filter on top of the track, not a track of its own,
so both hands of one track keep that track's colour. A **battle** mirrors
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
GET  /api/midi/file           stream a source's file by source and id
GET  /api/midi/info           read a file by source and id
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

`search_midi` knows only what a source lists. `midi_info` downloads the file and
parses it with the player's own parser, so a caller can say how long a song runs
and which track to play rather than guess, and reports per track whether it
looks like it holds both hands. It reports the song's tempo, meter, estimated
key and chord progression too, from the same digest the browser computes when it
opens the file and the song info panel reads straight off it: `midi_info`,
`GET /api/midi/info` and the panel all show one report, so they cannot drift
apart. `search_midi` returns a plain link
per mode. `player_link` builds one carrying
the speed, key, tracks, a hand of them, simplify and focus a caller asks for,
which is what makes those settings reachable by an agent at all: they live only
in the query string and nothing else advertises them. It clamps through the
same functions the player parses with, so a link it hands back cannot ask for a
value the player would refuse. A setting the caller names is written down even
at its
default, since leaving it out would hand it to whatever the listener's device
remembers for that song.

A first visit to watch, learn, or a match a person is hosting runs a
walkthrough: it darkens the page and spotlights one control at a time from a
per mode list of `data-tour` anchors. It is client only, remembered per mode in
localStorage so it runs once, and replayed any time from the header's help
button. A match joiner is never auto shown it.

## Adding a MIDI source

Implement `MidiSource` in `src/server/midi/`, giving it a `fileUrl(id)`, then add
it to `registry.ts`. Search, the spec and the MCP tool all read the registry, so
nothing else changes.

## Notes

A song is named by its source and id. `/api/midi/file` streams the bytes through
our origin, so a source that sends no cross origin headers still plays in the
browser and every source is fetched the same way. `MIDI_SOURCE_PROXY_URL` is a
separate outbound proxy for when a source blocks the server's own IP.

Multiplayer rooms live in memory, so they are lost on restart and do not span
replicas. Web MIDI is unavailable in Safari, which is why the computer keyboard
path is not optional.

Signing in is optional. With no Logto values set, `authConfig` is null, the
header renders no button and the app is fully anonymous with recents and
favourites kept in the browser.

Settings are remembered in the browser. Per song settings (speed, tracks, hand,
simplify and its note rate, key) come back when the song opens in any mode; global
settings (key width, timing offset, the notation view and its colour theme)
hold across every song.
A link that states a song setting outright still wins, so a shared view
reproduces itself. A locked match neither reads nor writes this memory, since
its part is the prepared one.

How a song sounds is kept on the device that shaped it and shared from the
account that saved it. Every edit lands in the browser as it settles, so a
listener with no account keeps what they made and an unsaved edit survives a
reload. A signed in listener can save it to their account, one saved version
per person per song, and everyone reads from the same table. What plays is
what you picked this session, then what this device last shaped, then your own
saved version, then whoever shaped it last, then the instruments the file
named. It stays out of the URL: there is a version per track and a link
carrying all of it would be unreadable.

A song is its url. A voicing is keyed on that alone, on the device and in the
table, so one file has one sound however the link that opened it named where
it came from.

Focus mode strips any mode back to the keys and the falling notes, for
recording. It rides in the link so a focused view reproduces itself, and stays
out of that per song memory because it belongs to the recording rather than to
the song. Entering it names the song over the empty view, then fades; a corner
button and Escape both leave, so a phone with no Escape is never stuck. A
crafted link auto-focuses a solo view but not a match, whose invite and setup
live in the chrome focus hides.

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
