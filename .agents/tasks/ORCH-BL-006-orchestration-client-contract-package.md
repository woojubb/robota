---
title: ORCH-BL-006 Orchestration Client Contract Package
status: backlog
priority: high
urgency: next
created: 2026-05-05
packages:
  - dag-api
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

Create a package such as `@robota-sdk/dag-orchestration-client` or
`@robota-sdk/dag-orchestration-contracts` that owns:

- orchestrator endpoint request/response contracts for operational clients;
- `DagOrchestrationHttpClient` or its replacement;
- error envelope parsing for server-originated `IProblemDetails`;
- shared server URL resolution helpers if they can remain UI-neutral.

Keep `dag-api` focused on controller/composition concerns.

## Plan

- [ ] Verify current imports and package manifests for `dag-api`, `dag-cli`, and `dag-mcp-server`.
- [ ] Choose the package name based on whether the first slice includes only client code or both
      client code and endpoint contracts.
- [ ] Move `DagOrchestrationHttpClient` and tests to the new package.
- [ ] Update `dag-cli` and `dag-mcp-server` to consume the new package.
- [ ] Update package SPECs, project structure, docs, and changesets.
- [ ] Add a dependency-direction check if needed to prevent operational clients from importing
      server-side controller composition packages.

## Acceptance Criteria

- [ ] `dag-cli` and `dag-mcp-server` no longer import `@robota-sdk/dag-api` for the operational HTTP
      client.
- [ ] `dag-api` remains the owner of server-side controller contracts and composition only.
- [ ] The new package has `docs/SPEC.md`, `docs/README.md`, tests, and publish metadata.
- [ ] The repo-level architecture map reflects the final package edge.

## Test Plan

- `pnpm --filter @robota-sdk/dag-orchestration-client test`
- `pnpm --filter @robota-sdk/dag-cli test`
- `pnpm --filter @robota-sdk/dag-mcp-server test`
- `pnpm harness:scan:deps`
- `pnpm harness:scan:specs`
- `pnpm docs:build`
