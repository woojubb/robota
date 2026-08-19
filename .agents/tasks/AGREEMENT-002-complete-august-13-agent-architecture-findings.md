---
title: 'AGREEMENT-002: complete the 2026-08-13 agent architecture findings'
status: in-progress
created: 2026-08-15
priority: critical
urgency: now
area: cross-cutting agent architecture initiative
depends_on: [ARCH-031]
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

- [x] TC-01 — preserve full-fidelity external session payloads in ARCH-014.
- [x] TC-02 — preserve unknown session-record fields and reconcile the canonical store port in ARCH-015.
- [x] TC-03 — unify the session-log vocabulary and compact trigger in ARCH-016.
- [x] TC-04 — remove obsolete permission/ask seams and retain the prompt-registry SSOT in ARCH-017.
- [x] TC-05 — make the interaction-channel charter and implementer set agree in ARCH-018.
- [x] TC-06 — implement the complete committed checkpoint/branch transition matrix in ARCH-020.
- [x] TC-07 — deliver the shared event contract through exhaustive TUI/protocol mappings in ARCH-028.
- [x] TC-08 — preserve the product's composition across the subagent process boundary. **Closed by ARCH-021** (`done` 2026-08-16), which delivered a RECIPE rather than the parent-side worker broker this criterion imagined. The broker was rejected on evidence, not size: proxied tools execute in the PARENT, bound to the parent's checkout, while a worktree-isolated child's execution root is a different directory — so it would re-break the ARCH-010 containment it was meant to honour — and a prior-art sweep found **no specification defining a per-call working root for a proxied tool invocation** (MCP roots are session-scoped and pull-based). The composition root now supplies `ISubagentWorkerComposition` and the child builds an equivalent surface at its own root; nothing live crosses the boundary. Projecting genuinely owner-bound capability is ARCH-033 (#1784).
- [x] TC-09 — forward runtime-owned default session persistence in ARCH-023.
- [x] TC-10 — derive owner-declared semantic command roles from composition, including alternate IDs, duplicate rejection, and explicit absence semantics in ARCH-024.
- [x] TC-11 — make product/pack field projection exhaustive, remove the dead provider override, surface accepted pack metadata, and add whole-pack duplicate diagnostics in ARCH-027.
- [x] TC-12 — remove framework laundering from every package-declared public source root and recursively enforce the reachable graph in ARCH-022.
- [x] TC-13 — make executor projections total and mechanically exhaustive. **Closed by ARCH-031** (`done` 2026-08-16), which delivered DERIVATION rather than the classification map the criterion imagined: `ISubagentSpawnRequest`/`ISubagentJobResult`/`ISpawnAgentTaskRequest` are now `Omit<…>` of their transport SSOT, so a dropped field is unrepresentable rather than merely classified, and the parity fixture is extended to the request and result hops. `providerProfile` is carried by that derivation; ARCH-021 is the item that honors it. **Re-scoped, not delivered by ARCH-025.** ARCH-025 landed the two LOCAL repairs inside its declared area (`usage` carried by `wait()`; one `IScheduleEditPatch` owner exported, two re-declarations deleted) and is `done`. The totality mechanism itself moved to **ARCH-031** (issue #1747) after a FOUNDATIONAL finding-depth verdict established the cause spans four packages including the contract owner ARCH-025 does not name; the owner approved that span on 2026-08-16. TC-13 closes with ARCH-031, not with ARCH-025.
- [x] TC-14 — share one executable-aware shell resolver across both runners, with simulated override matrices and real Windows default execution in ARCH-026.
- [ ] TC-15 — run every child done gate and archive all fourteen Task records atomically.
- [ ] TC-16 — pass assembled conformance, scoped verification, and the CI-equivalent gate.

These Plan rows are initiative-level work, not a second child lifecycle ledger. The canonical child
projection is the section below.

## Children

- [x] ARCH-014 — done — `.agents/tasks/completed/ARCH-014-session-log-external-payloads-have-no-dereferencer.md`
- [x] ARCH-015 — done — `.agents/tasks/completed/ARCH-015-two-writers-one-record-contract-session-save-destroys-fields.md`
- [x] ARCH-016 — done — `.agents/tasks/completed/ARCH-016-session-log-event-vocabulary-and-compaction-trigger-split-brain.md`
- [x] ARCH-017 — done — `.agents/tasks/completed/ARCH-017-injected-permission-ask-handlers-are-dead-surface.md`
- [x] ARCH-018 — done — `.agents/tasks/completed/ARCH-018-interaction-channel-charter-is-unsatisfiable-as-written.md`
- [x] ARCH-020 — done — `.agents/tasks/completed/ARCH-020-branch-event-is-declared-and-emitted-by-nothing.md`
- [x] ARCH-021 — done — `.agents/tasks/completed/ARCH-021-child-process-subagent-worker-bypasses-product-composition.md`
- [x] ARCH-022 — done — `.agents/tasks/completed/ARCH-022-framework-pass-through-re-export-evades-public-surface-guard.md`
- [x] ARCH-023 — done — `.agents/tasks/completed/ARCH-023-createAgentRuntime-default-sessionstore-never-forwarded.md`
- [x] ARCH-024 — done — `.agents/tasks/completed/ARCH-024-framework-hardcodes-module-owned-command-ids.md`
- [x] ARCH-025 — done — `.agents/tasks/completed/ARCH-025-executor-projections-silently-drop-contract-fields.md`
- [x] ARCH-026 — done — `.agents/tasks/completed/ARCH-026-scheduled-task-runner-bypasses-shell-resolution-ssot.md`
- [x] ARCH-027 — done — `.agents/tasks/completed/ARCH-027-dead-composition-contract-fields.md`
- [x] ARCH-028 — done — `.agents/tasks/completed/ARCH-028-plan-and-context-refresh-events-emitted-into-a-contract-no-transport-consumes.md`

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

### 2026-08-16

- ARCH-016, ARCH-017, ARCH-018, and the combined ARCH-020+ARCH-028 event-delivery work unit passed
  their independent completion gates and were archived with durable scenario/engineering evidence.
- ARCH-022, ARCH-024, ARCH-026, and ARCH-027 passed their independent Batch 3 completion gate. The
  exact-head Windows run `31902814337` supplied ARCH-026's real runner artifact; the remaining public
  scenarios matched their owner canonical records, and ARCH-022 retained its valid runtime N/A.
- The batch passed the affected scoped harnesses, canonical scenario comparisons, conformance, and
  the repository scan (`110` passed, `2` intentionally skipped).

## Decisions

- Advance the paired spec to `approved` and execute on a dedicated integration base.
- Keep child behavior, test, and evidence ownership in the source Task records.

## Blockers

- None.

## Result

Pending — **and it was asked to close on 2026-08-18, which is how the remaining gap was found.**

All fourteen children are `done` and archived, which is what made the initiative look finished from
the outside. It is not: two of sixteen completion criteria are unmet.

- **TC-15 — MET.** All fourteen `completed/` paths resolve; `check-done-evidence.mjs` and
  `check-task-archival.mjs` both pass (exit 0).
- **TC-08 — NOT MET.** ARCH-021 delivered the composition half inside its declared area and filed the
  rest as ARCH-033/034/035/036 and SEC-009. ARCH-036 reached `done` on 2026-08-18; the other four are
  still OPEN, and **SEC-009 carries the criterion's own "keeps credentials parent-side" clause** — an
  `apiKey` in the subagent IPC start payload.
- **TC-16 — NOT MET.** `harness:conformance` is green (exit 0), but `harness:verify-like-ci` exits 1.

**The attempt to close it is worth recording, because a check caught what a reading did not.** TC-08
was ticked using the re-scope treatment TC-13 received, and `scan-resolving-claims` rejected it as
`ticked-but-unfinished` — every one of `verify-like-ci`'s three failing stages traced to that single
tick. TC-13 closes onto ARCH-031, which is DONE; this would have closed onto five items of which only
ARCH-036 has since finished. A criterion may be re-scoped onto work that finished, not onto work that
has not.

Ticking it would have claimed a security property the repository does not have.

**To close:** SEC-009 lands (ARCH-033/034/035 are `todo` and would need the same judgement; ARCH-036
landed on 2026-08-18), or the owner re-scopes TC-08 explicitly — the decision this record shows the
owner making for TC-13 on 2026-08-16. Then TC-16 is re-run green on the closing base and recorded.
