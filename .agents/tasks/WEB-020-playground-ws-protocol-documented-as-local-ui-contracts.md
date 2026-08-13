---
title: 'WEB-020: agent-playground''s WebSocket message types are a cross-app wire protocol (apps/agent-server compiles against them) but are documented as "local UI contracts", and the real export surface is absent from the SPEC'
status: todo
created: 2026-08-13
priority: low
urgency: later
area: packages/agent-playground, apps/agent-server
depends_on: []
---

# WEB-020: playground WS protocol ownership is mislabeled

## Problem

`agent-playground` documents its WebSocket message types as "local UI contracts", but both ends of a
cross-app protocol compile against them — `apps/agent-server` imports them as the server side — so they
are a shared wire contract, not a local UI type. The SPEC's public-API table also omits the
service-layer surface the server relies on.

## Evidence

- `packages/agent-playground/docs/SPEC.md:11-12` — "playground WebSocket message types are local UI
  contracts in `src/lib/playground/types.ts`"; `:76-80` public-API table lists only `PlaygroundApp`,
  `PlaygroundDemo`, `PlaygroundExecutor`.
- `apps/agent-server/src/websocket-server.ts:7-10` — imports `IPlaygroundWebSocketMessage`,
  `TPlaygroundWebSocketMessageKind` from `@robota-sdk/agent-playground` (the server side of the
  protocol); the root entry wildcard-exports the whole services surface
  (`src/index.ts` → `src/playground/index.ts` → `services/index.ts:1-21`).

## Direction

Doc-side minimum: document the WS message family as the protocol SSOT with agent-server named as a
consumer, and list the real root-entry surface in the SPEC. Longer-term code-side option (only if the
playground surface is retained post-WEB-005): move the protocol types to a shared contract package per
the Interface Package Rule, so a private product-shell package does not own a cross-app wire protocol.

## Test Plan

- Doc-side: the SPEC names the WS protocol as shared with `apps/agent-server` and the public-API table
  matches the root-entry exports.
- Code-side (if taken): the protocol types live in a shared package both sides import; `rg` shows no
  cross-app import of playground internals.
- `pnpm harness:scan` green.

## User Execution Test Scenarios

Not applicable if resolved doc-side (documentation of the existing protocol boundary). If the types
are relocated (code-side), the playground round-trip over the agent-server WebSocket is the executable
check — specify under that option; coordinate with WEB-005.
