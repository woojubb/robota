---
title: 'BEHAVIOR-007: atomic persistence drain handoff'
status: done
created: 2026-08-12
completed: 2026-08-12
priority: critical
urgency: now
area: packages/dag-adapters-local
depends_on: []
---

# BEHAVIOR-007: atomic persistence drain handoff

Spec: `.agents/spec-docs/done/BEHAVIOR-007-persistence-drain-handoff.md`

## Objective

Prevent a same-path persistence request at the drain completion boundary from receiving a successful
promise while its latest state remains unwritten.

## Plan

- [x] TC-01 — Add a deterministic red test for the empty-observation/owner-release interleaving,
      then make the successor promise wait for durable publication.
- [x] TC-02 — Preserve same-path coalescing/serialization and independent different-path writes.
- [x] TC-03 — Preserve final-attempt rejection and earlier-failure supersession semantics.
- [x] TC-04 — Run package tests, build, affected verification, and release conformance re-audit.

## Test Plan

- Run the focused Vitest file after each RED/GREEN step.
- Run `pnpm --filter @robota-sdk/dag-adapters-local test`.
- Run `pnpm --filter @robota-sdk/dag-adapters-local build`.
- Run `pnpm harness:conformance` and the required branch verification before merge.

## User Execution Test Scenarios

Not applicable: this is an internal file-persistence scheduling correction with no CLI, UI, or
public SDK interaction surface. The deterministic async interleaving and restart-visible file state
are covered by package tests.

## Progress

### 2026-08-12

- Pre-release architecture audit reproduced the completion-boundary durability race and classified
  it as the sole unresolved P0.
- GATE-WRITE and GATE-APPROVAL passed for the atomic owner-handoff design.
- RED used a behavior-preserving seam over the pre-fix delayed-cleanup algorithm and failed TC-01
  because the initial promise had already settled at the release boundary (expected false, actual
  true); GREEN passed the focused 12-test file and the package's 79-test suite.
- Package lint had zero errors, and package typecheck/build passed.
- Mechanical conformance passed and two independent architecture re-audits found unresolved P0=0.

## Decisions

- Preserve dependency-free latest-state coalescing; correct only ownership handoff and identity.

## Blockers

- None.

## Result

The per-path coalescer now registers an explicit owner before draining and releases it only through a
synchronous empty-check handoff. Boundary re-entry is drained by the live owner; post-release calls
install a successor. Tests preserve path independence and final-attempt error semantics.
