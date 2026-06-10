---
title: 'HARNESS-015: Orphan-export baseline burn-down — triage 153 frozen findings'
status: todo
created: 2026-06-11
priority: medium
urgency: later
area: packages/*, scripts/harness
depends_on: []
---

# HARNESS-015: Orphan-export baseline burn-down

## Problem

The HARNESS-001 orphan-export scan launched with a ratchet baseline
(`scripts/harness/orphan-export-baseline.json`, 153 entries, 2026-06-11): pre-existing orphaned
runtime exports across agent-core, agent-framework, agent-command, agent-playground and others
are frozen so only NEW orphans fail. Each frozen entry is either dead code (delete) or a
legitimately external-facing symbol (move to the reasoned allowlist / re-export through the
package surface).

## Proposed Work

Per package (separate small PRs recommended): for each baseline entry, decide delete vs
allowlist-with-reason vs wire-to-surface; delete entries from the baseline as they are resolved;
the scan enforces that the baseline only shrinks (manual discipline — entries must never be
added back without a new incident record). Done when the baseline file is empty and removed.

## Test Plan

- Each deletion PR: owning package build/typecheck/tests green.
- `pnpm harness:scan:orphan-exports` green after every batch.

## User Execution Test Scenarios

Not applicable — internal dead-code cleanup; verification is package test suites + the scan.
