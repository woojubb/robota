---
title: 'HARNESS-006: CLI flag wiring check — parsed args must have consumers'
status: done
created: 2026-06-11
completed: 2026-06-11
priority: high
urgency: soon
area: packages/agent-cli, scripts/harness
depends_on: []
---

# HARNESS-006: CLI flag wiring check — parsed args must have consumers

## Problem

`--denied-tools` and `--dry-run` were parsed into `IParsedCliArgs`, advertised in help and SPEC,
and never read anywhere — including a safety flag whose silent no-op meant full execution with
file mutations (CLI-053/054, fixed 2026-06-11).

## Proposed Check

`harness:scan:cli-flag-wiring` — for each `IParsedCliArgs` field, require at least one read
outside `cli-args.ts` (grep-level), with an explicit allowlist for fields consumed only at
parse time (e.g. normalized aliases like dryRun). Alternative/complement: a unit-test convention
asserting each help-listed flag maps to a wired field.

## Test Plan

- Scanner unit test with fixture parser/consumer files.
- Live run is expected green after CLI-053/054; add a deliberately-dead fixture field test.

## User Execution Test Scenarios

Not applicable — harness/internal tooling.

## Evidence

- (2026-06-11, approved form: CI-enforced unit test, not a repo scan) `cli-flag-wiring.test.ts` enumerates IParsedCliArgs from source and asserts consumers with a reasoned allowlist; first run caught disableUpdateCheck (cross-package pass-through, allowlisted with reason). agent-cli 107/107.
