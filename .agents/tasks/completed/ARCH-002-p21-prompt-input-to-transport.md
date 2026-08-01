# ARCH-002-p21: Move promptInput (TPromptInput impl) to agent-transport/headless

## Status: done

## Problem

`packages/agent-cli/src/utils/cli-input.ts` (52 lines) implements `TPromptInput`
(the raw stdin character reader used for masked API key entry during provider setup).

It has **zero CLI-specific type dependencies** — only `TPromptInput` from `agent-command`
and native Node.js `process.stdin`/`process.stdout`. This is a terminal I/O adapter for
interactive TTY prompts — the same category as `PrintTerminal` which already moved to
`agent-transport/src/headless/`.

Per CLI-AUDIT-009: concrete I/O adapters are transport-layer concerns, not CLI concerns.

Current import in `cli.ts`:

```typescript
import { promptInput } from './utils/cli-input.js';
```

## Fix

1. Move `cli-input.ts` to `packages/agent-transport/src/headless/cli-input.ts`
   (rename exported symbol from `promptInput` to `createTtyPromptInput` or keep as-is
   — decide at implementation time based on `agent-command`'s `TPromptInput` contract).
2. Export `promptInput` from `packages/agent-transport/src/headless/index.ts`.
3. Update `packages/agent-cli/src/cli.ts` to import from
   `@robota-sdk/agent-transport/headless`.
4. Delete `packages/agent-cli/src/utils/cli-input.ts`.
5. Verify `agent-transport` already has `agent-command` as a (dev)dependency or add it.
6. Build and typecheck both packages; run tests.

## Dependency check

`agent-command` exports `TPromptInput`. Check whether `agent-transport` currently
depends on `agent-command`. If not, add it (or use structural typing to avoid the dep).

## Architecture map update

- Add `CLI-AUDIT-021` to layering-audit.md (new finding, immediately resolved)
