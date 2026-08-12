---
title: 'AGREEMENT-001: complete the active ARCH, DAG, and RUNTIME task set'
status: in-progress
created: 2026-08-12
priority: critical
urgency: now
area: cross-cutting ARCH, DAG, and RUNTIME initiative
depends_on: []
---

# AGREEMENT-001: ARCH, DAG, and RUNTIME completion initiative

## Objective

Execute the twelve active ARCH, DAG, and RUNTIME Tasks in the dependency order and with the full
acceptance scope approved in the governing agreement. This record tracks initiative convergence;
the twelve source Task files remain authoritative for their detailed implementation and scenario
evidence.

## Spec

`.agents/spec-docs/active/AGREEMENT-001-complete-arch-dag-runtime-backlog.md`

## Plan

- [ ] TC-01: complete ARCH-009 instance preset-registry ownership and product isolation.
- [ ] TC-02: complete ARCH-010 trusted DAG execution-root propagation and containment.
- [ ] TC-03: complete ARCH-012 session/command capability decomposition, then ARCH-011 six-transport conformance.
- [ ] TC-04: complete ARCH-013 option reachability and projection across every product surface.
- [x] TC-05: complete DAG-001 recovery adapter matrix and durable executable scenario evidence.
- [ ] TC-06: complete DAG-004 canonical validation at every external definition import boundary.
- [ ] TC-07: complete RUNTIME-002 headless bootstrap, artifact, and agent-app packaging migration.
- [ ] TC-08: complete RUNTIME-003 single DAG advancement ownership while retaining turn identity proofs.
- [ ] TC-09: complete RUNTIME-004 end-to-end DAG cancellation while retaining compaction proofs.
- [ ] TC-10: complete RUNTIME-005 approval cancellation and single interactive execution-state ownership.
- [ ] TC-11: complete RUNTIME-006 required, unforgeable turn settlement identity.
- [ ] TC-12: run and record each source Task's engineering and user-execution evidence, then archive it atomically.
- [ ] TC-13: pass architecture conformance and CI-equivalent initiative verification.

## Test Plan

- Run each source Task's targeted red-green tests and package build immediately after its source changes.
- Run each source Task's user-execution scenario through its declared product surface and record durable evidence.
- Run scoped harness verification for each completed slice.
- Run `pnpm harness:conformance` and `pnpm harness:verify-like-ci` over the assembled initiative.
- Verify all twelve source Task records and this initiative record satisfy the done and archival scans.

## Progress

### 2026-08-12

- AGREEMENT-001 passed GATE-WRITE and independent proposal review after one revision round.
- User explicitly approved implementation and resumed commit/push authority; GATE-APPROVAL passed.
- DAG-001 completed: SQLite/worker recovery matrix, durable two-process scenario, both Done Gate stages,
  `harness:verify-like-ci`, and zero-finding local review all passed.

## Decisions

- Source Tasks retain detailed contract and evidence ownership; this file is a non-duplicating initiative index.
- Work is sequenced by shared-contract dependency, not by diff size.

## Blockers

- None.

## Result

Pending.
