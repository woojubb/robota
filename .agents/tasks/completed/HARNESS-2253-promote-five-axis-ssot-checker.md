---
title: 'HARNESS-2253: promote the five-axis SSOT checker to a harness scan'
issue: https://github.com/woojubb/robota/issues/2253
status: done
created: 2026-09-06
completed: 2026-09-06
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
---

# HARNESS-2253: promote the five-axis SSOT checker to a harness scan

## Objective

Promote the five derived SSOT consistency axes from branch-local work into a discoverable,
fail-closed harness scan with independently falsifiable tests.

## Plan

- [x] TC-01: add the five-axis checker and scan declaration.
- [x] TC-02: add fixture tests for each refusal path and a clean control.
- [x] TC-03: run the full harness scan and archive the paired records.

## Test Plan

- `pnpm exec vitest run scripts/harness/__tests__/scan-ssot-five-axis.test.mjs`
- `node scripts/harness/scan-ssot-five-axis.mjs`
- `pnpm harness:scan -- --context pr`

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This repository governance scan has no product command, API, prompt, user-facing output, or runtime behavior to execute after delivery.

Not applicable: this is repository governance and has no product-facing runtime surface.

## Result

The discovered five-axis scan and its falsification fixtures are complete; the full local harness
scan has no blocking findings outside the Work-Run closure receipt that follows this terminalization.
