---
title: 'HARNESS-002: Done-backlog evidence regression sweep'
status: todo
created: 2026-06-11
priority: high
urgency: soon
area: .agents/backlog, scripts/harness
depends_on: []
---

# HARNESS-002: Done-backlog evidence regression sweep

## Problem

Done-backlog evidence became false over time with no alarm: CLI-033 claimed 10 headless E2E
tests (files no longer exist), CLI-042 claimed grep parallelization (code is sequential again),
CLI-046 claimed --denied-tools delivery (flag was never threaded). The done gate validates at
completion time only; nothing re-validates later.

## Proposed Check

1. Rule: done evidence MUST reference durable artifacts (test file paths) for code-changing
   backlogs.
2. `harness:scan:done-evidence` — extract test-file paths referenced in
   `.agents/backlog/completed/*.md` evidence sections and fail when a referenced file no longer
   exists.

## Test Plan

- Scanner unit test with fixture completed-backlog files (existing path passes, missing path
  fails, prose without paths skipped).
- Initial live run triage: stale references either restored or annotated with replacement
  evidence.

## User Execution Test Scenarios

Not applicable — harness/internal tooling.
