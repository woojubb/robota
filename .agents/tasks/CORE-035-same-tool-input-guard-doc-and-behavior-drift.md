---
title: "CORE-035: the same-tool-input loop guard throws a plain Error at N+1 that resolves as a hard failure, while the SPEC documents an AbortError at N with fixed text that would resolve as a successful interruption — the error TYPE drift changes the run's success semantics"
status: todo
created: 2026-08-13
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

## Direction

Doc→code drift; pick one and make both agree. The code's failure semantics are arguably correct
post-CORE-027 (a guard trip is not a user abort), so the cheaper fix is doc-side: state the guard
throws a plain `Error` (a failed run) at the `N+1`-th identical call, with the real message. If the
owner wants abort semantics instead, that is a small code change — but the SPEC must state one.

## Test Plan

- A test pins the guard's actual type, message, threshold, and the resulting run `success`/`interrupted`
  values; the SPEC matches it.
- `pnpm harness:verify -- --scope packages/agent-core` green.

## User Execution Test Scenarios

Not applicable — this is a doc↔code reconciliation of an internal guard's error semantics; the guard's
observable effect (a run that stops on an identical-input loop) is unchanged in substance. If the owner
chooses to change the semantics to abort (success), a scenario running a tool-loop prompt and observing
the run outcome would apply — specify under that option.
