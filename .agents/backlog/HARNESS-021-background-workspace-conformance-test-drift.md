---
title: 'HARNESS-021: check-background-workspace-conformance unit tests drifted — 5/5 failing on develop'
status: todo
created: 2026-07-03
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
---

# background-workspace-conformance test drift

Found during DOCS-017 (2026-07-03): `pnpm exec vitest run
scripts/harness/__tests__/check-background-workspace-conformance.test.mjs` fails 5/5 **on a clean
develop tree** (verified via `git stash` → rerun → same failures). Every assertion receives MORE
findings than expected — the scan appears to emit extra finding entries against the test fixtures
(likely scanner logic or fixture drift after a HARNESS-011-era refactor), so either the scan is
over-reporting in production too, or the tests no longer describe its intended contract.

Not caught earlier because the root `pnpm test` runs per-package suites only; the
`scripts/harness/__tests__/` suite runs via `verify-change.mjs` selection, which only includes
files listed for the touched scan — a full-suite run of this directory is not on any green path.

## What

1. Diagnose: run the failing tests, diff actual vs expected findings, decide which side drifted
   (scan over-reporting = fix scan; contract change = fix tests).
2. Fix the drifted side; all 5 green.
3. Consider adding the harness test directory to a blocking path (CI or pre-push) so suite-wide
   drift cannot sit silent again — mechanism over prose.

## Test Plan

- `pnpm exec vitest run scripts/harness/__tests__/` fully green; harness scan output unchanged for
  a clean tree (or intentionally corrected, documented in the scan header).

## User Execution Test Scenarios

- Not applicable beyond the mechanical suite run (dev-tooling fix); evidence = green run recorded
  at implementation.
- Evidence: _to fill at implementation._
