---
title: 'RULE-2582: Require one non-empty spec tags contract at planning and final validation'
issue: https://github.com/woojubb/robota/issues/2582
status: done
created: 2026-09-20
completed: 2026-09-20
priority: high
urgency: now
area: spec-doc frontmatter and gate planning validation
depends_on: [BEHAVIOR-2664]
---

Spec: `.agents/spec-docs/done/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md`

# RULE-2582: Require one non-empty spec tags contract at planning and final validation

## Objective

Make the early planning gate and final frontmatter scan enforce one non-empty `tags` contract so a
document accepted by PLAN cannot be rejected later solely because `tags: []` was permitted earlier.

## Plan

- [x] TC-01 — Capture the pre-fix GATE-WRITE failure with the focused three-file regression suite.
- [x] TC-02 — Make GATE-WRITE reject missing, bare, and empty tags while retaining every supported non-empty YAML form.
- [x] TC-03 — Make `new-spec.mjs` reject explicit empty tags while retaining the omitted default and valid explicit lists.
- [x] TC-04 — Preserve final frontmatter validation parity for the same valid and invalid fixtures.
- [x] TC-05 — Run the affected PR-context harness scan against `origin/integration/agreement-2664`.

## Test Plan

Exercise `gate.test.mjs`, `check-spec-doc-frontmatter.test.mjs`, and `new-spec.test.mjs` with empty,
missing, flow-array, and block-array tags. The same invalid fixture must fail at the first planning
boundary and at final validation; valid scaffold output must pass both.

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is a private repository planning-metadata contract with no Robota product command,
TUI, browser, public SDK, or installed-package behavior for an end user to execute.
