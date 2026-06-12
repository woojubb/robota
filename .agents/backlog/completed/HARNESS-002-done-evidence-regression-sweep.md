---
title: 'HARNESS-002: Done-backlog evidence regression sweep'
status: done
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
CLI-046 claimed --denied-tools delivery (flag was never threaded). Additional case found
2026-06-11: REL-003 (critical) sat in completed/ with status done while the OpenAPITool stub it
was supposed to remove still existed — caught only by the new HARNESS-008 stub-marker scan. The done gate validates at
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

## Completion (2026-06-13)

- `scripts/harness/check-done-evidence.mjs` shipped: validates repo-file references in the
  EVIDENCE regions of `.agents/backlog/completed/*.md`; `<!-- evidence-superseded: <reason> -->`
  exemptions reported on every run, never silent.
- Registered as the 23rd scan in `run-all-scans.mjs` + `pnpm harness:scan:done-evidence`.
- Durable-artifact rule added to `.agents/rules/backlog-execution.md`.
- Initial live triage: 3 stale references found and annotated (CLIR-H02/CLIR-L01 —
  tui-mode.ts retired by the TUI→transport migration; DOC-002 — README.ko.md retired by
  docs-site i18n). `pnpm harness:scan` → all 23 scans passed.
- Unit fixtures: `scripts/harness/__tests__/check-done-evidence.test.mjs` (5/5).
- User Execution Test Scenarios: N/A per this backlog (harness/internal tooling).
