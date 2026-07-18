<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Kinesthesia

Synthesia-style MIDI player and piano game. Next.js App Router, TypeScript, Bun.

## Commands

```
bun run dev        # dev server on :3000
bun run ci         # lint, typecheck, test, build. This is what CI runs
bun run test       # unit and component tests
bun run test:e2e   # Playwright
bun run lint:fix   # Biome autofix
```

Git hooks and GitHub Actions both call these same scripts, so every check has
exactly one definition. Change a check in `package.json` and both follow.

## Layout

`ARCHITECTURE.md` maps the codebase. Update it whenever you add, move or remove
a module.

## Code rules

- No comments by default. The code is already English. A comment earns its place
  only for a non-obvious why, an invariant, or a footgun. Never narrate what the
  code does, and never describe a change.
- No commented-out code.
- Explicit parameter and return types. Prefer a union or a domain type over a
  bare `string` or `number`.
- Prefer `null` over `undefined` for intentional absence. Never stack `?` with
  `| null`.
- No `as unknown as`. Needing it means the type is wrong, so model the input
  honestly instead.
- Unions over enums. Constants are camelCase.
- `import type` for type-only imports.
- Optional chaining and `??` over if-guards. `const` unless reassigned.
- When `0` is a valid value, compare explicitly rather than testing truthiness.

## React rules

- Function components and hooks only.
- Never an array index as a key. Refs never belong in dependency arrays.
- Keep the render loop out of React state. Canvas and audio run on refs and
  `requestAnimationFrame`.
- Anything touching `window`, `AudioContext` or Web MIDI is client only and must
  not run during render.

## Design rules

- Single source of truth. Parallel structures describing one thing collapse into
  one.
- YAGNI. An abstraction needs a real second consumer.
- One concern per commit.

## Conventions

- Commit messages are one short lowercase line saying what the change does.
- All player state lives in the URL, so copying a URL reproduces the exact view.
- Never commit secrets. `.env.example` documents every variable.
