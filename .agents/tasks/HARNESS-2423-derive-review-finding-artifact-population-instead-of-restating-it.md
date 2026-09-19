---
title: 'HARNESS-2423: derive review-finding artifact population instead of restating it'
issue: https://github.com/woojubb/robota/issues/2423
status: todo
created: 2026-09-20
priority: medium
urgency: soon
area: review-contract harness and orchestration registry
depends_on: []
---

# HARNESS-2423: derive review-finding artifact population instead of restating it

## Objective

Remove the two-owner drift between `scan-review-findings.mjs` and the orchestration map. The scanner's
review-artifact population must be derived by the map or mechanically validated against it, so adding
another review-contract input cannot leave the authoritative registry describing an older population.

## Evidence

- PERF-2423 local review found the map claiming two inputs while the scanner read five.
- Commit `72c69f371` had already expanded the scanner from two inputs to three without updating the
  map, proving this is a repeated mechanism gap rather than a one-off documentation typo.
- Registered on umbrella issue #2423:
  https://github.com/woojubb/robota/issues/2423#issuecomment-5744533786

## Plan

- [ ] Choose one owner for the review-artifact population and define the map projection from it.
- [ ] Add a falsifiable scanner test that fails when the map and executable population diverge.
- [ ] Remove the PERF-2423 containment note after the derived projection is verified.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This concerns only repository review-contract metadata and exposes no runnable Robota
product, SDK, CLI, TUI, browser, configuration, or other user-observable runtime behavior.
