# CLI Runtime Adapter Boundary Audit

- **Status**: completed
- **Created**: 2026-05-05
- **Branch**: refactor/cli-runtime-adapter-boundary
- **Scope**: packages/agent-cli, packages/agent-runtime, packages/agent-sdk, scripts/harness

## Objective

Classify the CLI-owned background/subagent/worktree runtime files and move reusable contracts or pure lifecycle logic to the owning runtime/SDK boundary. Keep `agent-cli` as the concrete terminal-host adapter layer and preserve current behavior with characterization tests before extraction.

## Plan

- [x] Audit CLI background/subagent files, runtime/SDK contracts, specs, and tests.
- [x] Classify each file as CLI adapter, SDK facade/port, or runtime primitive.
- [x] Add missing characterization coverage before extraction.
- [x] Move reusable contracts or pure lifecycle logic to the owning package.
- [x] Keep concrete Node child-process and terminal executable resolution in `agent-cli`.
- [x] Update `ARCHITECTURE-MAP.md`, affected `SPEC.md` files, backlog records, and harness guards.
- [x] Run targeted verification and root build.

## Progress

### 2026-05-05

- Started from `develop` on `refactor/cli-runtime-adapter-boundary`.
- Classified CLI runtime files and chose to keep Node child process, worker IPC, worker
  reconstruction, and Git filesystem I/O in `agent-cli`.
- Moved bounded output capture, source-prefixed log projection, and cursor-based log pagination to
  `agent-runtime` with SDK facade re-exports for CLI consumption.
- Updated `agent-cli`, `agent-runtime`, and `agent-sdk` specs plus the CLI architecture map.
- Ran targeted tests/typechecks and root monorepo build.
- Ran affected package tests/lints, docs build, dependency/command/test-plan harness scans, full
  harness scan, and diff hygiene.

## Decisions

- Keep `agent-cli` importing runtime contracts through `@robota-sdk/agent-sdk` re-exports because
  the current SDK SPEC discourages direct `agent-cli -> agent-runtime` imports.
- Do not move child-process spawning, worker executable resolution, child IPC protocol, or Git
  worktree I/O out of `agent-cli` in this backlog; those are concrete terminal-host adapters.

## Test Plan

- Run targeted CLI subagent/worktree/background tests before and after extraction.
- Run agent-runtime tests for moved runtime primitives.
- Run agent-sdk tests if SDK facade or public contract imports change.
- Run command/dependency harness scans, affected package typechecks/lints/tests, docs build, root
  monorepo build, and diff hygiene.

## Blockers

- (none)

## Result

Resolved the owner boundary audit. Runtime-owned log helpers now live in
`packages/agent-runtime/src/background-tasks/log-pages.ts`, are re-exported by `agent-runtime` and
`agent-sdk`, and are used by CLI process/subagent adapters. CLI runtime files are classified in
`packages/agent-cli/docs/ARCHITECTURE-MAP.md`.

Verification passed:

- `pnpm build`
- `pnpm --filter @robota-sdk/agent-runtime test -- log-pages`
- `pnpm --filter @robota-sdk/agent-cli test -- managed-shell child-process-subagent-runner`
- `pnpm --filter @robota-sdk/agent-runtime typecheck`
- `pnpm --filter @robota-sdk/agent-sdk typecheck`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
- `pnpm --filter @robota-sdk/agent-cli test`
- `pnpm --filter @robota-sdk/agent-runtime test`
- `pnpm --filter @robota-sdk/agent-sdk test`
- `pnpm --filter @robota-sdk/agent-cli lint`
- `pnpm --filter @robota-sdk/agent-runtime lint`
- `pnpm --filter @robota-sdk/agent-sdk lint`
- `pnpm docs:build`
- `pnpm harness:scan:commands`
- `pnpm harness:scan:deps`
- `pnpm harness:scan:test-plans`
- `pnpm harness:scan`
- `git diff --check`
