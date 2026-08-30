---
title: 'HARNESS-133: GATE-COMPLETE evidence accepts non-reproducible placeholder commands'
issue: https://github.com/woojubb/robota/issues/2552
status: todo
created: 2026-08-30
priority: medium
urgency: soon
area: workflow harness
depends_on: []
---

# HARNESS-133: GATE-COMPLETE evidence accepts non-reproducible placeholder commands

## Objective

Make every command accepted as GATE-COMPLETE evidence concrete and reproducible. The gate currently
accepts any non-empty `**Command:**` field, so a descriptive placeholder can be paired with output from
a different real command and still satisfy the exact-command criterion.

Observed while reviewing PROC-023: `node -e '<parse ...>'` and `node -e '<assert ...>'` were accepted
even though copying either displayed command cannot reproduce the recorded output. Independent depth
review classified the validation gap as foundational because the same evidence shape can recur in every
later completion record.

## Plan

- [ ] Define whether the evidence contract validates a concrete command shape or binds the command,
      exit code, and captured output at record time.
- [ ] Add a regression case that proves a placeholder command cannot satisfy GATE-COMPLETE.
- [ ] Implement the selected fail-closed validation in the owning record/judge path without rejecting
      legitimate manual actions or documented skips.
- [ ] Inventory existing accepted evidence for non-reproducible command descriptions and choose an
      explicit compatibility or repair policy.

## Test Plan

- Add focused Vitest coverage around `gate.mjs record`, `tcEntriesExist()`, and GATE-COMPLETE judging.
- Red-proof the placeholder case against the current implementation before applying the validator fix.
- Run the affected harness scans and the plan-order/gate contract suites.

## User Execution Test Scenarios

Not applicable — this is repository-internal workflow enforcement with no runnable Robota product
surface. Engineering evidence belongs in the Test Plan.
