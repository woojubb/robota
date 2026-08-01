---
title: ORCH-BL-008 Run Draft Operational Client Contracts
status: completed
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

- [x] Extract save/overwrite/reset request aliases for run drafts.
- [x] Add client methods for create/get/replace/reset/overwrite run draft endpoints.
- [x] Update `dag-orchestrator-server` route types to consume the package-owned aliases.
- [x] Add CLI/MCP expansion tasks only after the package contract and server tests are in place.

## Acceptance Criteria

- [x] Run draft HTTP aliases are exported from `@robota-sdk/dag-orchestration-client`.
- [x] `dag-orchestrator-server` routes no longer own reusable run draft request/response aliases.
- [x] CLI/MCP do not consume route-local types.

## Test Plan

- `pnpm --filter @robota-sdk/dag-orchestration-client test`
- `pnpm --filter @robota-sdk/dag-orchestrator-server test`
- `pnpm harness:scan:deps`
- `pnpm docs:build`

## Progress

### 2026-05-05

- Started from `develop` on branch `feat/run-draft-operational-contracts`.
- Selected `dag-orchestration-client` as the HTTP contract owner while leaving persisted draft domain types in `dag-core`.
- Added shared run draft HTTP aliases and endpoint methods to `DagOrchestrationHttpClient`.
- Updated server route typings and route tests to consume the package-owned success envelope.
- Added follow-up CLI/MCP expansion task `ORCH-BL-013`.

## Decisions

- `dag-core` remains the SSOT for persisted run draft state and reducers.
- `dag-orchestration-client` owns reusable HTTP request/response aliases and endpoint path methods.
- CLI/MCP command expansion remains out of scope until this contract layer is verified.

## Result

Run draft HTTP contracts are now package-owned by `@robota-sdk/dag-orchestration-client`.
`DagOrchestrationHttpClient` exposes create/get/replace/reset/overwrite methods, and
`dag-orchestrator-server` consumes the shared request/success-envelope types through type-only
imports. CLI/MCP command expansion is tracked separately in `ORCH-BL-013`.

## Verification

- `pnpm --filter @robota-sdk/dag-orchestration-client test`
- `pnpm --filter @robota-sdk/dag-orchestration-client typecheck`
- `pnpm --filter @robota-sdk/dag-orchestration-client lint`
- `pnpm --filter @robota-sdk/dag-orchestration-client build`
- `pnpm --filter @robota-sdk/dag-orchestrator-server test`
- `pnpm --filter @robota-sdk/dag-orchestrator-server typecheck`
- `pnpm --filter @robota-sdk/dag-orchestrator-server lint`
- `pnpm --filter @robota-sdk/dag-orchestrator-server build`
- `pnpm harness:scan:deps`
- `pnpm docs:build`
- `pnpm harness:scan`
- `git diff --check`
