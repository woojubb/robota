# Worktree Support Hardening Finalize

- **Status**: completed
- **Created**: 2026-05-03
- **Branch**: feat/worktree-support-hardening-finalize
- **Scope**: packages/agent-runtime, packages/agent-cli, packages/agent-sdk, packages/agent-command-background, .agents

## Objective

Harden worktree-isolated agent execution so cleanup, dirty handoff metadata, Git edge cases, and user-visible reporting behave consistently across runtime, CLI/TUI, headless, and command surfaces.

## Plan

- [x] Audit current worktree behavior and default policy against backlog acceptance.
- [x] Add idempotent cleanup for cancellation and startup failure paths.
- [x] Harden Git worktree adapter edge cases with targeted tests.
- [x] Project preserved worktree status and next action through runtime, SDK, CLI/TUI, and background command surfaces.
- [x] Update specs/backlog records and archive completed task state.
- [x] Run targeted verification and prepare PR.

## Progress

### 2026-05-03

- Started from `develop` on `feat/worktree-support-hardening-finalize`.
- Audited current runtime, SDK tool, command, and CLI/TUI worktree surfaces.
- Added idempotent worktree cleanup on cancellation/startup-failure paths and expanded fake-adapter coverage.
- Hardened the CLI Git adapter for branch/path collision retries, nested cwd resolution, dirty parent status, detached HEAD, and non-Git error messages.
- Projected preserved worktree status and next-action metadata through background state, subagent state, Agent tool output, TUI rows, `/agent list`, and `/background list`.
- Updated package SPECs and archived `.agents/backlog/completed/worktree-support-hardening.md`.
- Verified targeted tests/typechecks/lints plus root `pnpm build`.

## Decisions

- Keep worktree isolation explicit for this hardening backlog. Silent defaulting needs a reliable write-capability classifier, so the current contract will document explicit `isolation: 'worktree'` requests with no silent fallback.
- Preserve dirty parent checkout information as metadata instead of blocking worktree creation; Git worktrees are based on `HEAD`, so callers need base revision and parent status to review merge risk.

## Blockers

- None.

## Result

Completed worktree hardening with explicit beta isolation policy, idempotent cleanup, Git edge-case handling, preserved handoff metadata, command/TUI/headless reporting, and regression coverage.
