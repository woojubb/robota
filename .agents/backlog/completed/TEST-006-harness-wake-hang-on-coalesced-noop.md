---
title: 'TEST-006: functional harness wake() hangs when requestWakeup is a no-op'
status: done
created: 2026-06-27
completed: 2026-06-27
priority: medium
urgency: soon
area: packages/agent-framework
depends_on: []
---

# Harness wake() can hang on a coalesced / shutting-down wake

Surfaced by the code review of the TEST-004 retrofits (PR #845).

## What

`ScriptedSessionHarness.wake(instruction, sourceTaskId)` awaits `nextSettledTurn()` after calling
`session.requestWakeup(...)`. But `requestWakeup` is a **no-op** when the session is shutting down or
when `sourceTaskId` is already in flight (coalescing): it returns without submitting a turn, so no
`complete`/`interrupted`/`error` ever fires. The awaited promise then hangs until the per-test
timeout (20s), with no signal that the wake was dropped.

Reachable shapes:

- Two wakes for the same id while the first is still in flight (`await h.wake('a','dup')` racing a
  queued `'dup'` turn).
- Calling `wake()` after shutdown began.

## Why

The harness is the agent's self-verification environment; a silently hanging driver wastes the full
timeout and obscures the real outcome. `wake()` should resolve deterministically — either driving the
turn or reporting that the wake was coalesced/dropped.

## Proposed approach (to confirm)

- Have `wake()` detect the no-op (e.g. return value / state from `requestWakeup`, or a pre-check of
  `wakeTaskIds` + shutting-down) and resolve with a sentinel (e.g. `null` / a `dropped` result)
  instead of awaiting a turn that will never settle.
- Add a harness self-test covering the coalesced and shutting-down cases.

## Test Plan

- New harness self-test in agent-framework asserting a coalesced wake resolves quickly (not via
  timeout) and reports the drop; the existing `background-wake-functional.test.ts` still passes.
- `pnpm --filter @robota-sdk/agent-framework test`, typecheck, `pnpm harness:scan` green.

## User Execution Test Scenarios

Not applicable — agent-facing internal test infrastructure; validated by the harness self-test and
the `functional-coverage` scan (recorded as Test Plan evidence).
