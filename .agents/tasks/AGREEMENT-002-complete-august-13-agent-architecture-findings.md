---
title: 'AGREEMENT-002: complete the 2026-08-13 agent architecture findings'
status: todo
created: 2026-08-15
priority: critical
urgency: now
area: cross-cutting agent architecture initiative
depends_on: []
children:
  [
    ARCH-014,
    ARCH-015,
    ARCH-016,
    ARCH-017,
    ARCH-018,
    ARCH-020,
    ARCH-021,
    ARCH-022,
    ARCH-023,
    ARCH-024,
    ARCH-025,
    ARCH-026,
    ARCH-027,
    ARCH-028,
  ]
---

# AGREEMENT-002: August 13 agent architecture initiative

## Objective

Track the fourteen open agent-architecture findings created on 2026-08-13 as one dependency-ordered
initiative. The source Task files remain authoritative for each problem and its implementation
evidence; the paired agreement owns the proposed integration order and assembled completion gate.

This record does not grant implementation approval. The paired spec remains `review-ready`, and work
must not begin until GATE-APPROVAL records the user's explicit approval.

## Spec

`.agents/spec-docs/backlog/AGREEMENT-002-complete-august-13-agent-architecture-findings.md`

## Plan

- [ ] Obtain explicit user approval for the paired agreement before implementation.
- [ ] Apply the agreement's foundational scope corrections before running the affected child gates.
- [ ] Execute every child through its own implementation and verification lifecycle in dependency order.
- [ ] Run the initiative-level architecture conformance and CI-equivalent assembled-base gates.

These Plan rows are initiative-level work, not a second child lifecycle ledger. The canonical child
projection is the section below.

## Children

- [ ] ARCH-014 — todo — `.agents/tasks/ARCH-014-session-log-external-payloads-have-no-dereferencer.md`
- [ ] ARCH-015 — todo — `.agents/tasks/ARCH-015-two-writers-one-record-contract-session-save-destroys-fields.md`
- [ ] ARCH-016 — todo — `.agents/tasks/ARCH-016-session-log-event-vocabulary-and-compaction-trigger-split-brain.md`
- [ ] ARCH-017 — todo — `.agents/tasks/ARCH-017-injected-permission-ask-handlers-are-dead-surface.md`
- [ ] ARCH-018 — todo — `.agents/tasks/ARCH-018-interaction-channel-charter-is-unsatisfiable-as-written.md`
- [ ] ARCH-020 — todo — `.agents/tasks/ARCH-020-branch-event-is-declared-and-emitted-by-nothing.md`
- [ ] ARCH-021 — todo — `.agents/tasks/ARCH-021-child-process-subagent-worker-bypasses-product-composition.md`
- [ ] ARCH-022 — todo — `.agents/tasks/ARCH-022-framework-pass-through-re-export-evades-public-surface-guard.md`
- [ ] ARCH-023 — todo — `.agents/tasks/ARCH-023-createAgentRuntime-default-sessionstore-never-forwarded.md`
- [ ] ARCH-024 — todo — `.agents/tasks/ARCH-024-framework-hardcodes-module-owned-command-ids.md`
- [ ] ARCH-025 — todo — `.agents/tasks/ARCH-025-executor-projections-silently-drop-contract-fields.md`
- [ ] ARCH-026 — todo — `.agents/tasks/ARCH-026-scheduled-task-runner-bypasses-shell-resolution-ssot.md`
- [ ] ARCH-027 — todo — `.agents/tasks/ARCH-027-dead-composition-contract-fields.md`
- [ ] ARCH-028 — todo — `.agents/tasks/ARCH-028-plan-and-context-refresh-events-emitted-into-a-contract-no-transport-consumes.md`

## Test Plan

- Run every child Task's targeted red-green tests and affected package build.
- Run each applicable child user-execution scenario and retain its durable evidence.
- Run architecture conformance, scoped harness verification, and CI-equivalent verification over the
  assembled initiative.
- Verify the Task/spec child projections and lifecycle state with the task-archival scan.

## User Execution Test Scenarios

Not applicable to this tracking-only record. Each runnable behavior change is verified through the
user-execution scenario owned by its source child Task.

## Progress

### 2026-08-15

- The paired agreement passed GATE-WRITE and independent proposal review.
- Finding-depth review classified all fourteen proposed child scopes as LOCAL after incorporating four
  foundational scope corrections.
- Explicit implementation approval remains pending.

## Decisions

- Preserve the paired spec at `review-ready` until the user explicitly approves implementation.
- Keep child behavior, test, and evidence ownership in the source Task records.

## Blockers

- GATE-APPROVAL requires explicit user approval before implementation begins.

## Result

Pending.
