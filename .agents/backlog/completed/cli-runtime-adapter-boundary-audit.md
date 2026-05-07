# CLI Runtime Adapter Boundary Audit

## Status

Completed.

## Priority

P1 - keeps reusable background, subagent, and worktree behavior out of the thin TUI layer.

## Problem

`agent-cli` currently owns concrete local runtime adapters for background processes, child-process
subagents, IPC, and Git worktree isolation:

- `packages/agent-cli/src/background/managed-shell-process-runner.ts`
- `packages/agent-cli/src/subagents/child-process-subagent-runner.ts`
- `packages/agent-cli/src/subagents/child-process-subagent-transport.ts`
- `packages/agent-cli/src/subagents/child-process-subagent-ipc.ts`
- `packages/agent-cli/src/subagents/child-process-subagent-worker.ts`
- `packages/agent-cli/src/subagents/git-worktree-isolation-adapter.ts`

Concrete terminal process spawning can belong to the CLI shell. Reusable lifecycle rules, runner
ports, worktree contracts, serializable provider profile handling, and child-process result
semantics should belong to `agent-runtime` or SDK-owned ports so non-CLI hosts can use the same
architecture without importing TUI code.

## Recommended Direction

Classify each local runtime file as one of:

- **CLI adapter**: terminal-host-specific process spawning, executable resolution, Ink-facing
  lifecycle handling, or local settings integration.
- **SDK facade/port**: provider-neutral host contract needed by command modules or
  `InteractiveSession`.
- **Runtime primitive**: reusable background/subagent/worktree state, transitions, result envelope,
  and runner interfaces.

Then move reusable contracts/logic to the owning package and leave only concrete host adapters in
`agent-cli`.

Recommended first implementation:

1. Add characterization tests around the current child-process subagent and worktree behavior.
2. Move reusable type contracts into `agent-runtime` when they are pure lifecycle/worktree concepts.
3. Expose only provider-neutral SDK facades needed by `InteractiveSession` and command modules.
4. Keep Node child-process spawning and local executable path resolution in `agent-cli`.
5. Update `ARCHITECTURE-MAP.md`, package specs, and harness dependency checks.

## Acceptance Criteria

- [x] Every file under `packages/agent-cli/src/background` and `packages/agent-cli/src/subagents`
      is classified as CLI adapter, SDK facade/port, or runtime primitive.
- [x] Reusable lifecycle/worktree contracts are owned outside `agent-cli`.
- [x] `agent-command-*` packages do not import `agent-cli` for runtime behavior.
- [x] Non-CLI hosts can depend on SDK/runtime contracts without pulling in React/Ink or CLI code.
- [x] Existing background/subagent/worktree behavior has regression coverage before extraction.
- [x] `packages/agent-cli/docs/ARCHITECTURE-MAP.md` and affected package `SPEC.md` files reflect
      the final ownership.

## Result

Runtime-owned bounded output capture and log pagination helpers moved to
`packages/agent-runtime/src/background-tasks/log-pages.ts` and are re-exported through SDK facades.
CLI background/subagent files are classified in `packages/agent-cli/docs/ARCHITECTURE-MAP.md`.
Concrete child process, worker IPC, worker session reconstruction, and Git/filesystem I/O remain in
`agent-cli` as terminal-host adapters.

Key verification:

- `pnpm build`
- `pnpm --filter @robota-sdk/agent-cli test`
- `pnpm --filter @robota-sdk/agent-runtime test`
- `pnpm --filter @robota-sdk/agent-sdk test`
- `pnpm harness:scan`

## Verification Plan

- `pnpm --filter @robota-sdk/agent-cli test -- subagent`
- `pnpm --filter @robota-sdk/agent-cli test -- managed-shell`
- `pnpm --filter @robota-sdk/agent-runtime test`
- `pnpm --filter @robota-sdk/agent-sdk test`
- `pnpm harness:scan:deps`
- `pnpm harness:scan:commands`
