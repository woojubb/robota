---
title: ORCH-BL-011 Cost Meta Contract Normalization
status: backlog
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

- [ ] Inventory current cost-meta response shapes and error variants.
- [ ] Decide alias ownership between `dag-cost` and `dag-orchestration-client`.
- [ ] Normalize route responses to the Robota envelope where appropriate.
- [ ] Add tests for list/get/create/update/delete/validate/preview contracts.

## Acceptance Criteria

- [ ] Cost meta endpoint envelopes are documented and package-owned.
- [ ] Route-local `{ error }`/`{ errors }` variants are normalized or explicitly justified.
- [ ] CLI/MCP cost meta expansion is blocked until normalization is complete.

## Test Plan

- `pnpm --filter @robota-sdk/dag-cost test`
- `pnpm --filter @robota-sdk/dag-orchestration-client test`
- `pnpm --filter @robota-sdk/dag-orchestrator-server test`
- `pnpm docs:build`
