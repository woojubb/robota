---
title: 'HARNESS-003: SPEC file-path existence scan'
status: done
created: 2026-06-11
completed: 2026-06-11
priority: high
urgency: soon
area: scripts/harness
depends_on: []
---

# HARNESS-003: SPEC file-path existence scan

## Problem

agent-cli SPEC.md referenced seven deleted files (preflight.ts, diagnose-command.ts,
args-to-options.ts, config-phase.ts, provider-setup.ts, session-setup.ts, update-notice.ts) in
its module tree and contract tables for weeks. `harness:scan:specs` validates section structure
but not whether referenced source paths exist.

## Proposed Check

Extend the specs scan: extract `src/**/*.ts(x)` path tokens from each `packages/*/docs/SPEC.md`
and fail when the file does not exist in that package. Allowlist syntax for intentionally
illustrative paths (e.g. `(planned)` suffix).

## Test Plan

- Scanner unit test: existing path passes, deleted path fails, `(planned)`-annotated path
  skipped.
- Live dry run; fix or annotate current findings before enforcement.

## User Execution Test Scenarios

Not applicable — harness/internal tooling.

## Evidence

- (2026-06-11) `check-spec-paths.mjs` implemented + 5 unit tests; live triage fixed 23 real ghost paths across 3 SPECs; scan green and registered in harness:scan.
