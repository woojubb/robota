---
title: 'PROC-022: Keep continuation raw PASS binding stable under Prettier'
issue: https://github.com/woojubb/robota/issues/2547
status: done
created: 2026-08-30
completed: 2026-08-30
priority: critical
urgency: now
area: workflow harness
depends_on: [PROC-021]
---

# PROC-022: Keep continuation raw PASS binding stable under Prettier

## Objective

Make continuation raw PASS identity stable under the repository's mandatory Markdown formatter
without weakening exact-byte checks inside each PASS entry.

## Plan

- [x] TC-01: Add an EOF-versus-formatted-separator contract fixture and define the raw entry boundary.
- [x] TC-02: Preserve internal trailing-space, replacement, deletion, and reorder refusals.
- [x] TC-03: Add a temporary Git history proving a formatted continuation passes while existing
      ancestry controls remain green.
- [x] TC-04: Run focused tests, affected scans, and full harness contract verification.

## Test Plan

- Exercise `rawGateImplementPassEntries` and `priorPassDigest` directly for EOF and formatted
  continuation boundaries.
- Exercise `findHistoryFindings` in a temporary Git repository after adding the formatter-style
  separator.
- Run focused Vitest, affected scans, and the full harness contract tier.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable because this changes repository-internal Markdown parsing and Git-order enforcement
and has no user-runnable product surface.

## Result

- Raw PASS boundaries now exclude only contiguous raw blank separator lines immediately before the
  next visible heading; EOF terminal newlines and all internal bytes remain bound.
- The Prettier separator regression passes in both direct contract and temporary Git history tests.
- Verification passed: owner suites 153/153, affected scans 60 passed/1 skipped, and contract tier
  195 files/4,299 tests.
