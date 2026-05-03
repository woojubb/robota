# Reversible Agent Sandbox

- **Status**: completed
- **Completed**: 2026-05-03
- **Branch**: feat/reversible-agent-sandbox

## What

Implement a sandbox-backed execution mode that lets Robota make file changes and run commands while preserving a reliable way to inspect, accept, or roll back those changes.

## Why

Robota can already create edit checkpoints for file mutations, but users need stronger safety: even if the agent edits files or runs commands, the work should remain recoverable. A sandbox/reversible workspace layer should make "try changes, verify them, and revert if needed" a first-class capability instead of relying only on manual Git cleanup.

## Relationship to Existing Work

- `.agents/tasks/INFRA-BL-002-agent-sandbox-execution.md` tracks provider-backed sandbox execution.
- `.agents/tasks/INFRA-BL-003-agent-workspace-manifest.md` tracks declarative workspace setup.
- `.agents/tasks/INFRA-BL-004-agent-snapshot-hydration.md` tracks provider snapshot/restore.
- `.agents/specs/self-hosting-loop-verification.md` defines checkpoint, atomic edit, verify, and recover behavior for self-hosting loops.
- `packages/agent-sdk/src/checkpoints` already owns edit checkpoint storage and `/rewind` restore behavior.

## Scope

- Decide the first reversible layer:
  - local edit checkpoints only;
  - Git worktree or branch isolation;
  - provider sandbox snapshot/restore;
  - or a composed local-first strategy.
- Define a clear lifecycle: create checkpoint, apply edits, run commands, verify, accept, rollback, cleanup.
- Keep filesystem mutation semantics in tool/SDK-owned contracts, not CLI renderer code.
- Ensure Bash/process side effects are either isolated or explicitly marked as not checkpoint-restorable.
- Integrate with `/rewind` or a successor command so users can list and restore safe points.
- Record enough metadata to explain which files changed, which commands ran, and what can be rolled back.
- Define how sandbox mode interacts with permissions, worktrees, and session resume.

## Recommendation

Use a local-first reversible mode before adding provider-backed sandbox snapshots.

Recommended first slice:

1. Create an SDK-owned edit checkpoint before the first file mutation in a turn.
2. Run write-capable agent jobs in a Git worktree when worktree support is available and hardened.
3. Treat file edits as rollback-capable through checkpoints.
4. Treat shell/process side effects as rollback-capable only when they are contained inside an isolated worktree or sandbox.
5. Surface a clear "accept / rollback / preserve workspace" result after verification.

Rationale: the repository already has edit checkpoint storage and initial worktree isolation. Provider sandboxes add external lifecycle, billing, and snapshot semantics, so they should follow after the local guarantees are clear and testable.

## Non-Goals

- Do not claim host-level shell side effects are reversible unless they are actually isolated.
- Do not put sandbox provider SDKs into `agent-core`.
- Do not make the CLI own checkpoint storage or restore ordering.
- Do not remove direct local execution until sandbox behavior is proven and migration is planned.

## Acceptance Criteria

- [x] A documented reversible execution mode exists with clear guarantees and limitations.
- [x] Before the first file mutation in a turn, Robota creates a recoverable checkpoint or isolated workspace.
- [x] Users can inspect pending changes before accepting or rolling back.
- [x] Rollback restores tracked file edits deterministically.
- [x] Non-reversible side effects are prevented by sandbox isolation or surfaced clearly before execution.
- [x] Tests cover successful rollback, failed rollback, command side effects, and cleanup behavior.

## Completion Notes

- Added SDK checkpoint inspection contracts and `EditCheckpointStore.inspect()`.
- Added `/rewind inspect <checkpoint-id>` through command common APIs and the product-composed rewind command module.
- Added opt-in `reversibleExecution: { mode: 'local-first' }` policy wrapping that blocks untracked host shell/process side effects before execution unless they are isolated.
- Classified `Write`/`Edit` as checkpoint-reversible, worktree-isolated `Agent` jobs as worktree-reversible, read-only tools as no-op for rollback, and foreground host `Bash` as requiring isolation.
- Provider sandbox snapshots remain a future isolation backend behind the SDK policy contract.

## Test Plan

- Add contract tests for checkpoint creation, restore, and cleanup.
- Add integration tests that mutate multiple files, run verification, and restore the previous state.
- Add tests that prove Bash side effects are isolated or explicitly rejected in reversible mode.
- Run affected package tests, build, and `pnpm harness:scan` before implementation promotion.

## Promotion Path

1. Move to `.agents/tasks/INFRA-BL-0XX-reversible-agent-sandbox.md`.
2. Reconcile with `INFRA-BL-002`, `INFRA-BL-003`, `INFRA-BL-004`, and `self-hosting-loop-verification.md`.
3. Ship a local-first reversible mode before adding provider-backed snapshot hydration.
