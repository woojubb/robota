---
title: 'RULE-2698: Migrate hooks and Husky process vetoes to diagnostics'
issue: https://github.com/woojubb/robota/issues/2698
status: in-progress
created: 2026-09-12
priority: medium
urgency: soon
area: TODO
depends_on: []
---

# RULE-2698: Migrate hooks and Husky process vetoes to diagnostics

## Objective

Establish the B-phase foundation for replacing repository-process vetoes with visible, correlated
diagnostics. Freeze the current PreToolUse and exit-bearing Husky population, define the shared
hook-diagnostic producer contract, and classify every source before a later slice changes whether an
operation is blocked, reported in CI, or retired.

## Plan

- [x] B1 / TC-01 — Create the parent-owned versioned manifest for all 161 scan registrations, every
      required-status context, eight registration identities over seven PreToolUse source files, each
      direct Husky veto path, and six tracked shims. A registration and reusable source remain distinct.
- [x] B1 / TC-02 — Extract one reusable registration-facts reader for the current reachability scan and
      inventory validator, then wire live-manifest drift as an always-run, non-vetoing diagnostic
      producer in full and receipt-reuse `pnpm harness:scan` paths, outside the persisted receipt.
- [x] B1 / TC-03 — Extend the A01 result/renderer/receipt contract for a distinct correlation ID and
      add a publisher-port adapter that returns a serializable delivery result, including explicit
      publication-unavailable evidence.
- [x] B1 / TC-04 — Prove missing/collapsed identities, retained-block rationale gaps, duplicate events,
      and publisher failures cannot become clean; keep every existing hook's operational disposition
      unchanged while recording the B2/B3 migration sequence.

## Test Plan

Use focused Vitest fixtures for the complete migration manifest, registration and veto-path inventory,
correlation-aware hook delivery, publication failure, and receipt reuse. Run the normal harness scan on
the clean tree, then use deterministic runner fixtures to prove a current inventory mismatch renders a
non-clean diagnostic while preserving a zero integration exit when product-quality scans are clean.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This work changes only private repository hook registration, Git-hook policy, and harness
diagnostic reporting. It adds no Robota CLI, TUI, browser, public SDK, or installed-package behavior
that an end user can invoke as a distinct product action.
