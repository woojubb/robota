---
title: 'ARCH-FIX-028: Clarify agent-runtime concrete I/O boundary + document croner in SPEC'
status: backlog
created: 2026-05-15
priority: medium
urgency: later
area: packages/agent-runtime, packages/agent-cli
---

## Problem

Two related issues in `agent-runtime`:

**1. Concrete Node.js I/O lives in agent-runtime (ARCH-SA-005)**

- `agent-runtime/src/background-tasks/runners/managed-shell-process-runner.ts` calls `spawn`
  from `node:child_process`
- `agent-runtime/src/subagents/git-worktree-isolation-adapter.ts` calls `execFileSync` and
  performs Git operations
- CLI-AUDIT-006 classified `git-worktree-isolation-adapter.ts` as a "CLI adapter" — yet it
  lives in and is exported from `agent-runtime`
- The SPEC says "Concrete I/O belongs in adapters owned by runtime shells"

**2. `croner` production dependency undocumented (ARCH-SA-010)**

- `agent-runtime/package.json` includes `croner: ^10.0.1`
- `ScheduledTaskRunner` exists in `agent-runtime/src/background-tasks/runners/` but is not
  listed in `agent-runtime/docs/SPEC.md` Public API Surface table

**Source**: ARCH-SA-005, ARCH-SA-010 (System Architect review 2026-05-15)

## Decision Required

**For `git-worktree-isolation-adapter.ts`**:
Move to `packages/agent-cli/src/subagents/` per its CLI-AUDIT-006 classification.

**For `managed-shell-process-runner.ts`**:
Choose one:

- (A) Update `agent-runtime/docs/SPEC.md` to document that `agent-runtime` intentionally
  provides concrete default process runner implementations (clarifying the boundary decision)
- (B) Move to a CLI adapter in `packages/agent-cli/`

**For `croner`**:
Add `ScheduledTaskRunner` to `agent-runtime/docs/SPEC.md`:

- Public API Surface entry
- `croner` listed as a production dependency with its purpose

## Scope

1. Move `git-worktree-isolation-adapter.ts` to `packages/agent-cli/src/subagents/`
2. Resolve `managed-shell-process-runner.ts` per chosen option
3. Update `agent-runtime/docs/SPEC.md`:
   - Add `ScheduledTaskRunner` to Public API Surface
   - Document `croner` dependency and its role
   - Document the concrete I/O boundary decision

## Test Plan

- `pnpm --filter @robota-sdk/agent-runtime build` passes
- `pnpm --filter @robota-sdk/agent-cli build` passes (with moved adapter)
- `pnpm test` passes for both packages
- `pnpm typecheck` clean
- `agent-runtime/docs/SPEC.md` has `ScheduledTaskRunner` entry and `croner` dependency note

## User Execution Test Scenarios

**Scenario**: Scheduled tasks and worktree operations still work after the move

Prerequisites: Full build passing

Steps:

1. Trigger a background task that uses scheduled execution
2. Trigger a worktree-based subagent operation
3. Observe both complete without errors

Expected: No regressions in scheduled task or worktree isolation behavior.

Evidence: (to be filled after implementation)
