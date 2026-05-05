---
title: ORCH-BL-012 Run Progress WebSocket Contract Tests
status: backlog
priority: medium
urgency: next
created: 2026-05-05
packages:
  - dag-core
  - dag-orchestrator-server
  - dag-designer
---

# ORCH-BL-012 Run Progress WebSocket Contract Tests

## Objective

Lock down `/v1/dag/runs/:id/ws` behavior before additional clients consume run progress events.

## Recommended Direction

Keep `TRunProgressEvent` ownership in `@robota-sdk/dag-core`. Treat the WebSocket route envelope as
`{ event: TRunProgressEvent }` and add server-side tests for connection lifecycle, buffering before
`dagRunId` resolution, terminal cleanup, and backend connection failure forwarding.

## Plan

- [ ] Add route-level WebSocket tests for successful progress forwarding.
- [ ] Add buffering tests for messages received before `dagRunId` resolution.
- [ ] Add terminal event cleanup tests.
- [ ] Add backend connection failure tests.

## Acceptance Criteria

- [ ] The WebSocket event envelope is tested and documented.
- [ ] `TRunProgressEvent` remains the event SSOT in `dag-core`.
- [ ] Designer or future clients can rely on the tested envelope without importing server internals.

## Test Plan

- `pnpm --filter @robota-sdk/dag-orchestrator-server test`
- `pnpm --filter @robota-sdk/dag-designer test`
- `pnpm docs:build`
