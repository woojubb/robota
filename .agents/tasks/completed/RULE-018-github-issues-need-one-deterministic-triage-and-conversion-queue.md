---
title: 'RULE-018: GitHub Issues need one deterministic triage and conversion queue'
issue: https://github.com/woojubb/robota/issues/2468
status: done
created: 2026-08-29
completed: 2026-08-29
priority: high
urgency: now
area: GitHub issue intake, label governance, backlog conversion, and harness enforcement
depends_on: []
---

# RULE-018: GitHub Issues need one deterministic triage and conversion queue

## Objective

Make GitHub Issues cheap to classify and deterministic to select without creating a second execution
authority beside in-repository Tasks. GitHub priority labels own only the pre-Task intake and conversion
queue. Once an Issue becomes a Task, the Issue priority label is removed and Task `priority`/`urgency`
remain the sole execution authority.

Source issue: https://github.com/woojubb/robota/issues/2468.

Issue conversion: one Task. The foundational cause is an undefined Issue-to-Task priority handoff;
without it, a label taxonomy and its guard would make two independently mutable queues. The label
registry, forms, triage procedure, handoff rule, and enforcement are one independently verifiable
governance outcome that closes that cause. No package or product behavior is part of this Task.

Owner approval (verbatim, 2026-08-29):

> 권장 수정안이 타당한 이유를 가지고 있다면 수정안대로 승인한다.

The approval condition holds because 257 open Issues and 104 open Tasks are different populations, only
20 open Tasks cite an Issue, and the existing Issue↔Task boundary keeps Tasks authoritative for
execution. Removing an Issue's priority label at conversion prevents continuing dual ownership.

## Plan

- [x] Declare every live label in one machine-readable registry, including the seven core Issue labels
      and the exact protected PR-gate labels, without deleting historical labels.
- [x] Replace the Bug and Enhancement Markdown templates and add a Documentation Issue Form; each form
      applies exactly one work kind plus `status:needs-triage` and requires actionable evidence.
- [x] Add the thin Issue triage and conversion invariants to the existing Issue↔Task rule owner and put
      the operational steps in one triage skill linked from `find-to-issue` and `issue-to-backlog`.
- [x] Add a static registry guard and focused tests for schema, core-label cardinality, form references,
      a fixed protected-consumer baseline, and non-empty examination reporting.
- [x] Add a read-only open-Issue audit and a fail-closed conversion command that comments the Task ID/path
      before removing P labels; incomplete write-back or label removal must prohibit implementation.
- [x] Add report-first live label reconciliation that creates or updates registry labels only after
      dry-run and never deletes an unexpected live label.
- [x] Run focused tests, the live dry-run/apply/check sequence, the full harness scan, and
      `pnpm harness:verify-like-ci`.

## Recommendation Gate

- Original depth verdict: `FOUNDATIONAL`. The first proposal made Issue P0/P1/P2 a second executable
  priority authority beside Task `priority`/`urgency`.
- User-approved re-scope: Issue P labels govern only pre-Task selection. At conversion, P0 maps to Task
  `urgency: now`, P1 maps to `urgency: soon`, P2 must be promoted before conversion, and all Issue
  priority labels are removed. Task priority and urgency then exclusively govern execution.
- Re-scoped depth review: `LOCAL`. The registry, forms, triage procedure, handoff rule, and guard close
  one local missing-owner cause and produce one independently verifiable outcome. Protected PR labels
  are a required safety condition because Issues and pull requests share the same label namespace.
- Independent proposal review round 1: `REVIEW VERDICT: REVISE`, `ACTIONABLE FINDINGS: 3`. The revision
  adds an open-Issue audit, makes conversion write back a canonical Task marker before priority removal,
  and fixes the protected-consumer baseline outside the editable registry.
- Independent proposal review round 2: `REVIEW VERDICT: ENDORSE`, `ACTIONABLE FINDINGS: 0`. The reviewer
  confirmed exhaustive read-only Issue auditing, idempotent fail-closed conversion finalization, an
  independently enforced protected-consumer baseline, one post-conversion execution authority, and
  non-destructive live reconciliation.
- Approval gate: `GATE VERDICT: PASS` via Route `DIRECT` for the verbatim conditional instruction above.
  The condition is met by the distinct live Issue/Task populations, the settled optional-front-stage
  boundary, and removal of every Issue P label after the Task marker is read back.
- Implementation gate: 7/7 mechanical criteria PASS on 2026-08-29; no implementation path differed from
  `origin/develop` before the planning checkpoint.

## Test Plan

- Focused Vitest coverage for the registry parser, static guard, live reconciliation planner, Issue
  audit classifier, and fail-closed conversion ordering.
- `node scripts/harness/scan-github-label-registry.mjs`.
- Live registry dry-run, apply, and final no-diff check through `gh`.
- `pnpm harness:scan`.
- `pnpm harness:verify-like-ci`.

## User Execution Test Scenarios

**Not applicable.** RULE-018 changes GitHub administrative metadata and tooling, Issue Forms,
repository governance rules/skills, and harness verification scripts. It does not add or alter a
runnable Robota CLI, TUI, browser UI, or public SDK/example surface. Focused tests, static scans, and
live GitHub dry-run/apply checks are engineering/administrative verification, not user-executable
product scenarios.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Author reason:** A user-execution scenario is not applicable because RULE-018 exposes no runnable
product capability or enabling seam; all observable outcomes belong to the engineering and
GitHub-administration Test Plan.

## Result

Implemented the approved minimal Issue intake and conversion queue. The live repository now has all 23
declared labels with zero declared drift; the four missing core labels were created without deleting or
rewriting historical labels. The read-only audit classified all 256 open Issues observed at execution
time: 0 valid intake, 0 unconverted priority candidates, 2 Task-linked, and 254
malformed/unclassified. Existing Issues were deliberately not bulk-classified.

Verification passed: focused Vitest 23/23, hermetic harness 1,153/1,153, static registry scan over 33
registry/form/consumer relations, final-state full harness scan 147 passed and 2 skipped, and CI-equivalent
verification 13/13 stages. No package source or public product surface changed, so package SPEC, README,
content guide, build, publish, and docs deployment steps were not applicable.
