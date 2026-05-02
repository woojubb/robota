# CLI-BL-014: Self-hosting Loop Verification

- **Status**: completed
- **Branch**: feat/self-hosting-loop-verification
- **Scope**: packages/agent-tools, packages/agent-sdk, .agents/specs

## Context

To achieve the "Self-hosting" goal, an agent must be able to modify its own source code and then run a build/test cycle. This presents a unique challenge: how do we ensure that a partial or broken state during the 'write' phase doesn't prevent the agent from finishing the 'verify' phase?

## Objective

Define the mechanism to safely execute the "Edit -> Build -> Verify" loop where the tool being modified is the same as the engine running the process.

## Key Challenges & Questions

1. **Atomic Swaps**: How can we ensure that a `write` operation doesn't break the current running process before it can finish its task?
2. **Dependency Integrity**: When an agent modifies a core package, how do we verify that the global monorepo-wide dependencies remain intact?
3. **Execution Context**: If the `pnpm build` command requires the new code to be valid, but the current process is still using the old code, how do we manage the handoff?

## Requirements for Completion (Definition of Done)

- [x] A clear specification for 'Atomic Write' operations in a monorepo.
- [x] A verification protocol that ensures `pnpm build` can succeed even when parts of the codebase are in flux.
- [x] Integration with our CI/CD-like local environment to prevent "suicide" (the agent accidentally deleting its own ability to run).
- [x] Unit tests cover atomic write behavior and the handoff state machine.
- [x] Integration-style tests cover old runtime / new disk handoff without replacing the running process.

## Prior Art Research

- Claude Code hooks expose lifecycle events around tool execution and stop conditions, including post-tool feedback and stop continuation control. This supports a deterministic verification layer that runs after writes and before the agent considers the turn finished.
- Replit Agent checkpoints and rollbacks create recoverable project states at milestones, after validation, and before risky fixes. This supports pairing write safety with checkpoint-based restore rather than relying on a best-effort manual undo.
- GitHub Copilot cloud agent performs code changes in an Actions-powered environment where it can run tests, linters, and logs while keeping work isolated on a branch. This supports treating verification as an external child process over the on-disk tree instead of reloading the currently running agent process.
- Codex CLI documentation positions the local coding agent as a process that can read, change, and run code in the selected directory. Its published default behavior emphasizes following project instructions and running requested checks after code changes. This supports a local, instruction-driven verification protocol rather than provider-specific prompt injection.

## Implementation Direction

- Keep file mutation safety in `agent-tools`, where `Write` and `Edit` are owned.
- Add a same-directory temp-file plus atomic rename helper for UTF-8 writes so incomplete content is never exposed as the target file.
- Keep checkpoint ownership in `agent-sdk/checkpoints`; the self-hosting loop composes with existing edit checkpointing instead of duplicating rollback storage.
- Add a provider-neutral self-hosting verification planner/state machine in `agent-sdk`. The planner describes the handoff protocol and verification commands; it must not run CLI/TUI behavior directly.
- Use Robota's harness as the local CI-like verification environment: targeted package checks first, then `pnpm harness:verify -- --base-ref <ref> --skip-record-check`.

## Test Plan

- Add unit tests for any atomic write planner or handoff state machine introduced by the implementation.
- Add integration tests that simulate edit/build/verify sequencing without replacing the running process.
- Run affected package `test`, `typecheck`, and `build`, then run `pnpm harness:scan`.

## Progress

### 2026-05-02

- Started implementation on `feat/self-hosting-loop-verification`.
- Completed prior-art research from Claude Code hooks, Replit checkpoints, GitHub Copilot cloud agent, and Codex CLI documentation.
- Added atomic UTF-8 write semantics for `Write`/`Edit`.
- Added SDK self-hosting verification planner and lifecycle state machine.
- Verified affected package tests, typecheck, build, lint, `pnpm harness:scan`, and `pnpm harness:verify -- --base-ref origin/develop --skip-record-check`.

## Result

- `Write` and `Edit` now replace file content through same-directory temporary files and atomic rename.
- SDK exports `planSelfHostingVerification()` and `transitionSelfHostingLoop()` for provider-neutral self-hosting edit/build/verify orchestration.
- Added cross-cutting self-hosting loop spec in `.agents/specs/self-hosting-loop-verification.md`.
- Added unit and integration-style tests for atomic writes, old-runtime/new-disk handoff, planner ordering, mandatory harness verification, and state transitions.

## Notes

This task is a prerequisite for all recursive development tasks.
