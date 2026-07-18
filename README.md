# Kinesthesia

[![ci](https://github.com/h4ks-com/kinesthesia/actions/workflows/ci.yml/badge.svg)](https://github.com/h4ks-com/kinesthesia/actions/workflows/ci.yml)
[![docker](https://github.com/h4ks-com/kinesthesia/actions/workflows/docker.yml/badge.svg)](https://github.com/h4ks-com/kinesthesia/actions/workflows/docker.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A piano roll for the web, inspired by [Synthesia](https://synthesiagame.com/).
Search for a song and it pulls the MIDI straight from the source so you can
watch it fall down the keyboard.

Live at [kinesthesia.h4ks.com](https://kinesthesia.h4ks.com).

## Run it

```
cp .env.example .env
bun install
bun run dev
```

Or with Docker:

```
docker compose up
```

Every setting lives in `.env`, and `.env.example` documents all of them.

## API

The search API is public and self documenting.

```
GET /api/midi/search?q=<song>   search across sources
GET /api/midi/sources           list the sources it can search
GET /api/openapi.json           OpenAPI 3.1 spec
GET /api/docs                   browsable reference
ALL /api/mcp                    the same tools over MCP
```

Every result carries the source it came from, a direct link to the `.mid` file
and a link that opens it in the player. Sources are pluggable, so more can be
added without touching the API.

## Credits

MIDI files come from [BitMidi](https://bitmidi.com). The falling note idea comes
from [Synthesia](https://synthesiagame.com/).

MIT licensed. Copyright 2026 Matheus Fillipe.
[github.com/h4ks-com/kinesthesia](https://github.com/h4ks-com/kinesthesia)
