---
title: 'AGREEMENT-002: complete the 2026-08-13 agent architecture findings'
status: in-progress
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

The paired spec passed GATE-APPROVAL on 2026-08-15. The user's instruction
“ARCH-014~028 을 모두 진행해줘.” authorizes implementation of the complete child set.

## Spec

`.agents/spec-docs/active/AGREEMENT-002-complete-august-13-agent-architecture-findings.md`

## Plan

- [ ] TC-01 — preserve full-fidelity external session payloads in ARCH-014.
- [ ] TC-02 — preserve unknown session-record fields and reconcile the canonical store port in ARCH-015.
- [ ] TC-03 — unify the session-log vocabulary and compact trigger in ARCH-016.
- [ ] TC-04 — remove obsolete permission/ask seams and retain the prompt-registry SSOT in ARCH-017.
- [ ] TC-05 — make the interaction-channel charter and implementer set agree in ARCH-018.
- [ ] TC-06 — implement the complete committed checkpoint/branch transition matrix in ARCH-020.
- [ ] TC-07 — deliver the shared event contract through exhaustive TUI/protocol mappings in ARCH-028.
- [ ] TC-08 — preserve live product composition through a parent-side worker broker in ARCH-021.
- [ ] TC-09 — forward runtime-owned default session persistence in ARCH-023.
- [ ] TC-10 — inject semantic command roles from composition in ARCH-024.
- [ ] TC-11 — remove the dead provider override and add whole-pack duplicate diagnostics in ARCH-027.
- [ ] TC-12 — remove framework public-surface laundering and recursively enforce the boundary in ARCH-022.
- [ ] TC-13 — make executor projections total and mechanically exhaustive in ARCH-025.
- [ ] TC-14 — share one shell executable/argument-family resolver in ARCH-026.
- [ ] TC-15 — run every child done gate and archive all fourteen Task records atomically.
- [ ] TC-16 — pass assembled conformance, scoped verification, and the CI-equivalent gate.

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
- GATE-APPROVAL passed with the user's explicit instruction to proceed with all fourteen children.
- GATE-IMPLEMENT passed; the paired spec is active and the initiative Task tracks TC-01 through TC-16.
- Foundational scopes for ARCH-020/021/025/028 and current-SSOT decisions for ARCH-017/027 were
  recorded before any child recommendation gate.

## Decisions

- Advance the paired spec to `approved` and execute on a dedicated integration base.
- Keep child behavior, test, and evidence ownership in the source Task records.

## Blockers

- None.

## Result

Pending.
