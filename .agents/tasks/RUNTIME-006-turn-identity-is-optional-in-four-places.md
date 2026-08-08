# RUNTIME-006 — a turn identity that is optional in four places

**Type:** REFACTOR
**Status:** in progress
**Filed:** 2026-08-08 (UTC)
**Source:** review findings on PR #1653

## The problem

`ITurnHandle.completed` promises to settle. Four signatures let it not:

| declaration                                               | type                  |
| --------------------------------------------------------- | --------------------- |
| `IQueuedInput.turnId`                                     | `string \| undefined` |
| `ITurnOptions.resumeTurnId`                               | `string \| undefined` |
| `TurnSettlerRegistry.settle/fail/refuse` (`turnId` param) | `string \| undefined` |

Every settle path opens with `if (turnId === undefined) return;`. So an entry built without an id
takes the whole queued path, every refusal silently no-ops, and the caller's `completed` never
settles — a hang, not an error.

**That defect shipped.** In RUNTIME-003 P2 the queue half was inert because the id was never threaded
onto the entry, and no test failed. It was found by reading, not by running.

## What is already done

`PendingInputQueue.enqueue` now THROWS on an entry with no `turnId` (PR #1653). That converts the
silent version into a thrown one at the moment the entry is built, and it is one comparison.

It is not the fix. It covers one construction site, at runtime, for one of the four declarations.

## What this item is

Make the identity non-optional where it is load-bearing:

- `IQueuedInput.turnId: string` — a queued submission always has one; the queue now refuses entries
  without one anyway, so the type should say what the code already enforces.
- `TurnSettlerRegistry.settle/fail/refuse(turnId: string, …)` — and drop the three
  `if (turnId === undefined) return;` guards with it. A no-op settle is the failure, not a defence.
- `ITurnOptions.resumeTurnId` stays optional — it genuinely is absent on a first submission — but its
  "set ONLY by the queue drain, never by a caller" contract is a comment. Either make it unforgeable
  (a branded type, or a separate internal options shape the public `submit` cannot express) or accept
  it and say so where it is declared.

## Why it is not done in #1653

It is a signature change across three files and their callers, in a PR already carrying the
behavioural fix. Splitting the type change out keeps the review of each about one thing.

## Acceptance

`turnId` is required wherever a settle depends on it; the three `undefined` early-returns are gone;
`interactive-session-execution-contracts.ts` and `turn-settler-registry.ts` typecheck without them;
the RUNTIME-003 suites stay green.
