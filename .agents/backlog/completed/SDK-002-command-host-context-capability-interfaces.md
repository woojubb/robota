---
title: 'SDK-002: ICommandHostContext capability sub-interfaces + agent job controls'
status: backlog
created: 2026-05-15
priority: high
urgency: soon
area: packages/agent-core, packages/agent-command-agent, packages/agent-sdk
---

## Problem

**1. Optional methods on `ICommandHostContext` (ARCH-SD-007)**
The base `ICommandHostContext` interface has accumulated 10+ optional (`?:`) methods. Optional
interface methods are a design smell: they cannot be safely called without null-checks, they
allow partial implementations that silently skip behavior, and they prevent compile-time
enforcement of the contract.

**2. Agent job controls not on the interface (ARCH-SD-010)**
`spawnAgentJob`, `sendAgentJob`, `waitForAgentJob`, `cancelAgentJob` are either absent from
`ICommandHostContext` or declared as optional fields. Command modules that invoke agent jobs
must cast the context to a concrete type or null-check optional fields at every call site.

**Evidence**: `agent-core/src/interfaces/command-host-context.ts` has multiple optional fields.
`agent-command-agent/src/agent-command.ts` reaches into `InteractiveSession` methods not on
`ICommandHostContext` (addressed by SDK-001 step 3, but the interface must exist first).

**Source**: ARCH-SD-007, ARCH-SD-010 (Senior Developer review 2026-05-15)

## Scope

### Step 1 — Define capability sub-interfaces in `agent-core`

```
IAgentJobHostContext
  spawnAgentJob(...)
  sendAgentJob(...)
  waitForAgentJob(...)
  cancelAgentJob(...)

IContextReferenceHostContext
  getContextReferences(...)
  addContextReference(...)
  removeContextReference(...)
```

### Step 2 — Update `ICommandHostContext`

- Remove all optional methods from the base interface
- `ICommandHostContext` extends required base methods only
- OR: `ICommandHostContext` extends both capability sub-interfaces where those are universally
  required; command modules that only need a subset declare the sub-interface directly

### Step 3 — Update command module signatures

- `agent-command-agent`: parameter changes to `IAgentJobHostContext` (+ SDK-001 step 3)
- Other command modules: verify they only use methods present on their declared context type

### Step 4 — Update `InteractiveSession` to implement sub-interfaces

- `InteractiveSession` implements `IAgentJobHostContext` + `IContextReferenceHostContext`
- All implementations are required (no undefined methods at runtime)

## Test Plan

- `pnpm --filter @robota-sdk/agent-core build` passes
- `pnpm --filter @robota-sdk/agent-sdk build` passes
- `pnpm --filter @robota-sdk/agent-command-agent build` passes
- No `?.` null-checks on context method calls in command modules
- `pnpm test` passes for affected packages
- `pnpm typecheck` clean

## User Execution Test Scenarios

**Scenario**: Agent job command executes correctly

Prerequisites: Full build passing. CLI running with agent job support.

Steps:

1. Run the Robota CLI
2. Trigger a command that spawns an agent job (e.g., a parallel agent task)
3. Observe that the job spawns, runs, and completes
4. Verify result is surfaced correctly in the session

Expected: Agent job completes without runtime errors. No null-check failures on context methods.

Evidence: (to be filled after implementation)
