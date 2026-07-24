---
title: 'TEST-011: run ALL harness script tests (glob, not a hardcoded list) + fix the stale background-workspace-conformance test'
status: done
created: 2026-07-02
completed: 2026-07-24
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
---

# Harness self-check runs a hardcoded test list — drift already happened

Found while institutionalizing the 2026-07-02 lessons: `scripts/harness/verify-change.mjs` runs a
**hardcoded list** of `scripts/harness/__tests__/*.test.mjs` files (5 of 24+). Running the whole
directory revealed `check-background-workspace-conformance.test.mjs` has been failing (5/5 cases)
without anyone noticing — its expectations drifted from the scan's current findings. This is the same
defect class as the hardcoded module mocks (MOCK-001): an enumerated snapshot of a growing set,
enforced nowhere.

## What

1. **Fix the stale test**: reconcile `check-background-workspace-conformance.test.mjs` with the
   current `check-background-workspace-conformance.mjs` behavior — determine whether the SCAN drifted
   (fix scan) or the TEST fixtures went stale (fix test). Do not weaken the scan to make the test pass.
2. **Glob, don't enumerate**: change the harness-script test invocation (verify-change.mjs — and any
   sibling runner) to run `scripts/harness/__tests__/` as a directory so every scan test always runs.
3. **Gate**: ensure the globbed run is green and wired into the pre-push/CI path that runs
   verify-change, so a stale scan test can never sit silent again.

## Test Plan

- `npx vitest run scripts/harness/__tests__/` → all files pass (currently 1 file / 5 cases fail).
- `pnpm harness:scan` + `pnpm harness:self-check` green after the change.

## User Execution Test Scenarios

- Not applicable (harness infrastructure). Evidence: the globbed vitest run output (all green)
  recorded here.
- Evidence: `npx vitest run scripts/harness/__tests__` → **51 files / 473 tests, all pass**
  (2026-07-24, includes `check-background-workspace-conformance.test.mjs`);
  `node scripts/harness/run-all-scans.mjs` → all 59 scans pass; `pnpm harness:self-check` →
  `harness self-check passed.` (all four self-check probes ok).

## Outcome (2026-07-24)

Items 1–3 as originally written had already landed while this item sat in the backlog:

1. **Stale conformance test** — fixed in HARNESS-021 (`a015c5286`,
   "repair conformance test fixture drift + run harness suite in CI"); green today.
2. **Glob, not enumerate** — `verify-change.mjs` `harness-tests` check runs
   `vitest run scripts/harness/__tests__` (whole directory, INFRA-026), and root
   `package.json` exposes `harness:test` with the same directory glob.
3. **Gate** — CI (`.github/workflows/ci.yml`, "Harness scan test suite" step) runs
   `pnpm harness:test` on every non-main-targeted PR (HARNESS-021), and pre-push runs
   `harness:verify` which includes the globbed harness-tests check.

What this item still delivered — the defect class was "an enumerated/stale snapshot,
**enforced nowhere**", and two enforcement gaps remained:

- **The glob + gate were unguarded.** Added
  `scripts/harness/__tests__/self-check-glob-gate.test.mjs`: mechanical assertions that
  verify-change passes the directory (not enumerated `.test.mjs` files) to vitest, that
  `harness:test` stays a directory glob, that the CI gate step still runs
  `pnpm harness:test` on the develop path, and that the conformance test file stays inside
  the globbed directory. Red-proved by sabotage-revert: re-introducing each defect
  (enumerated list, single-file script, disabled CI step, deleted conformance test,
  removed pre-push verify) fails 6/6 assertions.
- **The same staleness recurred inside `self-check.mjs` itself.** HARNESS-DIET-006 removed
  the hook's any-type branch but left the self-check's `const value: any` fixture behind,
  so `pnpm harness:self-check` was failing on develop
  (`check-forbidden-patterns fixture did not block forbidden content`). Fixed the fixture
  to the pattern the hook now enforces (try/catch fallback, common-mistakes #9), exported
  it as `FORBIDDEN_PATTERN_FIXTURE_CONTENT`, and added
  `scripts/harness/__tests__/self-check.test.mjs` which runs the REAL hook against the
  REAL fixture constant inside the globbed suite — hook/fixture drift now fails CI
  instead of sitting silent. Red-proved: 2/2 tests failed against the stale any-type
  fixture before the fix.
