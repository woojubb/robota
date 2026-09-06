---
title: 'INFRA-174: reduce local push process overhead for direct-develop work'
status: todo
created: 2026-09-06
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
no-issue: process-overhead reduction requested directly by the maintainer (see /tmp/robota-issues/PROCESS-OVERHEAD-REPORT.md); no GitHub issue is the source record
---

# INFRA-174: reduce local push process overhead for direct-develop work

## Problem

Two independent sessions doing ordinary, low-risk work (deleting dead code; stopping an
auto-Issue-filing reflex) each lost a large share of their session to local harness friction
unrelated to the correctness of their change: `work-run-measurement` crashing the push with an
uncaught exception whose receipt/trailer lifecycle assumes a claim→PR flow that a
maintainer-approved direct-to-`develop` push does not have, and `scripts/harness/*.mjs` changes
resolving to neither a package owner nor a no-package path in the workspace-affected planner,
falling through to `unknown changed path` and forcing a full-workspace build/test/typecheck for a
change no package graph reaches.

## Resolution

1. `pre-push-work-run.mjs`: `runPrePushGate` no longer throws when work-run measurement is
   invalid — it reports the reason via a new `reportMeasurementAdvisory` step and the push
   proceeds. CI's own `.github/workflows/scans-full.yml` already excludes this same scan
   (`--skip work-run-measurement`) from the blocking integration suite; a local push holding it to
   a stricter bar than CI was the inconsistency.
2. `workspace-plan-shapes.mjs`: `scripts/harness/` added to `NO_PACKAGE_PREFIXES` (the same
   reasoning already applied to `.agents/` — no `packages/*`/`apps/*` build/test/typecheck graph
   reaches it). The specific scope-mapping files under it stay in `GLOBAL_PREFIXES`, checked first,
   so they still correctly force full verification when they change.
3. `file-size-baseline.json`: closed a pre-existing drift (`allocate-work-item-id.mjs` had already
   shrunk below its baseline) that was blocking unrelated pushes.

## Test Plan

- `pnpm exec vitest run scripts/harness/__tests__/pre-push-sequence.test.mjs scripts/harness/__tests__/workspace-affected.test.mjs scripts/harness/__tests__/work-run-validation.test.mjs`
- `pnpm harness:scan` green.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes internal harness/CI tooling (local pre-push gate behavior and
workspace-affected scope mapping); it has no end-user runtime surface, CLI behavior, SDK contract,
or product-facing interaction to execute.
