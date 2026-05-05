---
title: ORCH-BL-007 Orchestrator REST Contract Coverage
status: backlog
priority: medium
urgency: next
created: 2026-05-05
packages:
  - dag-api
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

- [ ] Inventory every route in `apps/dag-orchestrator-server/src/routes`.
- [ ] Map each endpoint to its current request/response type owner.
- [ ] Identify which route-local types must move to a package contract.
- [ ] Update docs/SPEC files with the endpoint ownership table.
- [ ] Create follow-up implementation tasks for each endpoint group that needs contract extraction.
- [ ] Add client/MCP expansion tasks only after the contract owner is explicit.

## Acceptance Criteria

- [ ] Every orchestrator endpoint has a documented contract owner.
- [ ] Route-local types that are safe to remain local are explicitly justified.
- [ ] Client/MCP expansion work is blocked on package-owned contracts, not local route internals.
- [ ] The repo-level architecture map references the endpoint contract policy.

## Test Plan

- `rg -n "router\\.(get|post|put|delete|patch)" apps/dag-orchestrator-server/src/routes`
- `pnpm --filter @robota-sdk/dag-orchestrator-server test`
- `pnpm harness:scan:specs`
- `pnpm docs:build`
