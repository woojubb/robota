---
title: 'ARCH-FIX-024: Move child-process subagent runner from agent-sdk to agent-cli'
status: done
created: 2026-05-15
priority: high
urgency: soon
area: packages/agent-sdk, packages/agent-cli
---

## Problem

`packages/agent-sdk/src/subagents/child-process-subagent-runner.ts` imports `fork` from
`node:child_process` directly. CLI-AUDIT-006 already classified this as a CLI adapter, yet
the file lives in `agent-sdk` and is re-exported from `agent-cli/src/subagents/index.ts`.
This makes `agent-sdk` non-deployable in environments without `node:child_process` (e.g., edge
runtimes, browsers, WASM environments).

**Evidence**: `agent-sdk/src/subagents/child-process-subagent-runner.ts` line 1:
`import { fork } from 'node:child_process'`. `agent-sdk/src/subagents/index.ts` exports
`ChildProcessSubagentRunner` and `createChildProcessSubagentRunnerFactory`.

**Source**: ARCH-SA-001 (System Architect review 2026-05-15)

## Scope

Files to move from `packages/agent-sdk/src/subagents/` to `packages/agent-cli/src/subagents/`:

- `child-process-subagent-runner.ts`
- `child-process-subagent-runner-result.ts`
- `child-process-subagent-transport.ts`
- `child-process-subagent-ipc.ts`
- Worker file (if present)

After the move:

- `agent-sdk/src/subagents/index.ts` exports only `in-process-subagent-runner.ts` and
  `@robota-sdk/agent-runtime` re-exports
- `agent-cli/src/subagents/index.ts` exports both in-process and child-process runners
- Add harness check: `agent-sdk` must not import from `node:child_process`

## Test Plan

- `pnpm --filter @robota-sdk/agent-sdk build` passes with no `child_process` references
- `pnpm --filter @robota-sdk/agent-cli build` passes with moved files in place
- `pnpm test` for both packages passes
- `pnpm typecheck` clean
- Harness check added to `scripts/harness/checks/` detecting `node:child_process` in `agent-sdk`

## User Execution Test Scenarios

**Scenario**: Subagent spawning still works after the move

Prerequisites:

- Project built successfully after the migration
- A task that uses subagent spawning (e.g., parallel agent task)

Steps:

1. Run `pnpm robota` (or equivalent CLI entrypoint)
2. Execute a command or task that triggers subagent spawning
3. Observe that the subagent is spawned via child process without errors

Expected: Subagent spawns and completes. No `child_process` import errors from `agent-sdk`.

Evidence: (to be filled after implementation)
