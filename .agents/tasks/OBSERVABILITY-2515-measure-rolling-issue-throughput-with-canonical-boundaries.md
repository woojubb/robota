---
title: 'OBSERVABILITY-2515: measure rolling issue throughput with canonical boundaries'
issue: https://github.com/woojubb/robota/issues/2515
status: in-progress
created: 2026-09-09
priority: critical
urgency: now
area: GitHub issue throughput measurement
depends_on: [AGREEMENT-2515]
---

# OBSERVABILITY-2515: measure rolling issue throughput with canonical boundaries

## Problem

`origin/develop` has no checked-in, repeatable command that reports GitHub issue creation, closure, and
net growth over an exact rolling window. Ad-hoc queries can disagree about timezone, endpoint boundary,
pagination, issue qualification, and API failure behavior, so the GitHub issue #2515 throughput target cannot be
verified or compared before and after a change.

## Plan

Implement the canonical read-only measurement surface after its child spec and approval gates pass. The
measurement must expose repository, exact UTC start/end, timezone/display semantics, query semantics,
created/open/closed/net counts, pagination completeness, and visible failure status. It must be rerunnable
without `/tmp` or session history and must not mutate GitHub state.

## Completion Criteria

- [ ] TC-01 — A canonical command reports repository, open/created/closed/net counts, exact `[start,end)`
      UTC window, and display/query semantics.
- [ ] TC-02 — Tests cover boundary timestamps, pagination/count correctness, timezone presentation, and
      API/query failures; a failure is visible and non-success.
- [ ] TC-03 — The command is rerunnable from a clean checkout without session or `/tmp` state and uses
      no issue suppression, relabeling, or deduplication mutation.

## Test Plan

| TC-ID | Test Type           | Tool / Approach                                                              | Notes                                 |
| ----- | ------------------- | ---------------------------------------------------------------------------- | ------------------------------------- |
| TC-01 | integration         | deterministic GitHub API fixture + CLI stdout assertions                     | Verify exact envelope and all fields. |
| TC-02 | unit/integration    | Vitest fixture matrix with pagination, boundary, timezone, and failure cases | Fail closed and preserve diagnostics. |
| TC-03 | process integration | Run from a clean temporary checkout with no session files                    | Read-only and rerunnable.             |

## User Execution Test Scenarios

Prerequisites: a clean checkout, the repository's configured GitHub authentication, and a deterministic
fixture or safe read-only repository query supplied by the child spec. From the repository root run the
canonical throughput command twice with the same explicit window. Verify both runs print the same
repository, UTC interval, query semantics, counts, and exit status; then run the failure fixture and
verify a non-zero exit plus an actionable diagnostic. Cleanup removes only the temporary fixture.

Expected: the command is repeatable, boundary-precise, pagination-complete, timezone-explicit, and
failure-visible. Evidence: record exact commands, relevant output, and exit codes before completion.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This Task adds a repository-internal GitHub queue measurement command and its harness call path; it changes no behavior reachable by a user through the Robota CLI, TUI, browser UI, or public SDK. The command and fixtures are operator maintenance surfaces for inspecting repository state, so no separate user product execution scenario applies.

## Tasks

- [x] Write the child spec and pass GATE-WRITE/GATE-APPROVAL before implementation.
- [x] Implement with TDD RED → GREEN → REFACTOR.
- [ ] Record TC evidence and pass GATE-IMPLEMENT/GATE-VERIFY/GATE-COMPLETE.

## Evidence Log
