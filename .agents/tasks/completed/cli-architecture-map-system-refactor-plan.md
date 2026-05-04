# CLI Architecture Map System Refactor Plan

- **Status**: completed
- **Created**: 2026-05-05
- **Branch**: docs/cli-architecture-target-plan
- **Scope**: packages/agent-cli, packages/agent-sdk, packages/agent-command-\*, .agents/backlog

## Objective

Use `packages/agent-cli/docs/ARCHITECTURE-MAP.md` as a source-backed architecture audit input, then
document the target CLI architecture and split confirmed structural work into actionable refactor
backlogs.

## Plan

- [x] Verify current architecture map against source imports, manifests, and package specs.
- [x] Identify architecture contradictions and owner-package mismatches.
- [x] Document the recommended target architecture and migration direction in `ARCHITECTURE-MAP.md`.
- [x] Create concrete follow-up backlogs for each structural refactor.
- [x] Mark the original backlog completed and archive this task.
- [x] Run documentation and harness verification.

## Progress

### 2026-05-05

- Started from `develop` on branch `docs/cli-architecture-target-plan`.
- Re-verified CLI/SDK/command/provider boundaries against package specs, manifests, and source
  imports.
- Updated `ARCHITECTURE-MAP.md` with target architecture, migration order, and source-backed audit
  findings.
- Split confirmed structural work into command effect, command shim, runtime adapter, provider
  catalog refresh, and SDK public surface backlog items.
- Archived the source backlog item under `.agents/backlog/completed/`.
- Verified docs build and architecture/backlog harness scans.

## Decisions

- Treat this as an architecture audit and refactor planning task, not a documentation-format cleanup.
- No new rule update is needed in this task; architecture-map sync is already covered by
  `spec-workflow.md`, `documentation-sync.md`, and `common-mistakes.md`.

## Blockers

- None.

## Test Plan

- Run `pnpm docs:build` because the architecture map is copied into the docs site.
- Run `pnpm harness:scan:commands`, `pnpm harness:scan:deps`, `pnpm harness:scan:specs`,
  `pnpm harness:scan:test-plans`, and `pnpm harness:scan:consistency` because this task changes
  architecture, backlog, and task-tracking documents.
- Run `git diff --check` to catch whitespace and patch formatting issues.

## Result

Completed. The CLI architecture map now documents the recommended target architecture, identifies
source-backed structural debts, and points each confirmed refactor to a dedicated backlog item.
