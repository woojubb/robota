---
title: ORCH-BL-008 Run Draft Operational Client Contracts
status: backlog
priority: medium
urgency: next
created: 2026-05-05
packages:
  - dag-core
  - dag-orchestration-client
  - dag-orchestrator-server
  - dag-cli
  - dag-mcp-server
---

# ORCH-BL-008 Run Draft Operational Client Contracts

## Objective

Promote run draft HTTP request/response aliases from route-local parsing into package-owned
contracts before adding CLI or MCP draft commands.

## Recommended Direction

Keep persisted draft domain ownership in `@robota-sdk/dag-core` (`IRunDraft`, reducers, store port).
Add HTTP aliases and `DagOrchestrationHttpClient` methods in `@robota-sdk/dag-orchestration-client`
for `/v1/dag/run-drafts*`. The server route should consume those aliases rather than defining a
parallel route-local envelope.

## Plan

- [ ] Extract save/overwrite/reset request aliases for run drafts.
- [ ] Add client methods for create/get/replace/reset/overwrite run draft endpoints.
- [ ] Update `dag-orchestrator-server` route types to consume the package-owned aliases.
- [ ] Add CLI/MCP expansion tasks only after the package contract and server tests are in place.

## Acceptance Criteria

- [ ] Run draft HTTP aliases are exported from `@robota-sdk/dag-orchestration-client`.
- [ ] `dag-orchestrator-server` routes no longer own reusable run draft request/response aliases.
- [ ] CLI/MCP do not consume route-local types.

## Test Plan

- `pnpm --filter @robota-sdk/dag-orchestration-client test`
- `pnpm --filter @robota-sdk/dag-orchestrator-server test`
- `pnpm harness:scan:deps`
- `pnpm docs:build`
