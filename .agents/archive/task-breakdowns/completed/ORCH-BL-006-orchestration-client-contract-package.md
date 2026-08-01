---
title: ORCH-BL-006 Orchestration Client Contract Package
status: completed
priority: high
urgency: next
created: 2026-05-05
packages:
  - dag-api
  - dag-orchestration-client
  - dag-cli
  - dag-mcp-server
---

# ORCH-BL-006 Orchestration Client Contract Package

## Objective

Move operational orchestrator REST client contracts out of `@robota-sdk/dag-api` into a dedicated
thin client/contracts package so `dag-cli` and `dag-mcp-server` do not depend on server-side
controller composition dependencies.

## Problem

`@robota-sdk/dag-api` currently owns both API controllers/composition and `DagOrchestrationHttpClient`.
That avoided duplicate endpoint calls, but thin operational clients now depend on a package that also
depends on runtime, projection, scheduler, and worker layers.

## Recommended Direction

Create `@robota-sdk/dag-orchestration-client` because the first slice owns both a thin HTTP client
and the operational endpoint payload contracts that client consumes. The package owns:

- orchestrator endpoint request/response contracts for operational clients;
- `DagOrchestrationHttpClient` or its replacement;
- error envelope parsing for server-originated `IProblemDetails`;
- shared server URL resolution helpers if they can remain UI-neutral.

Keep `dag-api` focused on controller/composition concerns.

## Plan

- [x] Verify current imports and package manifests for `dag-api`, `dag-cli`, and `dag-mcp-server`.
- [x] Choose the package name based on whether the first slice includes only client code or both
      client code and endpoint contracts.
- [x] Move `DagOrchestrationHttpClient` and tests to the new package.
- [x] Update `dag-cli` and `dag-mcp-server` to consume the new package.
- [x] Update package SPECs, project structure, docs, and changesets.
- [x] Add a dependency-direction check if needed to prevent operational clients from importing
      server-side controller composition packages.

## Progress

- Decision: use `@robota-sdk/dag-orchestration-client`, not `dag-orchestration-contracts`, because
  the immediate owner is an executable thin client plus operational payload contracts.
- Decision: keep canonical server-side `IProblemDetails` in `@robota-sdk/dag-api`; the new package
  exposes `IOrchestrationProblemDetails` as a structural client-facing payload shape until
  `ORCH-BL-007` completes endpoint-by-endpoint contract ownership.
- Added dependency-direction harness rules that reject `dag-cli -> dag-api` and
  `dag-mcp-server -> dag-api` production dependencies.

## Acceptance Criteria

- [x] `dag-cli` and `dag-mcp-server` no longer import `@robota-sdk/dag-api` for the operational HTTP
      client.
- [x] `dag-api` remains the owner of server-side controller contracts and composition only.
- [x] The new package has `docs/SPEC.md`, `docs/README.md`, tests, and publish metadata.
- [x] The repo-level architecture map reflects the final package edge.

## Result

Completed in `refactor/dag-orchestration-client-package`.

- Added `@robota-sdk/dag-orchestration-client`.
- Moved `DagOrchestrationHttpClient` and tests from `dag-api` into the new thin package.
- Updated `dag-cli` and `dag-mcp-server` imports and manifests to consume the new package.
- Updated package SPECs, project structure, repo architecture map, changeset config, and lockfile via
  `pnpm install`.
- Added dependency-direction harness coverage to prevent operational clients from re-importing
  `dag-api` for production dependencies.

## Test Plan

- `pnpm --filter @robota-sdk/dag-orchestration-client test`
- `pnpm --filter @robota-sdk/dag-cli test`
- `pnpm --filter @robota-sdk/dag-mcp-server test`
- `pnpm harness:scan:deps`
- `pnpm harness:scan:specs`
- `pnpm docs:build`

## Verification

- `pnpm --filter @robota-sdk/dag-orchestration-client test`
- `pnpm --filter @robota-sdk/dag-orchestration-client typecheck`
- `pnpm --filter @robota-sdk/dag-orchestration-client lint`
- `pnpm --filter @robota-sdk/dag-orchestration-client build`
- `pnpm --filter @robota-sdk/dag-api test`
- `pnpm --filter @robota-sdk/dag-api typecheck`
- `pnpm --filter @robota-sdk/dag-api lint` (existing warnings only)
- `pnpm --filter @robota-sdk/dag-api build`
- `pnpm --filter @robota-sdk/dag-cli test`
- `pnpm --filter @robota-sdk/dag-cli typecheck`
- `pnpm --filter @robota-sdk/dag-cli lint`
- `pnpm --filter @robota-sdk/dag-cli build`
- `pnpm --filter @robota-sdk/dag-mcp-server test`
- `pnpm --filter @robota-sdk/dag-mcp-server typecheck`
- `pnpm --filter @robota-sdk/dag-mcp-server lint`
- `pnpm --filter @robota-sdk/dag-mcp-server build`
- `pnpm harness:scan`
- `pnpm docs:build`
- `pnpm harness:verify -- --base-ref origin/develop --skip-record-check`
