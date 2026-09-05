---
title: 'INFRA-177: the gate-evaluator isolation unit is a commit, not a branch range'
issue: https://github.com/woojubb/robota/issues/2610
status: todo
created: 2026-09-06
priority: high
urgency: now
area:
  - scripts/harness/scan-gate-evaluator-isolation.mjs
depends_on: []
---

# INFRA-177: the gate-evaluator isolation unit is a commit, not a branch range

## Objective

`scan-gate-evaluator-isolation` reads the whole branch range as "the same diff", which makes its own
stated remedy unreachable and freezes `scripts/harness/gate.mjs` and `.claude/hooks/` against every
change. Judge each commit instead, so a checkpoint recorded before the evaluator change stops counting
as evidence authored alongside it.

## Plan

- [ ] U01 — enumerate the branch's commits and judge each one's own diff.
- [ ] U02 — name the offending commit in the finding, so the reader knows which one to split.
- [ ] U03 — keep the range reading as the fallback for a run with no commits of its own (a staged or
      working-tree run), so a pre-commit check still has something to judge.

## Completion Criteria

- [ ] TC-01: a single commit carrying both an evaluator path and a spec-doc path is still one finding.
      This is the shape the rule exists for and it must not weaken.
- [ ] TC-02: a checkpoint commit followed by an evaluator commit produces no finding. Red before the
      change: the range reading reports one.
- [ ] TC-03: the finding names the commit.
- [ ] TC-04: a merge commit that itself carries both is still refused.
- [ ] TC-05: `npx vitest run scripts/harness/__tests__/scan-gate-evaluator-isolation.test.mjs` passes
      in full, including the two pre-existing cases, which are the control that the pure predicate is
      unchanged.

## Test Plan

All five are unit cases over the pure exported predicates, driven by literal path lists, so no
repository state is needed. TC-01 and TC-04 are the anti-weakening cases; TC-02 and TC-03 were run RED
before the change. TC-05 is the owning suite: 2 → 6 passed, none broken.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes which commits one of the repository's own internal maintenance scripts
refuses. Nothing it touches is published, installed, or reachable from any command a person outside
this repository can run — there is no screen, no CLI flag, no SDK entry point and no file a user of
Robota ever sees, so there is no surface on which a scenario could be performed.
