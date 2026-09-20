---
title: 'HARNESS-2756: Checkpoint evidence cannot carry a fence in the text it binds'
issue: https://github.com/woojubb/robota/issues/2756
status: in-progress
created: 2026-09-20
priority: high
urgency: now
area: scripts/harness
lane: L1
depends_on: []
---

# HARNESS-2756: Checkpoint evidence cannot carry a fence in the text it binds

## Objective

A checkpoint payload binds the authored scenario text VERBATIM, and a scenario may legally name a
code fence. SCREEN-2002's Scenario 1 prerequisites say the canned reply "contains a fenced ``ts code
block". The payload is written inside a three-backtick ` ``json `fence, so that inner fence closes
the outer one: the record cannot be written, and a record already widened by Prettier to four
backticks cannot be read back —`parseCheckpointEvidence` refuses it as "evidence must contain one
json fence".

The effect is not cosmetic. SCREEN-2002's three work units are merged, but its record could not be
reconciled in ANY commit shape, because every shape that touches the pair re-validates that block.
That is the SCREEN-2002 half of the develop red tracked by issue #2756.

## Plan

- [ ] TC-01: the delimiter is chosen, not assumed — `formatCheckpointEvidence` emits a run one
      backtick longer than the longest run its payload carries, never shorter than three, and
      `parseCheckpointEvidence` and the contract-region reader accept any run of three or more closed
      by a run at least as long (CommonMark's own rule).
- [ ] TC-02: engineering verification — the harness contract tier and `pnpm harness:scan`.

## Test Plan

| TC-ID | Test Type                | Tool / Approach                                                    | Notes                          |
| ----- | ------------------------ | ------------------------------------------------------------------ | ------------------------------ |
| TC-01 | Unit                     | Vitest over `formatCheckpointEvidence` / `parseCheckpointEvidence` | Round trip on a real record    |
| TC-02 | Engineering verification | `node scripts/harness/harness-test-tiers.mjs --tier contracts`     | No test file — skipped by kind |

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** this changes a harness record ENCODING only. Nothing a user types, sees or runs at a
product surface changes — `robota` behaves identically before and after, and the only observable is
whether a checkpoint record can be written and read back, which is a repository-internal contract
between the gate writer and the scan that reads it.
