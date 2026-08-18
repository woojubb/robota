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

## Partly refuted on implementation — issue #1764 item 3

The item argues the allowlist entry for `packages/agent-framework/src/background-tasks/index.ts` is
disqualified by its own criterion, because the file's `agent-executor` re-exports are type-only.

Its CONCLUSION — delete the entry — is refuted, for two independent reasons:

1. The finding is about the LOCATION of an `agent-executor` pass-through, not about whether the
   re-exported symbols are runtime values. Its own test asserts that a **type-only**
   `export type { … } from '@robota-sdk/agent-executor/testing'` outside the exempt files must be
   flagged. Teaching the check to ignore type-only re-exports made that test fail, which is the test
   doing its job. So "these are type-only" never implied "this entry is unearned".
2. Emptying the set was then tried anyway, as the Direction's first branch asks, and the compiler
   refuted that too — see the resolution below.

Its DIAGNOSIS was right, and is what this item acts on: the criterion written beside the entry did
not describe why the entry was there. The entry stays; the criterion is replaced.

This section and the resolution below were previously two closures of item 3 that did not agree —
one saying the entry was justified under the existing criterion and the check unchanged, the other
saying the criterion was wrong and replacing it. The second is correct, and the check did change
(`SDK_RUNTIME_FACADE_FILES` → `SDK_UNREACHABLE_ELSEWHERE_FILES`, and its finding type and message
with it). A record that closes one item two incompatible ways leaves the next reader to guess which
half is live, so the disagreement is resolved here rather than left for them.

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
not hold for it. Measured — properly this time — its consumers are FOUR files across TWO packages:
`agent-transport-gui` (`PermissionPrompt.tsx`, `hooks/prompt-state.ts`, `hooks/useSessionClient.ts`)
and `agent-transport-protocol` (`ws-protocol.ts`). Neither package's documented dependency set admits
`agent-core`, and `agent-core` has NO internal dependencies — it is the bottom layer, so the type
cannot move down either. (This paragraph said "its one consumer is `agent-transport-gui`" until
round-2 review caught it: the count came from a line-based search that cannot see a name inside a
multi-line import block. Left uncorrected it invited exactly the wrong repair — delete the re-export
once `agent-transport-gui` is fixed, and break `agent-transport-protocol`.) The re-export is the only path by which a
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

Emptying the set was tried first, as the Direction's first branch asks. The compiler refuted it:
`IBackgroundTaskRunner` is named by `agent-product`, `agent-transport-tui`, `agent-transport` and
`agent-cli`, and none of the first three may depend on `agent-executor`, so `agent-framework`'s
barrel is their only permitted path. (An earlier revision of this paragraph said two packages; the
count came from a line-based search that cannot see a name inside a multi-line import block.)

The entry was load-bearing — just never for the reason written beside it. The criterion is now
**dependency reach**: an entry belongs when a permitted consumer cannot reach the symbol any other
way, and it must NAME that consumer. The constant, the finding type and the failure message were
renamed to match (`SDK_RUNTIME_FACADE_FILES` → `SDK_UNREACHABLE_ELSEWHERE_FILES`,
`sdk-runtime-facade-location` → `sdk-unreachable-elsewhere-location`), because a criterion that
lives only in a docblock while the mechanism still announces the retired one teaches the retired
one. ARCH-031's sentence survives the change of criterion — an entry that cannot name a consumer is
the next reader's false permission.

A LIMIT of the result: the criterion is per-symbol and the exemption is per-file. Measured — not
assumed, after two earlier counts in this record were made with a line-based search that cannot see
a name inside a multi-line import — exactly ONE of the block's ten names has an external importer:
`IBackgroundTaskRunner`, in 6 files across `agent-cli`, `agent-product`, `agent-transport` and
`agent-transport-tui`. The other nine ride along on it, and `agent-cli` additionally imports the
runner straight from `agent-executor`. Narrowing the entry to the one name it earns is recorded in
the code and in `PUBLIC-SURFACE.md`, and belongs with ARCH-039.

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
fails closed. 46 unit cases assert each rule in both directions, including the two exclusions.

The case count is the second half of the story, and the more important one. The first twelve cases
shipped NON-LOAD-BEARING: review found the test file byte-identical across the commit that fixed the
hop-limit defect, and passing 12/12 against the pre-fix reader — so the fixpoint walk, `export *`,
const-arrow and default exports, overloads and the generic exclusion were all covered by nothing.
Twelve more were added and each was RUN against that pre-fix reader before being kept: 11 fail there
and pass here. (The twelfth guards a defect that existed only in an uncommitted revision, so it has
no commit to be proved against; the test file says so rather than letting a reader assume otherwise.)
Four more followed from round-3 review, ten from round-4 and eight from round-5, for 46.

The mutation claim needs the same care, because two earlier versions of this sentence were wrong.
"Nine single-point mutations, nine caught" was refuted by round-4 review, which found six survivors.
The sweep behind it had a shell quoting bug that silently turned mutations into no-ops, so they
"survived" without ever being applied — and the same bug recurred on the next sweep, reporting all
37 mutations as survivors when none had been written to disk.

The sweep now VERIFIES that each mutation reached the file before running the suite, and refuses to
score one that did not. Final measurement: **37 single-point mutations of the scan, 37 caught by the
46-case suite** — every skip, every module-resolution candidate, every declaration form, and the
fail-closed empty-scope branch. One guard is the exception and is named rather than folded in: the
`requireGovernedTree` call is killed by `scan-guard-scope-fail-closed.mjs`, not by this suite, so
"every guard" would have credited the wrong mechanism. Round-6 review's independent 64-mutation
sweep put the suite at 57 kills and the harness as a whole at 58, with **no test that no mutation
kills** — which is the number that matters, and the first time in six rounds it was zero.

The sweep script is NOT committed: it is a one-shot generated from the file it mutates, and would
rot against the next edit. Said plainly because on a branch where two sweeps scored unapplied
mutations, an unreproducible sweep is the one claim a reader should want to re-run — the round-6
review's sweep is the independent corroboration. One survivor found on the way (the closure guard's
variable-statement half, which had a case only for its function-declaration half) has a case now.

The lesson is the one this item kept re-learning across six review rounds: a green result from a
tool you wrote proves nothing until you have watched that tool go red, and "I ran it" is not the
same claim as "I checked it ran".

Verified: 125 of 126 scans pass (99.2%), 1 skipped. agent-framework 1395 tests, agent-executor 104.
