---
title: 'RUNTIME-006: a turn identity that is optional in four places'
status: in-progress
created: 2026-08-08
priority: medium
urgency: soon
area: packages/agent-framework, packages/agent-interface-transport
depends_on: []
---

# RUNTIME-006 — a turn identity that is optional in four places

**Source:** review findings on PR #1653

## Historical scope correction (pre-implementation)

At recommendation time, the enqueue-time throw described below contained the original missing-id
construction defect but did not remove its cause. The debt was wider than the four signatures in the
title: public concrete `InteractiveSession.submit()` accepted the same framework-internal options
object that queue drain used to re-enter an accepted submission. That shared channel made
`resumeTurnId` forgeable and forced identity to remain optional through execution and settlement.

The transport-owned `ISubmitOptions` contract is already correct: it exposes only `driverId`. The
framework implementation was wider than that contract and was the boundary to correct.

## Recommendation Gate — 2026-08-13

**Depth verdict: FOUNDATIONAL.** Optional settler parameters are a downstream symptom. New
submissions and queued-turn resumption currently share `submit(..., ITurnOptions)`, so a local
signature tightening would either keep the forged-resume path or recreate optional identity at the
next queue boundary.

**Recommended design:**

1. Make public `InteractiveSession.submit()` accept the transport-owned `ISubmitOptions` only and
   explicitly project its allowed fields into framework-internal turn options.
2. Make every new submission call `TurnSettlerRegistry.begin()` exactly once. Remove
   `resumeTurnId` from the new-submission options shape and from `acceptSubmission()`.
3. Make `IQueuedInput.turnId` required. Carry the accepted identity in a required internal
   accepted/queued-turn context through execution.
4. Replace queue drain's recursive call to public `submit()` with a private/internal resume callback
   that receives the complete queued entry. JavaScript callers and type assertions therefore cannot
   inject an old identity through the public API.
5. Make `executePrompt` receive a required turn identity independently of optional behavioral turn
   options. Make `TurnSettlerRegistry.settle/fail/refuse` and `IQueueSettlers.refuse` accept only
   `string`, and remove all undefined guards and conditional identity propagation.
6. Preserve every existing terminal outcome: successful, interrupted, thrown/rejected resumption,
   coalesced, dropped, cancelled, queue clear, and shutdown all settle the original handle exactly
   once. Add negative type coverage plus a runtime forged-property regression.
7. Update the framework SPEC before implementation and add a major changeset for narrowing the
   exported concrete class method to its already-published interface contract. The interface package
   requires no contract change because its public shape is already correct.

**Finding-depth evidence:** the independent triage classified the item `FOUNDATIONAL`. It traced the
shared public/internal channel through `interactive-session.ts`,
`interactive-session-execution-contracts.ts`, `interactive-session-accept-submission.ts`, the queue
drain and optional active identity in `interactive-session-execution-controller.ts`, and the silent
settler guards in `turn-settler-registry.ts`. It also confirmed that a brand alone is insufficient:
runtime JavaScript or a type assertion could still feed the public resume channel.

**Independent proposal review:** `REVIEW VERDICT: ENDORSE` — 2026-08-13. The reviewer confirmed that
public submission, framework-internal new-turn acceptance, and queued resumption are three distinct
operations; that a private complete-queued-entry resume path is the minimum sufficient design; that
it preserves RUNTIME-003 identity-at-acceptance and always-settling handles; and that framework is
the correct implementation owner while the existing transport contract remains unchanged. The
review also required that `completionOf()` not survive as an alternate identity-injection seam
without a demonstrated internal need.

## Historical defect

Before this implementation, `ITurnHandle.completed` promised to settle while four signatures allowed
it not to:

| declaration                                               | type                  |
| --------------------------------------------------------- | --------------------- |
| `IQueuedInput.turnId`                                     | `string \| undefined` |
| `ITurnOptions.resumeTurnId`                               | `string \| undefined` |
| `TurnSettlerRegistry.settle/fail/refuse` (`turnId` param) | `string \| undefined` |

Every settle path opened with `if (turnId === undefined) return;`, so an entry built without an id
could take the queued path while every refusal silently no-op'd and its `completed` never settled.

**That defect shipped.** In RUNTIME-003 P2 the queue half was inert because the id was never threaded
onto the entry, and no test failed. It was found by reading, not by running.

## What had already been done before RUNTIME-006

`PendingInputQueue.enqueue` threw on an entry with no `turnId` (PR #1653). That converted the
silent version into a thrown one at the moment the entry is built, and it is one comparison.

It was containment, not the fix: one construction site at runtime for one declaration.

## Original requested correction

Make the identity non-optional where it is load-bearing:

- `IQueuedInput.turnId: string` — a queued submission always has one; the queue now refuses entries
  without one anyway, so the type should say what the code already enforces.
- `TurnSettlerRegistry.settle/fail/refuse(turnId: string, …)` — and drop the three
  `if (turnId === undefined) return;` guards with it. A no-op settle is the failure, not a defence.
- `ITurnOptions.resumeTurnId` stayed optional — it was absent on a first submission — but its
  "set ONLY by the queue drain, never by a caller" contract is a comment. Either make it unforgeable
  (a branded type, or a separate internal options shape the public `submit` cannot express) or accept
  it and say so where it is declared.

## Why it was not done in #1653

It is a signature change across three files and their callers, in a PR already carrying the
behavioural fix. Splitting the type change out keeps the review of each about one thing.

## Acceptance

`turnId` is required wherever a settle depends on it; the three `undefined` early-returns are gone;
`interactive-session-execution-contracts.ts` and `turn-settler-registry.ts` typecheck without them;
the RUNTIME-003 suites stay green.

## User Execution Test Scenarios

**Applies.** Before the fix, an untyped JavaScript consumer could inject the internal resume property
through public `InteractiveSession.submit()`. The completed behavior is that this runtime extra
property is ignored, a fresh identity is minted, and both handles settle with their own responses.

- **Durable agent-run scenario:**
  [`.agents/evals/scenarios/runtime-006-public-submit-identity-agent-run.md`](../evals/scenarios/runtime-006-public-submit-identity-agent-run.md)
- **Executability:** `agent-executable`; it drives the public framework SDK with a deterministic local
  provider fixture and no credentials or external service.
- **Exact Bash, fixture, expected output/exit, and cleanup:** owned by the linked durable artifact.
- **Observable:** while a first turn is held in flight, a JavaScript-shaped second public submission
  carrying forged `resumeTurnId` must receive a fresh distinct identity; both original handles must
  settle with their own responses and the queue must drain.
- **Observed evidence:** executed unchanged on 2026-08-13; exit `0`. The public SDK reported
  `forgedResumeIdIgnored: true`, distinct identities, correctly correlated `FIRST_TURN_OK` and
  `SECOND_TURN_OK` settlements, exactly two provider calls, and `pendingAfterCompletion: 0`. Every
  exact assertion matched, and cleanup removed the materialized script and bounded temporary root.

**DONE-GATE-STAGE-1: PASS — 2026-08-13.** The independent guardian confirmed applicability,
public-SDK reachability, a complete non-interactive exact Bash recipe, deterministic provider-free
fixtures, bounded admission/settlement timeouts, exact identity/correlation/queue observables, exit
semantics, and bounded cleanup. It also confirmed that `Observed evidence: EMPTY` is correct before
implementation and that no engineering test output is being substituted for user evidence.

## Implementation checkpoint — 2026-08-13

The endorsed boundary is implemented. Public `InteractiveSession.submit()` accepts and explicitly
projects transport-owned `ISubmitOptions`; framework-only wake metadata enters a separate new-turn
path; and a complete required-identity queue entry resumes through a private path without re-entering
public acceptance. `IQueuedInput.turnId`, execution identity, queue refusal, and registry
settle/fail/refuse are required. `resumeTurnId`, `completionOf()`, conditional identity propagation,
the enqueue-time runtime stopgap, and the three undefined no-op guards are gone.

The internal `ITurnOptions` extends the transport-owned public SSOT and owns only wake source/task
additions. A major framework changeset records the concrete-class source break. The framework SPEC,
README, and SDK guide describe the new public contract and handle semantics.

Verification at this checkpoint: RED reproduced forged-ID acceptance plus five optional-type gaps;
GREEN passes the focused turn/wake/goal suites, framework typecheck/build/lint, all 160 framework
test files (1,320 tests), MCP correlation (4 tests), the public SDK scenario, docs build, and 108
harness scans (1 skipped). The execution-controller file-size ratchet also tightened.
