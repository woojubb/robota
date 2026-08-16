---
title: 'ARCH-037: three published-contract hygiene defects, each invisible because its guard is narrower than the rule it enforces'
status: in-progress
created: 2026-08-17
priority: medium
urgency: soon
area: packages/agent-interface-transport, packages/agent-executor, scripts/harness
depends_on: []
issue: https://github.com/woojubb/robota/issues/1764
---

# ARCH-037: published-contract hygiene from the ARCH published-contract audit

Converted from GitHub issue #1764, which the owner requested over ARCH-030 / ARCH-025 / ARCH-031 on
2026-08-16 and filed as an issue so work in flight was not disturbed.

## Problem

Three defects on the published contract surface. They are filed together not because they touch the
same code — they do not — but because each one exists for the **same reason**: the mechanical guard
that should have caught it measures something narrower than the rule it enforces. That shared cause is
what the item is really about.

### 1. `agent-interface-transport` re-publishes three `agent-core`-owned types

- `packages/agent-interface-transport/src/index.ts:6` —
  `export type { IActionRequest, TActionResponse } from '@robota-sdk/agent-core';`
- `packages/agent-interface-transport/src/background-task-contracts.ts:19`, surfaced at
  `src/index.ts:141` — `export type { TBackgroundPermissionPolicy } from '@robota-sdk/agent-core';`

This is the shape ARCH-031 deleted from `agent-framework/src/subagents/index.ts`. It survived because
`scripts/harness/check-sdk-public-surface.mjs` walks **only `agent-framework`** — the audit found these
by reading, not by running the scan.

Directly in ARCH-031's blast radius: it added `DEFAULT_BACKGROUND_PERMISSION_POLICY` to `agent-core`
while the type that constant constrains is re-published by `agent-interface-transport`, so a spawn site
imports the constant from one package and may import its type from either.

### 2. `ISubagentExecutionEnvelope` is an unnameable parameter type of a public function

`subagentExecutionRoot` is on the `agent-executor` barrel (`src/index.ts:45`). Its parameter type
`ISubagentExecutionEnvelope` is declared and exported at
`packages/agent-executor/src/subagents/execution-root.ts:34` but appears on neither the sub-barrel nor
the package barrel — its only non-relative consumer is its own unit test. A consumer of the public
function cannot name what it must pass.

This is verbatim the `IScheduleEditPatch` defect ARCH-025 fixed, on a function ARCH-031 changed in the
very next branch. The repair did not become a habit, which is the argument for a mechanical check
rather than another note.

### 3. The runtime-facade allowlist keeps an entry its own stated criterion disqualifies

`scripts/harness/check-sdk-public-surface.mjs:16-22` still allowlists
`packages/agent-framework/src/background-tasks/index.ts`. Verified: that file's only
`@robota-sdk/agent-executor` re-exports are a single `export type { … }` block of **ten type-only**
names — zero runtime values. ARCH-031's justification for deleting the sibling entry is written three
lines above the surviving one and applies to it verbatim:

> an allowlist entry with nothing behind it is the next reader's false permission.

## Not reproducible — issue #1764 item 4 is refuted

Issue #1764's fourth item claims `ISpawnAgentTaskRequest` is "still a hand-written interface plus a
hand-written ~20-key literal in `createAgentRequest`", and "untouched".

That is false as of the commit the issue was filed against. `execution-workspace-spawner.ts:36-42`
already derives it:

```ts
export type ISpawnAgentTaskRequest = Readonly<
  Omit<
    IAgentBackgroundTaskRequest,
    'kind' | 'parentSessionId' | 'metadata' | 'mode' | 'depth' | 'cwd'
  > &
    Partial<Pick<IAgentBackgroundTaskRequest, 'mode' | 'depth' | 'cwd'>>
>;
```

and `createAgentRequest` carries an ARCH-031 comment stating it is "a spread with the spawner's own
overrides, NOT a hand-written key list". `git log` puts both in `47720678a` (ARCH-031, PR #1773),
which predates the issue. The item is closed as already-delivered, not carried.

The mapper itself correctly **stays**: it owns four defaults and injects three spawner-owned fields
(`parentSessionId`, `metadata`, `kind`) that callers must not set, so collapsing it would let a caller
forge the parent session. That reasoning remains recorded here because it is the reason the remaining
duplication is intentional.

## Direction

Fix the three instances, and in each case widen the guard rather than only correcting the site:

- Drop the pass-through re-exports (consumers import from `@robota-sdk/agent-core`) **and** widen
  `check-sdk-public-surface.mjs` beyond `agent-framework`, so the exception is recorded rather than
  invisible. The guard being narrower than the rule is the more important half.
- Export `ISubagentExecutionEnvelope` from both barrels, add the SPEC row, and add the check that a
  barrel-exported function's parameter types are themselves exported — the mechanism that would have
  caught both this and `IScheduleEditPatch`.
- Apply the allowlist's own criterion to the surviving entry and empty `SDK_RUNTIME_FACADE_FILES`, or
  replace the comment with the real distinguishing reason.

## Blockers

None.
