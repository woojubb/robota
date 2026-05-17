# ARCH-001 — Define React Package Boundaries and Extract TUI from agent-transport

## Status

`done`

## Problem

`agent-transport` contained TUI (React + Ink) code mixed with pure-TS protocol transports (headless, HTTP, WebSocket, MCP). A package that serves multiple transport modalities must not silently pull React into consumer bundles.

## Resolution

TUI code stays in `agent-transport` but is **isolated to the `./tui` sub-path**. Pure-TS consumers import only `/headless`, `/http`, `/ws`, or `/mcp` and receive zero React/Ink. The root `index.ts` re-exports everything including TUI for convenience.

A brief detour to a separate `agent-transport-tui` package was reverted — the subpath approach achieves the same isolation goal without an extra package in the graph.

### Final structure

```
@robota-sdk/agent-transport
  ./headless   — pure TS
  ./http       — pure TS
  ./ws         — pure TS
  ./mcp        — pure TS
  ./tui        — React + Ink (TuiTransport, Ink components)
```

### Import convention

```typescript
// TUI-specific (React/Ink consumers)
import { TuiTransport } from '@robota-sdk/agent-transport/tui';

// Protocol transports (pure TS, React-free)
import { createHeadlessTransport } from '@robota-sdk/agent-transport/headless';
```

## Test Evidence

- `pnpm --filter @robota-sdk/agent-transport typecheck` — pass
- `pnpm --filter @robota-sdk/agent-transport test` — 48 files, 403 tests pass
- `pnpm --filter @robota-sdk/agent-cli typecheck` — pass
- `pnpm --filter @robota-sdk/agent-cli test` — 16 files, 145 tests pass

## Delivered in

Branch `refactor/arch-001-tui-subpath-revert` (2026-05-17)
