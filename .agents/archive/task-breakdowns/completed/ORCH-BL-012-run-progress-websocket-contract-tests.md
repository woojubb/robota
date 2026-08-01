---
title: ORCH-BL-012 Run Progress WebSocket Contract Tests
status: completed
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

- [x] Add route-level WebSocket tests for successful progress forwarding.
- [x] Add buffering tests for messages received before `dagRunId` resolution.
- [x] Add terminal event cleanup tests.
- [x] Add backend connection failure tests.

## Progress

### 2026-05-05

- Started implementation on `feat/run-progress-websocket-contract-tests`.
- Added `src/__tests__/ws-routes.test.ts` with public WebSocket route contract coverage.
- Fixed `OrchestratorRunService.getDagRunId(id)` to resolve started `dagRunId` inputs as documented by the WebSocket route contract.

## Decisions

- Keep repo-wide architecture notes centralized in `.agents/specs/ARCHITECTURE-MAP.md`.
- Keep package-specific WebSocket route contract details in `apps/dag-orchestrator-server/docs/SPEC.md`.
- Do not add extra architecture documents for this task unless the architecture map becomes too large to navigate.
- Test the route through real HTTP upgrade and WebSocket connections instead of exporting route internals.
- Preserve the documented `:id` flexibility by accepting both `preparationId` and post-start `dagRunId` in `getDagRunId(id)`.

## Acceptance Criteria

- [x] The WebSocket event envelope is tested and documented.
- [x] `TRunProgressEvent` remains the event SSOT in `dag-core`.
- [x] Designer or future clients can rely on the tested envelope without importing server internals.

## Test Plan

- `pnpm --filter @robota-sdk/dag-orchestrator-server test`
- `pnpm --filter @robota-sdk/dag-designer test`
- `pnpm docs:build`

## Result

Completed. Added public route-level WebSocket contract tests for forwarding, buffering, terminal
cleanup, and backend failure forwarding. Fixed `OrchestratorRunService.getDagRunId(id)` so the
documented `preparationId` or post-start `dagRunId` URL contract both resolve correctly. Updated
the server and orchestrator SPECs plus the architecture map without adding extra documentation
files.
