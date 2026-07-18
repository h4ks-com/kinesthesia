# Kinesthesia

[![ci](https://github.com/h4ks-com/kinesthesia/actions/workflows/ci.yml/badge.svg)](https://github.com/h4ks-com/kinesthesia/actions/workflows/ci.yml)
[![docker](https://github.com/h4ks-com/kinesthesia/actions/workflows/docker.yml/badge.svg)](https://github.com/h4ks-com/kinesthesia/actions/workflows/docker.yml)
[![image](https://ghcr-badge.egpl.dev/h4ks-com/kinesthesia/latest_tag?trim=major&label=ghcr.io)](https://github.com/h4ks-com/kinesthesia/pkgs/container/kinesthesia)
[![size](https://ghcr-badge.egpl.dev/h4ks-com/kinesthesia/size?label=image%20size)](https://github.com/h4ks-com/kinesthesia/pkgs/container/kinesthesia)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![Kinesthesia playing a song](public/screenshot.png)

A piano roll for the web, inspired by [Synthesia](https://synthesiagame.com/).
Search for any song, and it pulls the MIDI straight from the source and drops
the notes down onto an 88 key piano.

Live at [kinesthesia.h4ks.com](https://kinesthesia.h4ks.com).

## Three ways to play

Search on the home page, pick a song, then choose how you want it.

- **Watch** plays the song to you, every track falling in its own colour.
- **Play** hands you a track. The notes stop at the keys and wait until you hit
  the right ones, so the song moves at your pace. Use a real MIDI keyboard, or
  the computer keyboard: the bottom two rows are laid out like a piano, with the
  black keys sitting above the white ones, and the arrow keys shift octave.
- **Battle** puts you against someone else on the same song. You hear only
  yourself, and you watch their score climb next to yours. Open a room, send
  them the code, and the game runs peer to peer.

Everything about a session lives in the URL, so copying the address bar hands
someone the exact same song, mode and track selection.

## Run it

```
cp .env.example .env
bun install
bun run dev
```

Or with Docker, either building it here:

```
docker compose up
```

or straight from the published image, which is built for amd64 and arm64:

```
docker run -p 3000:3000 -v kinesthesia:/app/data ghcr.io/h4ks-com/kinesthesia:latest
```

Every setting lives in `.env`, and `.env.example` documents all of them.

You never have to sign in to play. Recent songs and favourites are kept in your
browser. If you fill in the Logto values a sign in button appears, and finished
runs are recorded to a leaderboard that anyone can read.

## API

The search API is public and self documenting.

```
GET  /api/midi/search?q=<song>   search across sources
GET  /api/midi/sources           list the sources it can search
POST /api/battle/rooms           open a battle room
GET  /api/battle/rooms/{code}    look one up
GET  /api/scores                 public leaderboard
POST /api/scores                 record a run, needs a signed in player
GET  /api/openapi.json           OpenAPI 3.1 spec
GET  /api/docs                   browsable reference
ALL  /api/mcp                    the same tools over MCP
```

Every result carries the source it came from, a direct link to the `.mid` file
and a link that opens it in the player. Sources are pluggable, so more can be
added without touching the API.

## Credits

MIDI files come from [BitMidi](https://bitmidi.com). The falling note idea comes
from [Synthesia](https://synthesiagame.com/). Piano samples come from
[smplr](https://github.com/danigb/smplr), and the peer to peer side uses
[PeerJS](https://peerjs.com/).

MIT licensed. Copyright 2026 Matheus Fillipe.
[github.com/h4ks-com/kinesthesia](https://github.com/h4ks-com/kinesthesia)
