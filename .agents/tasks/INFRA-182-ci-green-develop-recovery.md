---
title: 'INFRA-182: restore green CI from the current develop baseline'
issue: https://github.com/woojubb/robota/issues/2617
status: in-progress
created: 2026-09-08
priority: high
urgency: now
area:
  - harness scans
  - dependency audit
  - task lifecycle records
depends_on: []
---

# INFRA-182: restore green CI from the current develop baseline

## Objective

Make the current `origin/develop` baseline and a fresh pull request pass the required scan,
dependency, build, test, typecheck, lint, and GitHub checks without weakening the guards or deleting
historical evidence.

## Spec

`.agents/spec-docs/active/INFRA-182-ci-green-develop-recovery.md`

## Plan

- [ ] TC-01 — annotate only the twelve stale completed-task evidence references caused by the
      intentional work-run removal.
- [ ] TC-02 — reconcile and terminalize CLI-1990 and CLI-2004 only after their existing criteria and
      paired-spec evidence are verified.
- [ ] TC-03 — prune the two retired examined-size adoption entries and pass the full integration scan.
- [ ] TC-04 — add bounded fixed-version dependency overrides and regenerate the lockfile; pass the
      workflow-equivalent OSV audit and frozen install.
- [ ] TC-05 — pass local PR-equivalent build, tests, typecheck, lint, and affected scans.
- [ ] TC-06 — open the PR, resolve every required red check, and record the final all-green head.

## Completion Criteria

- [ ] TC-01: `node scripts/harness/check-done-evidence.mjs` exits 0.
- [ ] TC-02: `node scripts/harness/scan-task-merged-citation.mjs` exits 0.
- [ ] TC-03: full integration `pnpm harness:scan` exits 0.
- [ ] TC-04: dependency audit and frozen install exit 0.
- [ ] TC-05: build, test, typecheck, lint, and affected scan exit 0.
- [ ] TC-06: required PR checks are all successful on the final head.

## Test Plan

Run the exact commands named in the paired spec. Preserve the final command output and GitHub check
summary in the spec Evidence Log; a successful local subset is not a substitute for the final PR
check result.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is repository-internal CI and dependency maintenance with no shipped user-facing surface; its observable outputs are scans, builds, tests, and hosted checks rather than a product interaction.
