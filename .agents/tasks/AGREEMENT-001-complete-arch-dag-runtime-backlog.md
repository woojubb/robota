---
title: 'AGREEMENT-001: complete the active ARCH, DAG, and RUNTIME task set'
status: in-progress
created: 2026-08-12
priority: critical
urgency: now
area: cross-cutting ARCH, DAG, and RUNTIME initiative
depends_on: []
children:
  [
    ARCH-009,
    ARCH-010,
    ARCH-011,
    ARCH-012,
    ARCH-013,
    ARCH-019,
    ARCH-029,
    INFRA-098,
    INFRA-099,
    DAG-001,
    DAG-004,
    RUNTIME-002,
    RUNTIME-003,
    RUNTIME-004,
    RUNTIME-005,
    RUNTIME-006,
  ]
---

# AGREEMENT-001: ARCH, DAG, and RUNTIME completion initiative

## Objective

Execute the original twelve active ARCH, DAG, and RUNTIME Tasks plus the prerequisites discovered
while validating and delivering them, in dependency order and with the full
acceptance scope approved in the governing agreement. This record tracks initiative convergence;
the source Task files remain authoritative for their detailed implementation and scenario
evidence.

## Spec

`.agents/spec-docs/active/AGREEMENT-001-complete-arch-dag-runtime-backlog.md`

## Plan

- [ ] Preserve the approved dependency order while each source Task runs through its own gates.
- [ ] Audit the source Tasks' engineering and user-execution evidence against the agreement criteria.
- [ ] Pass architecture conformance and CI-equivalent verification over the assembled initiative.
- [ ] Close and archive this initiative only after every required child is `done`.

These Plan rows are initiative-level work, not a second child lifecycle ledger. The canonical child
projection is the section below.

## Children

- [ ] ARCH-009 — todo — `.agents/tasks/ARCH-009-preset-registry-through-command-host.md`
- [x] ARCH-010 — done — `.agents/tasks/completed/ARCH-010-execution-root-carried-by-no-contract.md`
- [x] ARCH-011 — done — `.agents/tasks/completed/ARCH-011-transport-adapter-is-a-lifecycle-stub.md`
- [x] ARCH-012 — done — `.agents/tasks/completed/ARCH-012-interactive-session-god-contract.md`
- [ ] ARCH-013 — in-progress — `.agents/tasks/ARCH-013-preset-to-session-options-projection-has-no-owner.md`
- [x] ARCH-019 — done — `.agents/tasks/completed/ARCH-019-interactive-session-getSession-contract-understated.md`
- [x] ARCH-029 — done — `.agents/tasks/completed/ARCH-029-command-host-capability-contracts.md`
- [x] INFRA-098 — done — `.agents/tasks/completed/INFRA-098-review-every-integration-base-child-pr.md`
- [x] INFRA-099 — done — `.agents/tasks/completed/INFRA-099-pr-base-aware-pre-push-verification.md`
- [x] DAG-001 — done — `.agents/tasks/completed/DAG-001-running-is-a-terminal-trap.md`
- [ ] DAG-004 — todo — `.agents/tasks/DAG-004-eight-cli-commands-open-code-the-import-adapter.md`
- [ ] RUNTIME-002 — todo — `.agents/tasks/RUNTIME-002-headless-only-bun-runtime-entry.md`
- [x] RUNTIME-003 — done — `.agents/tasks/completed/RUNTIME-003-no-turn-or-run-identity.md`
- [ ] RUNTIME-004 — in-progress — `.agents/tasks/RUNTIME-004-cancellation-declared-at-four-layers-honoured-at-none.md`
- [x] RUNTIME-005 — done — `.agents/tasks/completed/RUNTIME-005-a-turn-parked-on-approval-is-not-cancellable.md`
- [x] RUNTIME-006 — done — `.agents/tasks/completed/RUNTIME-006-turn-identity-is-optional-in-four-places.md`

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

### 2026-08-13

- ARCH-010 completed after the explicitly approved one-time process disposition: the unchanged public
  containment scenario passed again, independent Done Gate Stage 2 returned PASS, CI-equivalent and
  pre-push verification passed, and the source Task was atomically archived.

## Decisions

- Source Tasks retain detailed contract and evidence ownership; this file is a non-duplicating initiative index.
- Work is sequenced by shared-contract dependency, not by diff size.
- ARCH-019 precedes ARCH-012's final factory conformance. ARCH-029 owns the separately identified
  framework command-host root cause and follows ARCH-012 so the framework adapter is not designed twice.

## Blockers

- None.

## Result

Pending.
