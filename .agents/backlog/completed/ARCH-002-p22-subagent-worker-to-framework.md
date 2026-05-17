---
title: 'ARCH-002-p22: Extract child-process subagent runner into dedicated package'
status: done
---

# ARCH-002-p22: Extract child-process subagent runner into dedicated package

## Problem

The child-process subagent runtime is currently split across two packages:

| File                                                                    | Package           | Issue                                                   |
| ----------------------------------------------------------------------- | ----------------- | ------------------------------------------------------- |
| `ChildProcessSubagentRunner`, `createChildProcessSubagentRunnerFactory` | `agent-framework` | Framework bundles a non-injectable, optional capability |
| `child-process-subagent-worker.ts`                                      | `agent-cli`       | CLI shouldn't own a reusable SDK runtime component      |

### Core architectural issue

Subagent support is **optional**. Applications that don't need child-process subagents should
be able to use `agent-framework` without any subagent-related code or provider dependencies.
Currently `ChildProcessSubagentRunner` lives in `agent-framework`, making child-process
subagent support non-optional for all framework consumers.

The worker script needs `@robota-sdk/agent-provider` (for `createDefaultProviderDefinitions()`).
Adding `agent-provider` to `agent-framework` would bloat all framework consumers with 6 provider
SDKs (anthropic, openai, gemini, etc.) regardless of whether they need subagents.

### Correct design

```
agent-executor     ← ISubagentRunner, ISubagentJobHandle interfaces (already here)
agent-framework    ← InteractiveSession accepts subagentRunnerFactory?: TSubagentRunnerFactory
                    (interface-only, ChildProcessSubagentRunner REMOVED from here)
agent-provider     ← createDefaultProviderDefinitions()
      ↑
agent-subagent-runner (NEW PACKAGE)
  - ChildProcessSubagentRunner
  - createChildProcessSubagentRunnerFactory
  - child-process-subagent-worker.ts
  - IPC types
  - depends on: agent-framework + agent-provider
      ↑
agent-cli          ← imports createChildProcessSubagentRunnerFactory from agent-subagent-runner
```

`agent-subagent-runner` sits above `agent-framework` and `agent-provider`. It is an optional
package — applications that don't need child-process subagents don't need to install it.

## Fix

1. Create `packages/agent-subagent-runner/` as a new workspace package
2. Move from `agent-framework` to `agent-subagent-runner`:
   - `src/subagents/child-process-subagent-runner.ts`
   - `src/subagents/child-process-subagent-runner-result.ts`
   - `src/subagents/child-process-subagent-transport.ts`
   - `src/subagents/child-process-subagent-ipc.ts`
3. Move from `agent-cli` to `agent-subagent-runner`:
   - `src/subagents/child-process-subagent-worker.ts`
4. `agent-subagent-runner` dependencies:
   - `@robota-sdk/agent-core`
   - `@robota-sdk/agent-executor`
   - `@robota-sdk/agent-framework`
   - `@robota-sdk/agent-provider`
5. Remove `ChildProcessSubagentRunner` and IPC types from `agent-framework/src/subagents/`
   and `agent-framework/src/index.ts` — keep only `IInProcessSubagentRunnerDeps`,
   `TSubagentRunnerFactory`, `createInProcessSubagentRunner`
6. Export `getDefaultSubagentWorkerPath()` from `agent-subagent-runner` — resolves path to
   bundled worker in the package's own dist
7. Update `agent-cli`:
   - Replace `agent-framework` imports of runner/IPC types with `@robota-sdk/agent-subagent-runner`
   - Worker path construction in `cli.ts` can be removed (use `getDefaultSubagentWorkerPath()`)
8. Update `agent-framework` tests that reference `ChildProcessSubagentRunner` to import from
   the new package
9. Build and typecheck all affected packages; run tests

## Architecture map update

- Add `CLI-AUDIT-022` to layering-audit.md
- Update project-structure.md with new `agent-subagent-runner/` entry
- Update composition-tree.md

## Note on IPC types

`ISubagentWorkerStartPayload`, `TSubagentWorkerChildMessage`, etc. are currently re-exported
through `agent-framework/src/subagents/index.ts` from `agent-executor`. These types belong in
`agent-executor` (already there) and should be imported directly from there after the move.
