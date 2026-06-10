---
title: 'HARNESS-001: Orphan-export scan — detect features killed by refactors'
status: todo
created: 2026-06-11
priority: critical
urgency: now
area: scripts/harness, .agents/rules
depends_on: []
---

# HARNESS-001: Orphan-export scan — detect features killed by refactors

## Problem

Four shipped features (PM-023 first-run welcome, PM-024 diagnose, UX-002 terminal warning,
PM-033 init dispatch) were orphaned or deleted by the ARCH-002 refactor (`a12a3348d`) and stayed
dead for weeks. Build, typecheck, lint, and tests all passed — nothing detects an exported
symbol whose call sites have all been removed. This was the root cause of the entire CLI-049~052
regression cluster (2026-06-10 audit).

## Proposed Check

`harness:scan:orphan-exports` — for each `packages/*/src` non-test export, verify at least one
reference exists outside its own file (repo-wide). Allowlist: package entry points (`index.ts`
public surface), bin entries, type-only contract packages (`agent-interface-*`). Findings fail
the scan with file:symbol detail.

## Test Plan

- Unit test for the scanner against a fixture tree (orphaned export detected; entry-point
  export exempted; re-exported symbol followed).
- Dry run over the live repo: triage initial findings into fixes or allowlist entries before
  enabling in `harness:scan`.

## User Execution Test Scenarios

Not applicable — harness/internal tooling; verification is the Test Plan scanner runs.
