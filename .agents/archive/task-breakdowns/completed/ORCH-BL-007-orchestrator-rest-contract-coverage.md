---
title: ORCH-BL-007 Orchestrator REST Contract Coverage
status: completed
priority: medium
urgency: next
created: 2026-05-05
packages:
  - dag-api
  - dag-orchestration-client
  - dag-orchestrator-server
  - dag-cli
  - dag-mcp-server
---

# ORCH-BL-007 Orchestrator REST Contract Coverage

## Objective

Create a complete, source-backed inventory of `dag-orchestrator-server` REST/WebSocket contracts and
move reusable request/response contracts to the correct owner before expanding CLI or MCP surfaces.

## Problem

Definition, node catalog, and run lifecycle endpoints are now covered by the shared operational HTTP
client. Other endpoints remain route-local:

- run drafts;
- published workflow runs;
- assets;
- cost metadata;
- admin bootstrap;
- ComfyUI proxy endpoints;
- run progress WebSocket bridge.

Adding operational client commands/tools for those endpoints without a contract owner would duplicate
request/response semantics across server routes, CLI, MCP, and UI clients.

## Recommended Direction

Audit endpoint-by-endpoint ownership before implementation:

- reusable Robota `/v1/dag/*` contracts should be package-owned;
- pure ComfyUI proxy shapes can remain backend-native and documented as pass-through;
- WebSocket event envelopes should point to `dag-core` progress event ownership;
- CLI/MCP should expose only endpoints with stable package-owned contracts.

## Plan

- [x] Inventory every route in `apps/dag-orchestrator-server/src/routes`.
- [x] Map each endpoint to its current request/response type owner.
- [x] Identify which route-local types must move to a package contract.
- [x] Update docs/SPEC files with the endpoint ownership table.
- [x] Create follow-up implementation tasks for each endpoint group that needs contract extraction.
- [x] Add client/MCP expansion tasks only after the contract owner is explicit.

## Acceptance Criteria

- [x] Every orchestrator endpoint has a documented contract owner.
- [x] Route-local types that are safe to remain local are explicitly justified.
- [x] Client/MCP expansion work is blocked on package-owned contracts, not local route internals.
- [x] The repo-level architecture map references the endpoint contract policy.

## Test Plan

- `rg -n "router\\.(get|post|put|delete|patch)" apps/dag-orchestrator-server/src/routes`
- `pnpm --filter @robota-sdk/dag-orchestrator-server test`
- `pnpm harness:scan:specs`
- `pnpm docs:build`

## Progress

### 2026-05-05

- Inventoried orchestrator REST, runtime proxy, and WebSocket endpoints from source routes.
- Documented endpoint contract ownership in the orchestrator server SPEC and client coverage policy.
- Added implementation follow-up tasks for route groups that need reusable operational contracts.
- Updated the repo architecture map to reference the contract policy and follow-up sequence.

## Decisions

- Keep repository-wide architecture guidance centralized in `.agents/specs/ARCHITECTURE-MAP.md` and package-level contract truth in package `docs/SPEC.md` files.
- Avoid adding extra architecture documents unless the central map or package SPECs become too large to navigate.
- Treat CLI/MCP expansion as blocked until the endpoint group has package-owned request/response aliases.

## Result

The orchestrator endpoint inventory is complete and source-backed. Existing operational client coverage
is documented as active, route-local endpoint groups are explicitly blocked from CLI/MCP expansion, and
follow-up implementation tasks were added for run drafts, published workflow runs, assets, cost metadata,
and run progress WebSocket contracts.

## Verification

- `rg -n "router\\.(get|post|put|delete|patch)" apps/dag-orchestrator-server/src/routes`
- `pnpm --filter @robota-sdk/dag-orchestrator-server test`
- `pnpm harness:scan:specs`
- `pnpm docs:build`
- `pnpm harness:scan`
- `git diff --check`
