---
title: 'INFRA-175: shrink gate.mjs and run-all-scans.mjs back under their frozen file-size baselines'
issue: https://github.com/woojubb/robota/issues/2596
status: in-progress
created: 2026-09-06
priority: high
urgency: now
area:
  - scripts/harness/gate.mjs
  - scripts/harness/run-all-scans.mjs
  - scripts/harness/file-size-baseline.json
depends_on: []
---

# INFRA-175: shrink gate.mjs and run-all-scans.mjs back under their frozen file-size baselines

## Objective

`scripts/harness/gate.mjs` (2606 lines) and `scripts/harness/run-all-scans.mjs` (1932 lines) both grew
past their frozen baselines (2560 and 1914). `file-size` scans the whole repository unconditionally and
is a member of the scan suite, so `develop` is red and every branch inherits it. Bring both back under
their frozen numbers by MOVING code out, never by raising a baseline — the ratchet's own text says
"split instead of extending".

## Plan

- [ ] U01 — move the GATE-APPROVAL class-evidence group out of `scripts/harness/gate.mjs` into its own
      module and re-export it, so every existing importer is unchanged.
- [ ] U02 — move the affected-scan selection group out of `scripts/harness/run-all-scans.mjs` into its
      own module and re-export it.
- [ ] U03 — tighten `scripts/harness/file-size-baseline.json` to the new numbers in the same change,
      so the gain is locked rather than left as headroom.

## Completion Criteria

- [ ] TC-01: `node scripts/harness/scan-file-size.mjs` exits 0 and its baseline diff LOWERS both
      numbers and raises none.
- [ ] TC-02: `node scripts/harness/scan-rule-statement-floor.mjs` exits 0 and its
      `::examined:: <n> rule identifiers` count is not lower than the count on `origin/develop`.
      Moving code that emits a bracketed identifier out of a string literal makes the floor stop
      seeing it and still pass, which is a green for the wrong reason.
- [ ] TC-03: `node scripts/harness/scan-measurement-provenance.mjs` exits 0 with its subject and
      reader counts unchanged.
- [ ] TC-04: `npx vitest run scripts/harness/__tests__/gate.test.mjs`,
      `run-all-scans-affected.test.mjs` and `scan-lane-declaration.test.mjs` — the direct consumers of
      the moved code — all pass with no consumer edited.
- [ ] TC-05: the full harness suite has no failure that is absent on `origin/develop`, established by
      running the identical suite in a detached worktree at `origin/develop` and set-comparing the
      failing test names.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                             | Notes                                |
| ----- | --------- | ----------------------------------------------------------- | ------------------------------------ |
| TC-01 | CI smoke  | `scan-file-size.mjs` exit code plus the baseline diff       | red today on both files              |
| TC-02 | CI smoke  | `scan-rule-statement-floor.mjs`, count compared to develop  | guards the silent-blinding failure   |
| TC-03 | CI smoke  | `scan-measurement-provenance.mjs`                           | a moved reader must stay reachable   |
| TC-04 | unit      | the three consumer suites                                   | re-exports keep consumers unedited   |
| TC-05 | unit      | full suite here vs. a detached worktree at `origin/develop` | separates inherited red from new red |

No new fixture test is added: this moves code without changing behaviour, and the criteria above are
the falsification — TC-02 in particular fails if the extraction blinds a scan.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This item relocates functions between two of the repository's own internal maintenance
scripts so a size scan over those scripts stops reporting growth. Nothing it touches is published,
installed, or reachable from any command a person outside this repository can run — there is no
screen, no CLI flag, no SDK entry point and no file a user of Robota ever sees. The only readers of
these two modules are the repository's own scans, so there is no surface on which a scenario could be
performed.
