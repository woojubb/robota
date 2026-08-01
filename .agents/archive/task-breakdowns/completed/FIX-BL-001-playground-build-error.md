---
title: Fix agent-playground build error — missing remote-client exports
status: backlog
created: 2026-03-30
priority: high
urgency: now
packages:
  - agent-playground
  - agent-remote-client
---

## Problem

`pnpm build` fails at `@robota-sdk/agent-playground` due to missing type exports from `@robota-sdk/agent-remote-client`.

## Error

```
packages/agent-playground build: src/lib/playground/websocket-client.ts(11,3): error TS2305: Module '"@robota-sdk/agent-remote-client"' has no exported member 'IPlaygroundWebSocketMessage'.
packages/agent-playground build: src/lib/playground/websocket-client.ts(12,3): error TS2305: Module '"@robota-sdk/agent-remote-client"' has no exported member 'TPlaygroundWebSocketMessageKind'.
```

## Location

`packages/agent-playground/src/lib/playground/websocket-client.ts` lines 11-16

## Fix Direction

1. Check if `IPlaygroundWebSocketMessage` and `TPlaygroundWebSocketMessageKind` were removed/renamed in `agent-remote-client`
2. Either restore the exports in `agent-remote-client` or update the imports in `agent-playground`
3. Verify full `pnpm build` passes after fix
