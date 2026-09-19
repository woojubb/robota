---
title: 'RULE-2582: Require one non-empty spec tags contract at planning and final validation'
issue: https://github.com/woojubb/robota/issues/2582
status: todo
created: 2026-09-20
priority: high
urgency: now
area: spec-doc frontmatter and gate planning validation
depends_on: [BEHAVIOR-2664]
---

# RULE-2582: Require one non-empty spec tags contract at planning and final validation

## Objective

Make the early planning gate and final frontmatter scan enforce one non-empty `tags` contract so a
document accepted by PLAN cannot be rejected later solely because `tags: []` was permitted earlier.

## Plan

- [ ] TC-01 — Add a planning-gate regression for `tags: []` and a valid non-empty array.
- [ ] TC-02 — Remove the early evaluator's explicit empty-array allowance and align its diagnostic with the owner parser.
- [ ] TC-03 — Prove scaffold defaults, multi-line tags, and final validation retain their existing valid behavior.
- [ ] TC-04 — Run focused gate and spec-frontmatter tests plus affected harness verification.

## Test Plan

Exercise `gate.test.mjs`, `check-spec-doc-frontmatter.test.mjs`, and `new-spec.test.mjs` with empty,
missing, flow-array, and block-array tags. The same invalid fixture must fail at the first planning
boundary and at final validation; valid scaffold output must pass both.

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is a private repository planning-metadata contract with no Robota product command,
TUI, browser, public SDK, or installed-package behavior for an end user to execute.
