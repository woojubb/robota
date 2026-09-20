---
title: 'PERF-2664: Restore the 128-second CI benchmark for control-plane changes without fail-open caching'
issue: https://github.com/woojubb/robota/issues/2664
status: todo
created: 2026-09-20
priority: low
urgency: later
area: .github/workflows/ci.yml, scripts/harness contract selection and cache
depends_on: []
---

# PERF-2664: Restore the 128-second CI benchmark for control-plane changes without fail-open caching

## Objective

Restore the enforced 128-second push-to-conclusive target for a legitimate harness control-plane
change without skipping applicable contract tests, accepting stale cache markers, or weakening a
failed timing observation into success.

## Problem

DATA-2664 changed checkpoint inventory classification under `scripts/harness/` without changing CI,
contract selection, cache, or benchmark policy. Exact-SHA workflow run
[`35487071025`](https://github.com/woojubb/robota/actions/runs/35487071025) completed all 11 required
contexts successfully, but selected 240/240 contract tests through complete fallback, restored zero
cache hits, recorded only one successful miss marker, and spent 507 seconds in `scans`. The terminal
benchmark job therefore failed its enforced 128-second target.

An unchanged-SHA confirmation run
[`35487503913`](https://github.com/woojubb/robota/actions/runs/35487503913) again completed all 11
required contexts successfully, but `scans` took 530 seconds with only one cache hit and 239 misses.
The terminal benchmark again failed the 128-second target. This rules out the original raw-ref
failure and shows that a warm rerun does not recover the timing contract.

Completed Task `INFRA-151` under closed GitHub issue
[issue #2489](https://github.com/woojubb/robota/issues/2489) established the target with three
101/122/103-second samples (p50 103 seconds). It is historical completion evidence, not an open root
item for this regression. The current finding is registered on open GitHub
[issue #2664](https://github.com/woojubb/robota/issues/2664) because it surfaced in that umbrella's
gate-correctness delivery. Registration evidence:
[foundational finding record](https://github.com/woojubb/robota/issues/2664#issuecomment-5747465105).

An independent depth review classified the cause as `FOUNDATIONAL`: the defect lies in the shared
benchmark/cache/planner ownership boundary, not in DATA-2664's checkpoint-inventory behavior.

## Directions Considered

1. Raise or remove the 128-second threshold. Rejected: it would erase the measurable contract that
   exposed the regression instead of restoring it.
2. Exempt control-plane changes from the benchmark or mark their complete fallback successful
   without execution. Rejected: those are the changes most capable of invalidating gate behavior,
   so an exemption would be fail-open.
3. Revisit control-plane cache invalidation and complete-fallback execution ownership so only
   genuinely affected cache keys are invalidated and unavoidable misses remain bounded and parallel.
   Recommended: it preserves fail-closed coverage while addressing the measured critical path.

## Disposition

**Re-plan as an independent, low-priority Task.** Do not patch the DATA-2664 implementation and do
not claim the performance contract is restored until repeated exact-head measurements satisfy it.

## Plan

- [ ] Reproduce both cold- and warm-cache control-plane benchmark paths and account for every
      selected contract, cache hit/miss, recorded marker, shard, and elapsed second.
- [ ] Identify which global/cache-key inputs make unrelated contracts miss and define the smallest
      fail-closed invalidation boundary with one owner.
- [ ] Bound unavoidable complete-fallback work through deterministic parallel execution without
      hiding missing, cancelled, timed-out, or stale results.
- [ ] Add regression coverage for control-plane input changes, cache reuse, and terminal benchmark
      failure semantics.
- [ ] Produce three successful exact-head workflow-dispatch samples at or below 128 seconds while
      all 11 required contexts remain successful.

## Test Plan

- Unit and harness tests falsify stale-marker reuse, under-selection, missing shards, and timing
  verdict downgrades.
- Full contract verification proves every registered test remains reachable after the change.
- Three official immutable-SHA workflow dispatches record required-context membership, conclusions,
  cache counts, and push-to-conclusive durations at or below 128 seconds.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This Task changes repository-internal CI selection and timing enforcement and exposes no
Robota CLI, TUI, browser, public SDK, or installed-package behavior that an end user can execute. The
three immutable-SHA benchmark runs remain engineering verification owned by the Test Plan above.
