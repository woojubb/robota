---
title: 'BEHAVIOR-2664: Make approval recording enforce prior-gate ordering'
issue: https://github.com/woojubb/robota/issues/2664
status: todo
created: 2026-09-20
priority: critical
urgency: now
area: scripts/harness gate approval evaluator
depends_on: []
---

# BEHAVIOR-2664: Make approval recording enforce prior-gate ordering

## Objective

Make `gate.mjs approve` and `gate.mjs judge --gate GATE-APPROVAL` enforce the same catalogue-declared
prior-gate requirement. Approval recording must refuse before writing a PASS when GATE-WRITE has not
passed or the document is not `review-ready`.

## Source Constraints

- Preserve DIRECT and CLASS approval evidence and review-fingerprint behavior.
- The ordering judgement must run against the in-memory candidate and must not leave a false standing PASS.
- Failure output must name the missing prior gate or status and remain machine-testable.

## Plan

- [ ] TC-01 — Add a regression that reproduces `approve` on a draft with no GATE-WRITE PASS and proves no PASS is written.
- [ ] TC-02 — Route `runApprove` through the same catalogue ordering judgement as `runJudge`.
- [ ] TC-03 — Cover missing prior PASS, wrong status, and the valid review-ready path for DIRECT and CLASS evidence.
- [ ] TC-04 — Run focused gate tests and affected harness verification.

## Test Plan

Use `scripts/harness/__tests__/gate.test.mjs` fixtures for the red and green approval paths, then run
the focused Vitest file and the affected harness scan. Assert the command exit, diagnostic text, and
the complete Evidence Log population so a failing approval cannot leave a standing PASS.

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** The behavior is private repository gate enforcement used by contributors; it exposes no
Robota product CLI, TUI, browser, public SDK, or installed-package interaction for an end user.

## Standing Authorization

**Instruction (verbatim):** "승인합니다. 그리고 앞으로 타당한 근거와 함께 추천안을 제시하면 근거가 타당할 경우 자동으로 승인합니다."

**Given:** 2026-09-20, this conversation.

This authorizes decisions in this initiative that already sit inside agent authority when the
recommendation records its grounds and receives the independent validation required by
`backlog-execution.md` § "Validated recommendations and bounded gate-FAIL corrections". It does not
create a delegated GATE-APPROVAL class, approve a future spec by resemblance, or cover product
direction, a published contract, repository-wide policy files, a user-authored document, or a
protected-branch merge requiring a fresh decision.
