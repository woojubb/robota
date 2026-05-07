---
title: INFRA-BL-012 Architecture Map System Audit and Target Refactor Plan
status: completed
priority: high
urgency: next
created: 2026-05-05
packages:
  - agent-cli
  - agent-sdk
  - dag-api
  - dag-cli
  - dag-mcp-server
  - dag-orchestrator-server
---

# INFRA-BL-012 Architecture Map System Audit and Target Refactor Plan

## Objective

Update the relevant `ARCHITECTURE-MAP.md` documentation with the newly introduced structure, then use
that source-backed map to audit the actual system architecture: package layers, ownership boundaries,
dependency edges, class/interface contracts, and cross-package responsibilities. The goal is a better
architecture plan, not merely a cleaner document layout.

## Problem

Recent work added and changed architecture-relevant structure:

- CLI built-in command packages and SDK command/common API ownership.
- Provider/model state flow and provider model catalog ownership.
- `@robota-sdk/dag-cli` as an orchestration API command-line client.
- `@robota-sdk/dag-mcp-server` as an MCP surface for orchestration API operations.
- `@robota-sdk/dag-api` as the shared orchestration HTTP client owner.
- Deployment and docs publishing changes around Cloudflare Pages and release workflow expectations.

The current package-local `packages/agent-cli/docs/ARCHITECTURE-MAP.md` is CLI-focused. The
repository needs a master `ARCHITECTURE-MAP.md` that can include all major structures while keeping
the existing CLI map as a companion detail map.

## Recommended Direction

Use a master-plus-companion architecture-map model:

1. Keep `.agents/specs/ARCHITECTURE-MAP.md` as the repository-wide master map that may include all
   major repo structures.
2. Keep `packages/agent-cli/docs/ARCHITECTURE-MAP.md` as a companion detail map for dense CLI
   internals.
3. Avoid creating additional architecture files unless a section becomes too large to scan.
4. Link the master map from `.agents/project-structure.md` so future agents can find it before
   refactoring package boundaries.

This keeps documentation distribution minimal while still preventing one package-local map from
silently acting as the whole repository architecture root.

## Plan

- [x] Verify current maps against source imports, package manifests, package `docs/SPEC.md` files,
      and `.agents/project-structure.md`.
- [x] Update `packages/agent-cli/docs/ARCHITECTURE-MAP.md` for all new CLI-relevant command, SDK,
      provider/model, session, runtime, and host-adapter structure.
- [x] Decide, from source evidence, whether a master `.agents/specs/ARCHITECTURE-MAP.md` is
      required for full repository architecture.
- [x] Create the master map with LLM-scannable diagrams, dependency trees, and
      explicit ownership tables.
- [x] Audit contradictions in the actual architecture:
      forbidden or surprising dependency edges, duplicated contracts, pass-through ownership,
      UI concerns leaking into SDK/session layers, runtime concerns bypassing ports, and deployment
      workflow ownership drift.
- [x] Recommend the target architecture with explicit layer ownership and allowed dependency edges.
- [x] Update architecture docs to describe both the verified current state and the recommended
      target architecture.
- [x] Split confirmed refactors into actionable follow-up backlog items with package/file scope,
      acceptance criteria, and verification commands.
- [x] Update repository rules or common-mistakes guidance only for durable lessons that should apply
      beyond this task.

## Acceptance Criteria

- [x] The relevant `ARCHITECTURE-MAP.md` file or files reflect the latest CLI, SDK, DAG CLI, DAG MCP,
      shared orchestration API client, and deployment/doc publishing structure.
- [x] The audit distinguishes document-structure improvements from actual architecture improvements.
- [x] The target architecture identifies the correct owner for each cross-package contract.
- [x] Package boundaries are checked against source imports, package manifests, and package specs.
- [x] Any recommended refactor is backed by a specific contradiction or maintainability risk.
- [x] Follow-up refactor backlog items are created for every confirmed system change.
- [x] The architecture map includes an update policy for future package composition changes.

## Test Plan

- `rg -n "from '@robota-sdk|from \"@robota-sdk" packages apps`
- `pnpm harness:scan:deps`
- `pnpm harness:scan:commands`
- `pnpm harness:scan:specs`
- `pnpm docs:build`

If implementation refactors are included in a later task, also run affected package
`test`, `typecheck`, `lint`, and `build` commands plus `pnpm harness:verify -- --base-ref origin/develop --skip-record-check`.

## Notes

- Do not edit generated `content/api-reference/**` output while updating docs.
- Do not preserve legacy layering if a cleaner beta architecture is available and verified.
- Do not treat `agent-cli` as the owner of reusable command, provider, orchestration, session,
  runtime, MCP, or deployment contracts.

## Progress

### 2026-05-05

- Source-verified relevant imports, package manifests, package specs, and project structure.
- Recommended a master `.agents/specs/ARCHITECTURE-MAP.md` because the scope spans CLI, SDK, DAG
  orchestration, MCP, apps, and docs deployment.
- Kept `packages/agent-cli/docs/ARCHITECTURE-MAP.md` as a companion detail map and linked it to the
  master map.
- Identified `dag-api` operational client ownership as accepted debt and split follow-up refactors
  into `ORCH-BL-006` and `ORCH-BL-007`.

## Decisions

- Repo-wide architecture belongs in `.agents/specs/ARCHITECTURE-MAP.md`.
- Additional architecture files should be minimized and used only as companion detail maps for large
  subsystems.
- `dag-api` can keep the shared HTTP client for the current beta slice, but the target architecture
  moves it to a dedicated operational client/contracts package.

## Result

- Added `.agents/specs/ARCHITECTURE-MAP.md` as the repo-wide master architecture map.
- Updated `packages/agent-cli/docs/ARCHITECTURE-MAP.md` to reference the master map while remaining
  the CLI companion detail map.
- Updated `.agents/project-structure.md` and `.agents/specs/README.md` to route future readers to
  the master architecture map.
- Created `ORCH-BL-006` and `ORCH-BL-007` for the confirmed orchestration client-contract follow-up
  work.
