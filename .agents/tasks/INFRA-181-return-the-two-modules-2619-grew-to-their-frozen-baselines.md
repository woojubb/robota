---
title: 'INFRA-181: return the two modules #2619 grew to their frozen baselines'
issue: https://github.com/woojubb/robota/issues/2620
status: todo
created: 2026-09-06
priority: high
urgency: now
area:
  - scripts/harness/allocate-work-item-id.mjs
  - scripts/harness/new-spec.mjs
  - scripts/harness/file-size-baseline.json
depends_on: []
---

# INFRA-181: return the two modules #2619 grew to their frozen baselines

## Objective

`scripts/harness/allocate-work-item-id.mjs` is 479 lines against a frozen 472 and
`scripts/harness/new-spec.mjs` is 449 against 446, both grown by `072a7354d` (#2619). `file-size`
reports the whole repository in one verdict and is a scan-suite member, so `develop` is red and every
branch whose diff selects that scan is blocked by growth it did not cause. Bring both back under by
MOVING code out, never by raising a baseline.

## Plan

- [ ] U01 — move the GitHub-issue binding out of `scripts/harness/allocate-work-item-id.mjs` into its
      own module and re-export it, so every existing importer is unchanged.
- [ ] U02 — move the paired-Task reader out of `scripts/harness/new-spec.mjs` into its own module and
      re-export it.
- [ ] U03 — tighten `scripts/harness/file-size-baseline.json` in the same change, and read the diff:
      `--write-baseline` rewrites every entry from the measured count, so it RAISES an entry that is
      still over its limit.

## Completion Criteria

- [ ] TC-01: `node scripts/harness/scan-file-size.mjs` exits 0 with no finding. Red before the change:
      two `file-grew-past-baseline` findings naming these two files.
- [ ] TC-02: every number the `scripts/harness/file-size-baseline.json` diff changes is LOWER than the
      one it replaces, and no entry is added or raised. Three change: the two files above, plus
      `scripts/harness/run-all-scans.mjs` 1914 to 1897, an unlocked gain the same write locks.
- [ ] TC-03: `node scripts/harness/scan-rule-statement-floor.mjs` exits 0 and its
      `::examined:: <n> rule identifiers` count is not lower than on the integration base — moving a
      module must not remove an emitted identifier from the collection set.
- [ ] TC-04: `node scripts/harness/scan-measurement-provenance.mjs` exits 0.
- [ ] TC-05: `npx vitest run scripts/harness/__tests__/allocate-work-item-id.test.mjs` and
      `scripts/harness/__tests__/new-spec.test.mjs` — the direct consumer suites of the moved code —
      both pass with no consumer file edited.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                     | Notes                              |
| ----- | --------- | --------------------------------------------------- | ---------------------------------- |
| TC-01 | CI smoke  | `scan-file-size.mjs` exit code and finding list     | red today on both files            |
| TC-02 | CI smoke  | `git diff` of the baseline file                     | guards the tool's silent raise     |
| TC-03 | CI smoke  | `scan-rule-statement-floor.mjs`, count vs. the base | guards silent scan blinding        |
| TC-04 | CI smoke  | `scan-measurement-provenance.mjs`                   | a moved reader must stay reachable |
| TC-05 | unit      | the two direct consumer suites                      | re-exports keep consumers unedited |

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This relocates functions between two of the repository's own internal maintenance scripts
so a size scan over those scripts stops reporting growth. Nothing it touches is published, installed,
or reachable from any command a person outside this repository can run — there is no screen, no CLI
flag, no SDK entry point and no file a user of Robota ever sees, so there is no surface on which a
scenario could be performed.
