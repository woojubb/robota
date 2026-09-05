---
title: "INFRA-169: Declare GATE-DONE's recorded-pass re-run rule in gate-catalogue.md"
issue: https://github.com/woojubb/robota/issues/2588
status: todo
created: 2026-09-06
priority: medium
urgency: soon
area: harness
depends_on: []
---

# INFRA-169: Declare GATE-DONE's recorded-pass re-run rule in gate-catalogue.md

## Objective

`GATE-DONE`'s ordering check reads only the last recorded `[GATE-PLAN]` entry, so an out-of-order
re-run that later FAILs blocks GATE-DONE permanently even after a real PASS already upgraded the
document (INFRA-162, issue #2219). Declare the exception in `gate-catalogue.md` (a `Re-run rule`
column, `recorded-pass`, on the `GATE-DONE` row only) instead of inferring it in code, per the
guardian verdict on the withdrawn prior attempt (issue #2588).

## Plan

- [x] Add a `Re-run rule` column to `gate-catalogue.md`'s Prior-gate map; mark only the `GATE-DONE`
      row `recorded-pass`.
- [x] `parsePriorGateMap` reads the new column; `LANE_L1['GATE-DONE'].prior` now comes from the
      catalogue instead of a hardcoded object.
- [x] `orderingResult` accepts a recorded PASS whose Status-upgrade target matches the document's
      current status, ONLY when the row declares `recorded-pass`.
- [x] `frontmatter-status` accepts a PASS recorded under an L1 composite's composed gate name.
- [x] Added regression tests for both, and confirmed the existing "keeps the last-entry rule for an
      ordinary gate" test stays green.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Internal harness gate-judging logic (`gate.mjs`, `gate-catalogue.md`) with no product
surface — no end user of the SDK/CLI/apps this repository ships can observe or run this change;
verification is the engineering test plan (TC-01 to TC-03) in the paired spec document.
