---
title: 'HARNESS-2670: Register the BEHAVIOR-2003 GATE-WRITE entry in the immutable attribution legacy list'
issue: https://github.com/woojubb/robota/issues/2670
status: todo
created: 2026-09-19
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
---

# HARNESS-2670: Register the BEHAVIOR-2003 GATE-WRITE entry in the immutable attribution legacy list

## Objective

Register the immutable, unattributed `[GATE-WRITE] — ✅ PASS | 2026-09-15` entry of the BEHAVIOR-2003 spec
in `scripts/harness/immutable-attribution-legacy.json` by exact fingerprint, so the post-merge completion
close-out that archives that spec (delivery PR #2739) keeps `scan-gate-verdict-attribution` green without
rewriting historical evidence. Uses the issue #2736 mechanism as built; no scan logic changes.

## Plan

- [ ] TC-01: Add the fingerprint-pinning test case and the legacy entry; prove the case red without the entry.
- [ ] TC-02: Run the affected scan suite in PR context.
- [ ] TC-03: Run the whole attribution scan test file.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Nothing a person runs changes — no command, screen, output or setting; only the repository's own
evidence-attribution scan stops reporting one immutable historical entry as a new violation.
