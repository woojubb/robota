---
title: 'HARNESS-133: GATE-COMPLETE evidence accepts non-reproducible placeholder commands'
issue: https://github.com/woojubb/robota/issues/2552
status: in-progress
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

- [x] Define whether the evidence contract validates a concrete command shape or binds the command,
      exit code, and captured output at record time. — **Shape validation, at judge time.** Binding
      output to the command at record time would need `record` to run the command itself, which is a
      contract change for every manual `**Action:**` entry; the shape check closes the observed
      defect (`<…>` placeholders, TBD/TODO) without touching record.
- [x] Add a regression case that proves a placeholder command cannot satisfy GATE-COMPLETE.
      (`gate.test.mjs`: "DONE fails when a **Command:** is a placeholder description …")
- [x] Implement the selected fail-closed validation in the owning record/judge path without rejecting
      legitimate manual actions or documented skips. (`tcEntriesExist` in `gate.mjs`: only
      `**Command:**` lines are judged; `**Action:**` and `**Test skipped:**` are untouched.)
- [x] Inventory existing accepted evidence for non-reproducible command descriptions and choose an
      explicit compatibility or repair policy. — **Left as history, not rewritten.** Measured
      2026-09-04: six accepted records carry a placeholder command — `PROC-018` (L227), `PROC-019`
      (L210), `PROC-020` (L265), `RUNTIME-007` (L412), `INFRA-141` (L309) under `spec-docs/done/`,
      and `ARCH-035` (L336) under `tasks/completed/`. The validator runs when DONE is judged; a
      record that already passed is not re-judged, and editing a closed record to satisfy a later
      rule would forge evidence that was never recorded. PROC-023 replaces its own two entries.
- [ ] Remaining: run the plan-order/gate contract suites as a batch and move this task to
      `completed/` once the change lands.

## Test Plan

- Add focused Vitest coverage around `gate.mjs record`, `tcEntriesExist()`, and GATE-COMPLETE judging.
- Red-proof the placeholder case against the current implementation before applying the validator fix.
- Run the affected harness scans and the plan-order/gate contract suites.

## User Execution Test Scenarios

Not applicable — this is repository-internal workflow enforcement with no runnable Robota product
surface. Engineering evidence belongs in the Test Plan.
