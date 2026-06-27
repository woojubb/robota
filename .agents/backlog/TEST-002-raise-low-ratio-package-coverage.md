---
title: 'TEST-002: Raise low test:src-ratio packages to a baseline'
status: todo
created: 2026-06-27
priority: low
urgency: later
area: packages
depends_on: []
---

# Raise low-ratio packages to a coverage baseline

Split from TEST-001 (which closed the worst case — the **zero-test** `agent-interface-tui`,
now a type-contract test). These packages already have a test harness and some tests (not
blind spots), but a thin ratio:

- `packages/agent-interface-transport` — ~1 test / 11 src files
- `packages/agent-subagent-runner` — ~1 / 8
- `packages/agent-tool-mcp` — ~1 / 6
- `packages/agent-preset` — ~2 / 11

## What

For each, add at least a happy-path + one error-path test per public export (or, where a module
is a thin façade, a contract test asserting the surface). Prioritize the packages exercising
real runtime logic (`agent-subagent-runner`, `agent-tool-mcp`) over pure-type packages.

## Why

These are continuous-improvement coverage gaps, not silent blind spots — but raising them
reduces regression risk on the runtime paths. Deferred from TEST-001 because it is an
open-ended, multi-package effort distinct from closing the zero-test case.

## Done When

- Each listed package has happy-path + error-path coverage for its public runtime exports (or a
  documented contract-test rationale for façade/type modules).
- `pnpm test` passes; new tests run in CI.

## Test Plan

- Per package: `pnpm --filter @robota-sdk/<pkg> test` green with the new tests; confirm they
  exercise real exports.

## User Execution Test Scenarios

Not applicable — internal test-coverage hardening; no user-facing behavior change.
