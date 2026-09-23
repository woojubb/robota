# DAG Scheduler Specification

## Purpose

Owns schedule evaluation, scheduled run triggering, batch triggering, and catchup logic for DAG
runs. Computes scheduling windows and validates time ranges; delegates actual run creation to
`dag-runtime`'s `RunOrchestratorService`.

## Boundaries

- Does not execute task payloads directly — that is `dag-worker`.
- Does not own API response shaping — that is `dag-api`.
- Does not own cron expression parsing or external scheduler integration — out of scope for this
  package.

## Contract

- Batch triggering (`triggerScheduledBatch`) is fail-fast: it stops at the first failure. Every
  outcome has one shape — `ok: true` with `startedRuns` listing what actually started (possibly
  nothing) and an optional `partialError` naming where and why it stopped. A first-item failure is
  not a differently-shaped result from a later one.
- Catchup validates date parsing, interval positivity, slot-count limits, and range ordering before
  triggering anything.

## Open design question — catchup slot semantics

The slot-count formula and the triggering loop must stay consistent with each other, and their
combined semantics (inclusive-endpoint vs. half-open range) needs to be a deliberate, documented
choice rather than an accident of the current formula — see the implementation for the current
formula/loop pairing. Whichever semantics is chosen, the `maxSlots` validation must use the same
formula as the loop, to avoid the validation and the actual run count disagreeing.
