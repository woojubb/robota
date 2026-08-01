---
title: ORCH-BL-011 Cost Meta Contract Normalization
status: completed
priority: medium
urgency: next
created: 2026-05-05
packages:
  - dag-cost
  - dag-orchestration-client
  - dag-orchestrator-server
  - dag-cli
  - dag-mcp-server
---

# ORCH-BL-011 Cost Meta Contract Normalization

## Objective

Normalize `/v1/cost-meta*` HTTP envelopes and assign contract ownership before adding client methods
or CLI/MCP cost metadata operations.

## Recommended Direction

Keep cost domain types in `@robota-sdk/dag-cost`. Add HTTP request/response aliases either in
`dag-cost` when they are domain-level or in `dag-orchestration-client` when they are purely
transport/client aliases. Normalize success/error envelopes before any operational clients depend on
the route.

## Plan

- [x] Inventory current cost-meta response shapes and error variants.
- [x] Decide alias ownership between `dag-cost` and `dag-orchestration-client`.
- [x] Normalize route responses to the Robota envelope where appropriate.
- [x] Add tests for list/get/create/update/delete/validate/preview contracts.

## Acceptance Criteria

- [x] Cost meta endpoint envelopes are documented and package-owned.
- [x] Route-local `{ error }`/`{ errors }` variants are normalized or explicitly justified.
- [x] CLI/MCP cost meta expansion is blocked until normalization is complete.

## Progress

- `dag-cost` remains the owner for `ICostMeta` and CEL evaluator behavior.
- `dag-orchestration-client` now owns cost metadata HTTP aliases and client endpoint methods.
- `dag-orchestrator-server` cost metadata routes now return standard success/error envelopes.
- Formula validation returns a success envelope with validation data; preview failures return problem details because no numeric preview can be produced.

## Verification

- `pnpm --filter @robota-sdk/dag-cost test`
- `pnpm --filter @robota-sdk/dag-cost typecheck`
- `pnpm --filter @robota-sdk/dag-orchestration-client test`
- `pnpm --filter @robota-sdk/dag-orchestration-client lint`
- `pnpm --filter @robota-sdk/dag-orchestration-client typecheck`
- `pnpm --filter @robota-sdk/dag-orchestration-client build`
- `pnpm --filter @robota-sdk/dag-orchestrator-server test`
- `pnpm --filter @robota-sdk/dag-orchestrator-server lint` (existing warnings reduced to 21, 0 errors)
- `pnpm --filter @robota-sdk/dag-orchestrator-server typecheck`
- `pnpm --filter @robota-sdk/dag-orchestrator-server build`
- `pnpm --filter @robota-sdk/dag-cli typecheck`
- `pnpm --filter @robota-sdk/dag-mcp-server test`
- `pnpm --filter @robota-sdk/dag-mcp-server lint`
- `pnpm --filter @robota-sdk/dag-mcp-server typecheck`
- `pnpm docs:build`
- `pnpm harness:scan:deps`
- `pnpm harness:scan`
- `git diff --check`
- `pnpm harness:verify -- --base-ref origin/develop --skip-record-check`

## Test Plan

- `pnpm --filter @robota-sdk/dag-cost test`
- `pnpm --filter @robota-sdk/dag-orchestration-client test`
- `pnpm --filter @robota-sdk/dag-orchestrator-server test`
- `pnpm docs:build`
