---
title: "CORE-035: the same-tool-input loop guard throws a plain Error at N+1 that resolves as a hard failure, while the SPEC documents an AbortError at N with fixed text that would resolve as a successful interruption — the error TYPE drift changes the run's success semantics"
status: done
created: 2026-08-13
completed: 2026-08-17
priority: low
urgency: soon
area: packages/agent-core
depends_on: []
---

# CORE-035: same-input guard — doc says abort, code delivers failure

## Problem

The SPEC says the loop guard throws an `AbortError` when a tool is called with identical inputs `N` or
more times, with a specific message. The code throws a plain `Error` on the `N+1`-th call with
different text — and the error TYPE difference is behavioral, because abort classification resolves an
`AbortError` as a successful interruption while a plain `Error` surfaces as a failed run.

## Evidence (round-2 engine audit, 2026-08-13)

- `packages/agent-core/docs/SPEC.md:1111` (also `:828`) — "If the same tool is invoked with
  byte-identical serialized inputs `N` or more times within a single run, the execution loop throws
  `AbortError` with message `\"Tool '<name>' called with the same inputs <N> times. Aborting to
prevent infinite loop.\"`"
- `packages/agent-core/src/services/execution-round-tools.ts:36-40` — `if (count > maxSameToolInputs)
throw new Error('[EXECUTION] Tool "…" called with identical input … times — aborting to prevent
infinite loop')` — plain `Error`, different text, fires at `N+1` not `N`.
- Behavioral consequence: `src/utils/abort-classification.ts:56` resolves a real `AbortError` as
  `success: true, interrupted: true`, while the actual plain `Error` surfaces as a `success: false`
  rejection through `robotaRun`.

## Direction — resolved toward the code's SEMANTICS and the SPEC's INTENT, which are not the same

The Direction offered two endpoints: document the plain `Error`, or change the code to abort. Both
were measured against what each side was actually right about, and the answer takes something from
each.

**Failure, not abort — the code is right.** A guard trip is the agent giving up, not the user
cancelling. The user asked a question and got no answer; `isAbortFailure` resolves an `AbortError` as
`success: true, interrupted: true`, so the documented behaviour would have reported that run as a
SUCCESS. `AbortError` means "the caller asked us to stop", and here nobody did.

**Named, not bare — the SPEC is right.** Documenting the plain `Error` (the cheaper fix the Direction
suggested) would settle the drift by giving up the thing the SPEC was reaching for by naming a type
at all: that this condition is DISTINGUISHABLE. A bare `Error` is not — a caller cannot tell "the
agent looped" from "the network died". `SameToolInputLoopError` extends `RobotaError`, so CORE-027's
failure path carries `code` / `category` / `recoverable` and the `toolName` / `callCount` /
`maxSameToolInputs` context out to the caller intact.

**The threshold: the code is right and the SPEC contradicted its own option name.** `maxSameToolInputs`
names a MAXIMUM. N identical calls are allowed; the N+1th trips. "N or more times ... throws" cannot
be true of a value called `max`.

`recoverable: true`, because the loop is a property of this turn's prompt and tool set rather than of
the system: a caller that varies either can reasonably retry.

## A harness detector fixed along the way

Documenting the new export tripped `spec-public-surface`, which reported it undocumented after it HAD
been documented. The cause is HARNESS-104's own defect one level down: `publicApiIdentifiers`
re-assigned `sectionDepth` on every heading matching `/public api/i`, so a nested
`### … Public API …` LOWERED the boundary from 2 to 3 and the next sibling `###` closed the whole
`## Public API Surface` section.

`agent-core` hits it exactly: `### Abort Classification Public API (CORE-027)` is followed by
`### Schema (CORE-015)`, and **every table below that point was invisible** — the parser saw 69 of the
SPEC's 143 documented identifiers. The outermost match now owns the extent (`||` rather than `=`),
and `agent-core`'s frozen undocumented-export debt drops 134 → 93: 41 exports were documented all
along and counted as debt. Two cases pin it, red-proved by reverting the one-token change.

## Test Plan

`packages/agent-core/src/services/__tests__/same-tool-input-guard.test.ts` — four cases; two red
against the unfixed code:

```
✓ allows exactly maxSameToolInputs identical calls
× throws on the call after that, carrying what tripped it
  → expected undefined to be type of 'function'
✓ does not conflate different inputs to the same tool
× rejects the run, and the error is distinguishable from any other failure
  → The instanceof assertion needs a constructor but undefined was given
Tests  2 failed | 2 passed (4)
```

Two of the four pass against the defect, and the reason is recorded in the file rather than left as a
puzzle: the threshold cases were already correct, so only the TYPE half of the drift was live.

One authoring trap is guarded explicitly. `toThrow(SomeClass)` where the class reference resolves to
`undefined` degenerates to "threw anything" — which would have gone green against the bare `Error`
this item is about. The type cases catch the error and inspect it, and assert
`expect(SameToolInputLoopError).toBeTypeOf('function')` so a vanished import fails loudly instead of
weakening the assertion.

`packages/agent-core/src/services/execution-round-tools.test.ts` pinned the old message string and is
updated to the new contract; it keeps ownership of the threshold, and the type/semantics live in the
new file.

Harness: `scripts/harness/__tests__/check-spec-public-surface.test.mjs` gains a case for the nested
subheading, red-proved by reverting the fix (2 of 15 fail).

`agent-core` 1090 tests; consumers green — `agent-framework` 1367, `agent-cli` 306, `agent-session`
224, `agent-executor` 104. `pnpm harness:scan` 121 passed.

## User Execution Test Scenarios

**Not applicable, and the item's own condition is what decides it.** The scenario was reserved for
"if the owner chooses to change the semantics to abort (success)". That option was rejected with
reasons above, so the observable effect is unchanged: a run that hits an identical-input loop still
stops and still rejects. What changed is the error's TYPE and message — an SDK-caller-facing detail
with no product surface to run.

The behaviour that IS observable to a caller — that the run rejects rather than resolving successfully
— is asserted through the public `run()` API in the regression file, driven end to end with a scripted
provider. That is engineering verification and is recorded in the Test Plan, not claimed as
user-execution evidence.
