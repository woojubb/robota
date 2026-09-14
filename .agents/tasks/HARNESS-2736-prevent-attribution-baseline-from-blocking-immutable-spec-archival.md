---
title: 'HARNESS-2736: prevent attribution baseline from blocking immutable spec archival'
issue: https://github.com/woojubb/robota/issues/2736
status: todo
created: 2026-09-15
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
---

# HARNESS-2736: prevent attribution baseline from blocking immutable spec archival

## Objective

Prevent `gate-verdict-attribution` from turning immutable, pre-existing active-spec evidence into an
unfixable failure only when that spec is archived. Snapshot the exact legacy entry fingerprints while
continuing to reject any genuinely new or altered unattributed entry.

## Plan

- [ ] Add an exact-fingerprint legacy baseline and regression coverage for unchanged versus altered
      unattributed entries.
- [ ] Snapshot the currently exposed active-spec debt and prove the attribution scan accepts the
      byte-identical REFACTOR-025 archive.
- [ ] Run the focused test and affected scan, then complete the Task/spec pair.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This correction changes only repository-maintainer validation of immutable planning
evidence and exposes no Robota runtime, CLI, provider, API, or other product surface.
