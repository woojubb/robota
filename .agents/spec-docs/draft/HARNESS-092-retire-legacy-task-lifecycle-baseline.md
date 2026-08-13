---
status: draft
type: RULE
tags: [harness, tasks, migration]
---

# HARNESS-092: Retire the legacy Task lifecycle baseline

## Problem

Hundreds of Task records archived before the canonical lifecycle contract either omit a
`completed: YYYY-MM-DD` date or use a retired terminal status. HARNESS-091 can fail new violations
closed, but it cannot invent historically accurate completion dates. The exact legacy set is frozen
by count and digest; without a deliberate migration it remains visible debt rather than silently
becoming accepted schema.

## Prior Art Research

Waived: this draft records repository-specific historical metadata debt discovered during HARNESS-091;
the migration approach and any relevant prior art must be researched before GATE-WRITE.

## Architecture Review

Pending.

## Fallback & Degradation Declaration

None. The migration must use repository history or explicit evidence; guessed dates are forbidden.

## Solution

Pending owner-reviewed migration design.

## Affected Files

- `.agents/tasks/completed/*.md`
- `scripts/harness/task-lifecycle-legacy-baseline.json`
- Task lifecycle scans and tests

## Completion Criteria

- [ ] TC-01: every archived Task uses the canonical terminal vocabulary and carries an evidence-backed
      `completed: YYYY-MM-DD` date.
- [ ] TC-02: the legacy lifecycle baseline is removed and all lifecycle scans pass without exemptions.

## Test Plan

| TC-ID | Test Type       | Tool / Approach                           | Notes                               |
| ----- | --------------- | ----------------------------------------- | ----------------------------------- |
| TC-01 | Migration audit | history-derived date/status verifier      | Reject guessed or missing evidence. |
| TC-02 | Harness         | lifecycle, placement, and aggregate scans | Require zero-baseline operation.    |

## User Execution Test Scenarios

**Applicability:** not-applicable. This is repository-internal governance data migration.

## Tasks

Pending GATE-IMPLEMENT.

## Evidence Log
