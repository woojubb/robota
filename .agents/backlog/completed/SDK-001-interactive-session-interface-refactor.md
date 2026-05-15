---
title: 'SDK-001: IInteractiveSession interface + InteractiveSession refactor + test factory'
status: backlog
created: 2026-05-15
priority: high
urgency: soon
area: packages/agent-sdk, packages/agent-command-agent, packages/agent-transport-tui, packages/agent-transport-ws, packages/agent-transport-headless
---

## Problem

Three related issues that must be solved together:

**1. No `IInteractiveSession` interface (ARCH-SD-002)**
`InteractiveSession` is a concrete 1,576-line class. Transport packages consume it via
`as unknown as InteractiveSession` type casts — no interface exists for them to program against.
15+ test files use the same unsafe cast pattern.

**2. `InteractiveSession` god class (ARCH-SA-006, ARCH-SD-003)**
`agent-sdk/src/interactive/interactive-session.ts` is 1,576 lines with 45+ private fields and
60+ methods spanning: prompt queuing, skill activation, background task lifecycle, agent job
lifecycle, context references, edit checkpoints, sandbox snapshots, fork-skill execution,
streaming. Violates the 300-line anti-monolith rule.

**3. `agent-command-agent` bypasses `ICommandHostContext` (ARCH-SD-001)**
`agent-command-agent/src/agent-command.ts` line 207 declares its parameter as
`session: InteractiveSession` instead of `ICommandHostContext`. This breaks the command module
contract and creates a hard dependency on the assembly-layer class.

**4. No `createTestInteractiveSession` factory (ARCH-SD-008)**
15+ test files construct mock sessions via `{} as unknown as InteractiveSession`. New required
methods produce silent `undefined` rather than compile-time errors.

## Scope

### Step 1 — Define `IInteractiveSession`

- Create `packages/agent-sdk/src/interactive/i-interactive-session.ts`
- Expose only the surface transports and tests legitimately consume
- Export from `packages/agent-sdk/src/index.ts`

### Step 2 — Extract sub-objects from `InteractiveSession`

- `BackgroundTaskState` — background task lifecycle fields and methods
- `ContextReferenceState` — context reference fields and methods
- `EditCheckpointState` — edit checkpoint and sandbox snapshot fields
- `InteractiveSession` becomes a thin coordinator delegating to these objects
- Each sub-object stays under 300 lines

### Step 3 — Fix `agent-command-agent`

- Change `executeAgentCommand(session: InteractiveSession, ...)` to accept `ICommandHostContext`
- Remove `@robota-sdk/agent-sdk` production dependency from `agent-command-agent/package.json`
- Add harness check: `agent-command-*` packages must not import from `@robota-sdk/agent-sdk`

### Step 4 — Add test factory

- Create `packages/agent-sdk/src/testing/create-test-interactive-session.ts`
- Export `createTestInteractiveSession(overrides?: Partial<IInteractiveSession>)`
- Migrate all `as unknown as InteractiveSession` usages in test files to use the factory

### Step 5 — Update transport packages

- `agent-transport-tui`, `agent-transport-ws`, `agent-transport-headless` switch to
  `IInteractiveSession` parameter types

## Test Plan

- `pnpm --filter @robota-sdk/agent-sdk build` passes
- `pnpm --filter @robota-sdk/agent-command-agent build` passes (no agent-sdk dep)
- All transport packages build successfully
- `pnpm test` for `agent-sdk`, `agent-command-agent`, and transport packages passes
- `pnpm typecheck` clean across all affected packages
- No remaining `as unknown as InteractiveSession` in test files
- Harness check added: `agent-command-*` must not import from `@robota-sdk/agent-sdk`
- `interactive-session.ts` is under 500 lines after sub-object extraction (target ≤ 300)

## User Execution Test Scenarios

**Scenario**: Interactive session continues working after refactor

Prerequisites: Full build passing

Steps:

1. Run the Robota CLI and start an interactive session
2. Execute several commands including at least one that involves agent jobs
3. Use background tasks if available
4. Verify session persists and context references work correctly

Expected: All commands execute correctly. No runtime errors from the refactored session class.

Evidence: (to be filled after implementation)
