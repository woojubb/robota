# ARCH-002-p17: Move PrintTerminal to agent-transport/headless

## Status: todo

## Problem

`packages/agent-cli/src/print-terminal.ts` (56 lines) implements `ITerminalOutput`
using Node.js `readline` and `process.stdout`/`stderr`. This is a terminal I/O adapter
for print/headless mode — the same category as `HeadlessTransport` which already lives in
`packages/agent-transport/src/headless/`.

Per CLI-AUDIT-009: CLI must not own transport-visible contracts. `ITerminalOutput` is a
core contract, and the stdio implementation is a transport-layer adapter — not CLI logic.

Current import in `print-mode.ts`:

```typescript
import { PrintTerminal } from '../print-terminal.js';
```

## Fix

1. Move file to `packages/agent-transport/src/headless/print-terminal.ts`
2. Export `PrintTerminal` from `packages/agent-transport/src/headless/index.ts`
3. Update `packages/agent-cli/src/modes/print-mode.ts` to import from
   `@robota-sdk/agent-transport/headless`
4. Delete `packages/agent-cli/src/print-terminal.ts`
5. Add `PrintTerminal` to agent-transport `./headless` subpath exports in `package.json`
   if not already covered by the existing barrel

## Architecture map update

- Add `CLI-AUDIT-018` to layering-audit.md (new finding, immediately resolved)
