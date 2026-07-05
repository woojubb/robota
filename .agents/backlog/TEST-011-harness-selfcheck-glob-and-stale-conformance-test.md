---
title: 'TEST-011: run ALL harness script tests (glob, not a hardcoded list) + fix the stale background-workspace-conformance test'
status: todo
created: 2026-07-02
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
- Evidence: _to fill at implementation._
