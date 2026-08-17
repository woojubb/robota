---
title: 'ARCH-037: three published-contract hygiene defects, each invisible because its guard is narrower than the rule it enforces'
status: done
completed: 2026-08-18
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

## Refuted on implementation — issue #1764 item 3

The item argues the allowlist entry for `packages/agent-framework/src/background-tasks/index.ts` is
disqualified by its own criterion, because the file's `agent-executor` re-exports are type-only.

Attempting it showed the inference is wrong. `check-sdk-public-surface.mjs`'s
`sdk-runtime-facade-location` finding is about the LOCATION of an `agent-executor` pass-through, not
about whether the re-exported symbols are runtime values — its own test asserts that a **type-only**
`export type { … } from '@robota-sdk/agent-executor/testing'` outside a facade barrel must be
flagged. Teaching the check to ignore type-only re-exports made that test fail, which is the test
doing its job.

So the entry is load-bearing and justified. ARCH-031's comment explains why the SIBLING entry went —
ARCH-031 also removed that file's re-exports — and does not transfer to a file that still has them.
Item 3 is closed as refuted; the check and the allowlist are unchanged.

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

## Implementation

All three addressed. **Two of the three Directions were refuted by the compiler and took the item's
second branch instead** — recorded here because the refutations are the useful part.

### 1. Re-published `agent-core` types — two removed, one kept as a NAMED exception

`IActionRequest` and `TBackgroundPermissionPolicy` are gone: every consumer already imported them from
`agent-core`, so the re-exports were second names nobody reached. `agent-executor` reached
`TBackgroundPermissionPolicy` through the barrel and now takes it from the SSOT, which it already
depends on.

**`TActionResponse` stays**, and the Direction ("consumers import from `@robota-sdk/agent-core`") does
not hold for it. Measured: its one consumer is `agent-transport-gui`, whose documented dependency set
is "interface-transport + transport-protocol only", and `agent-core` has NO internal dependencies —
it is the bottom layer, so the type cannot move down either. The re-export is the only path by which a
permitted consumer can name it. It is now a named exception carrying that reasoning, not an unmarked
pass-through.

### 2. `ISubagentExecutionEnvelope` — already fixed; the MECHANISM was the missing half

Both barrels already export it. What did not exist was the check, and the item was right that a third
note would not have helped: `scripts/harness/scan-barrel-parameter-types.mjs` now fails when a
barrel-exported function has a parameter type the same barrel does not export.

It found a live instance immediately — `createDefaultTools` published with
`ICreateDefaultToolsOptions` unexported, the same shape as `IScheduleEditPatch` and
`ISubagentExecutionEnvelope`, on a third function. Fixed.

Scoped deliberately: return types are excluded (a caller can hold a value without naming its type),
and so are other packages' types — requiring a barrel to re-export those would demand exactly the
pass-through re-exports STRUCT-07 bans, i.e. the rule would contradict a rule. Both exclusions have
silent-direction tests.

### 3. The runtime-facade allowlist — the criterion was wrong, not the entry

Emptying `SDK_RUNTIME_FACADE_FILES` was tried first, as the Direction's first branch asks. The
compiler refuted it: `agent-product` and `agent-transport-tui` both name `IBackgroundTaskRunner` and
neither may depend on `agent-executor`, so `agent-framework`'s barrel is their only permitted path.

The entry was load-bearing — just never for the reason written beside it. Counted, its
`agent-executor` re-exports are ten type-only names and zero runtime values, so "runtime facade"
disqualified it exactly as ARCH-031 argued. The criterion is now **dependency reach**: an entry
belongs when a permitted consumer cannot reach the symbol any other way, and it must NAME that
consumer. ARCH-031's sentence survives the change of criterion — an entry that cannot name one is the
next reader's false permission.

Inside `agent-framework` the redirect stands: this package does depend on `agent-executor`, so its own
files now import these from the SSOT rather than through their own barrel.

### What this item does NOT close

Widening `check-sdk-public-surface` beyond `agent-framework` — the shared cause the item names — is
**ARCH-039**, filed separately and still open. The new floor covers the parameter-type rule across
configured barrels (`agent-executor` and `agent-framework` today), so that one rule is no longer
agent-framework-only; the rest of the scan still is.

### Falsification

The new floor was mutated before being trusted: removing the `ICreateDefaultToolsOptions` export
reddens it, reproducing ARCH-037's own defect-2 shape (deleting
`ISubagentExecutionEnvelope` from `agent-executor`'s barrel) reddens it, and an empty barrel list
fails closed. 12 unit cases assert each rule in both directions, including the two exclusions.

Verified: 124 of 126 scans pass (2 skipped). agent-framework 1395 tests, agent-executor 104.
