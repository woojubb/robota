# Reversible Agent Sandbox

- **Status**: completed
- **Created**: 2026-05-03
- **Branch**: feat/reversible-agent-sandbox
- **Scope**: packages/agent-sdk, packages/agent-command-rewind, .agents

## Objective

Ship the first local-first reversible execution layer by making checkpoint contents inspectable, documenting reversible guarantees, and defining SDK-owned safety metadata for file edits, shell commands, and worktree-isolated agent jobs.

## Plan

- [x] Review existing checkpoint, rewind, worktree, and sandbox backlog contracts.
- [x] Add SDK checkpoint inspection contracts and deterministic store behavior.
- [x] Add SDK reversible execution safety classification for file, shell, and agent execution.
- [x] Expose checkpoint inspection through command common APIs and `/rewind inspect`.
- [x] Update package specs and archive the backlog item with decisions and limitations.
- [x] Run targeted package tests, typecheck, build, harness scan, and root build.
- [x] Prepare branch for commit, PR, CI, and merge into `develop`.

## Test Plan

Verify the changed SDK and command surfaces with focused unit tests for checkpoint inspection,
rollback failure preservation, reversible execution safety classification, and `/rewind inspect`.
Then run affected package `test`, `typecheck`, `lint`, and `build`, followed by root `pnpm build`,
`pnpm harness:scan`, and `pnpm docs:build`.

## Progress

### 2026-05-03

- Reviewed existing checkpoint storage, `/rewind`, self-hosting verification, and provider sandbox backlog documents.
- Added SDK checkpoint inspection and `/rewind inspect` so users can inspect files and restore plans before rollback.
- Added opt-in local-first reversible execution policy and wrapper for checkpointed file edits, isolated agents, and host shell side effects.
- Updated `agent-sdk` and `agent-command-rewind` specs with the new guarantees and limitations.
- Verified targeted tests, affected package typecheck/lint/build, `pnpm docs:build`, `pnpm harness:scan`, and root `pnpm build`.

## Decisions

- Use the local-first reversible layer first: SDK edit checkpoints for `Write`/`Edit`, explicit worktree isolation for write-capable agent jobs, and clear non-reversible warnings for host `Bash` side effects.
- Keep provider sandbox snapshots out of this first slice; model them as a future `provider-sandbox` isolation layer in the SDK contract.

## Blockers

- None.

## Result

- Implemented local-first reversible execution contracts, checkpoint inspection, and `/rewind inspect`; archived the completed backlog item.
