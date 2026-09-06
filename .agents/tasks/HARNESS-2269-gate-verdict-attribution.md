---
title: 'HARNESS-2269: require gate verdict attribution'
issue: https://github.com/woojubb/robota/issues/2269
status: todo
created: 2026-09-06
priority: high
urgency: soon
area: scripts/harness
depends_on: []
---

# HARNESS-2269: require gate verdict attribution

## Objective

Make every newly recorded gate evidence entry identify its judging mechanism, while measuring the
pre-existing attribution debt without rewriting historical evidence.

## Plan

- [ ] TC-01: emit a canonical `Judged by` line from gate recorders.
- [ ] TC-02: scan the complete evidence population, count attribution, and fail on un-attributed entries after the migration baseline.
- [ ] TC-03: add falsification fixtures and register the scan in the harness suite.

## Test Plan

- `pnpm exec vitest run scripts/harness/__tests__/scan-gate-verdict-attribution.test.mjs`
- `node scripts/harness/scan-gate-verdict-attribution.mjs`
- `pnpm harness:scan -- --context pr --skip dist --skip build-contracts`

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is repository governance instrumentation with no product-facing runtime surface.
