---
title: 'ARCH-003-p2: Extract input parsing into agent-framework'
status: done
done_at: 2026-05-31
created: 2026-05-30
priority: high
urgency: soon
area: packages/agent-framework, packages/agent-transport
depends_on: [ARCH-003-p1]
---

## Background

Slash detection and command tokenisation currently live inside `InputArea.tsx` (an Ink
component). These are pure text-processing utilities with no rendering concern. They must
move to `agent-framework` so all channels (TUI, web, headless) can share them without
duplication. See [ARCH-003 overview](ARCH-003-cli-interaction-channel-abstraction.md).

## Goal

Extract input parsing into `agent-framework/src/interaction/input-parser.ts` as pure
functions with unit tests. Remove the duplicated logic from `InputArea.tsx`.

## Current location of logic to extract

- `packages/agent-transport/src/tui/InputArea.tsx` — `parseSlashInput()`, slash detection
- `packages/agent-transport/src/tui/flows/input-area-flow.ts` — `resolveEnterCommandSelection()`

## File to create

```
packages/agent-framework/src/interaction/input-parser.ts
packages/agent-framework/src/interaction/__tests__/input-parser.test.ts
```

### `input-parser.ts` contract

```typescript
export type ParsedInput =
  | { type: 'slash-command'; name: string; args: string[] }
  | { type: 'user-message'; text: string };

/** Parse raw user input into a structured command or message. */
export function parseInput(text: string): ParsedInput;

/** Return true if text starts with '/' and has a command name. */
export function isSlashCommand(text: string): boolean;

/** Tokenise '/name arg1 arg2' → { name, args }. */
export function tokeniseSlashCommand(text: string): { name: string; args: string[] };
```

### Test cases to cover

- `/mode plan` → `{ type: 'slash-command', name: 'mode', args: ['plan'] }`
- `/mode` → `{ type: 'slash-command', name: 'mode', args: [] }`
- `hello world` → `{ type: 'user-message', text: 'hello world' }`
- `/` (bare slash) → `{ type: 'user-message', text: '/' }` (not a valid command)
- `/cmd arg with spaces` → args split correctly

## Files to update

- `packages/agent-transport/src/tui/InputArea.tsx` — import from `agent-framework`; remove
  local copy of slash detection
- `packages/agent-transport/src/tui/flows/input-area-flow.ts` — remove `parseSlashInput`,
  use `parseInput` from framework
- `packages/agent-framework/src/index.ts` — export `parseInput`, `ParsedInput`

## Constraints

- `input-parser.ts` must have zero side effects and no external dependencies
- Must not import anything from `agent-transport`

## Done gate

- [ ] `pnpm --filter @robota-sdk/agent-framework test` — all input-parser tests pass
- [ ] `pnpm --filter @robota-sdk/agent-transport typecheck` passes (uses framework import)
- [ ] No duplicate slash-detection logic remains in `agent-transport`
