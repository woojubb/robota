---
title: 'BEHAVIOR-2698: Preserve non-clean diagnostic evidence across scan receipt reuse'
issue: https://github.com/woojubb/robota/issues/2698
status: in-progress
created: 2026-09-11
priority: medium
urgency: soon
area:
  - scripts/harness
depends_on: []
---

# BEHAVIOR-2698: Preserve non-clean diagnostic evidence across scan receipt reuse

## Objective

Ensure an unchanged-tree scan receipt never turns a known finding or unavailable detector into a
clean-looking cache hit. The receipt path must preserve previous non-clean diagnostic evidence,
re-render it visibly, and re-run the affected covered detector while retaining no-op reuse for a
wholly clean covered result.

## Plan

- [ ] TC-01 — Define and validate a versioned receipt payload that represents either a wholly clean
      covered result or an immutable, canonical non-clean diagnostic report.
- [ ] TC-02 — Make missing, malformed, incompatible, duplicate, or unmappable diagnostic receipt
      data a cache miss rather than a clean result.
- [ ] TC-03 — Re-render a cached finding or unavailable result and re-run its named covered detector
      on an unchanged-tree hit; do not write a new full receipt from that partial re-check.
- [ ] TC-04 — Preserve the existing no-detector reuse path only for an unchanged wholly clean covered
      receipt, and prove both paths with focused two-run fixtures.

## Test Plan

Use focused Vitest unit tests for receipt-schema validation and reuse planning, then an integration
fixture over the receipt-aware runner seam. The fixture will run once to capture an unavailable or
finding result, run again against the same identity, assert the original stable diagnostic ID is
rendered and the named detector runs again, and separately assert a valid clean receipt skips its
covered detector. Run the receipt and runner test files together after each behavior increment.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This work changes only private repository harness receipt and diagnostic behavior. It
introduces no Robota product CLI, TUI, browser, public SDK, or installed-package action that an end
user can execute as a distinct behavior.
