# Architecture Conformance — Improvement Proposal

> **Backlog:** INFRA-002 · **Date:** 2026-06-13 · **Source:** `conformance-audit-report.md`
> Maps each finding to a remediation, a proposed follow-up backlog, and a mechanical-guard recommendation.

## 1. Remediation Strategy

The audit found **zero code/graph violations** and **25 prose/diagram drift findings**. Remediation is
therefore almost entirely **documentation correction**, grouped into coherent follow-up backlogs rather
than one-per-finding (one-backlog-per-PR stays reviewable; related doc edits ship together). Each P0
gets its own focused draft backlog (TC-06); P1/P2 are grouped thematically.

Per AGENTS.md ("prefer a mechanical check over prose"), every recurring class of drift is paired with a
**mechanical-guard recommendation** so it cannot silently re-accumulate — these guards are the concrete
input to INFRA-003 (conformance skill system + gate).

## 2. P0 — Focused Follow-up Backlogs (one per finding, TC-06)

| Finding                                              | Remediation                                                                                                                           | Proposed backlog                             | Fix kind       | Mechanical guard?                                                                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AF-01** agent-core SPEC names consumers            | Rewrite `agent-core/docs/SPEC.md` "Consumed By" + Layer diagram with role-based descriptions (no consumer package names).             | `INFRA-004-agent-core-spec-role-based-refs`  | Doc correction | **Yes** — extend a scan to flag any `@robota-sdk/agent-*` consumer name inside a zero-dep foundation package's SPEC.md.                             |
| **AF-02** auth/credits live-vs-planned contradiction | Mark `auth`/`credits` as "Planned" in `ARCHITECTURE.md` to match `project-structure.md`; single SSOT for package existence.           | `INFRA-005-architecture-md-planned-packages` | Doc correction | **Yes** — a scan asserting every package named in `ARCHITECTURE.md`/architecture-map either exists under `packages/` or carries a "Planned" marker. |
| **AF-03** agent-cli SPEC phantom dep chain           | Rewrite `agent-cli/docs/SPEC.md` dependency section to the real 6-edge graph; remove `agent-sdk`/`agent-sessions`/`agent-provider-*`. | `INFRA-006-agent-cli-spec-dependency-chain`  | Doc correction | **Yes** — covered by the package-name guard below (AF-06 guard), which would have caught this.                                                      |

## 3. P1 — Thematic Follow-up Backlogs

| Findings                              | Theme                                                                                                                                               | Remediation                                                                                                                                                                                                                                                                                                        | Proposed backlog                                            | Mechanical guard?                                                                                                                                                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AF-04, AF-05, AF-06, AF-13, AF-12** | **Stale package naming / phantom packages** (`agent-team`, `agent-sdk`, `agent-sessions`, `agent-transport-http/-ws`, `agent-command-*` split pkgs) | Sweep all `.agents/` docs + package SPECs: replace stale names with real ones, delete `agent-team` references, remove the dangling `agent-team.md` router link (or create the doc if the abstraction is intended).                                                                                                 | `INFRA-007-purge-stale-package-names`                       | **Yes (high value)** — a scan that greps every architecture doc + SPEC for any `@robota-sdk/agent-*` token and fails on names not in the actual workspace package set. This single guard prevents AF-03, AF-04, AF-05, AF-06, AF-12, AF-13 from recurring. |
| **AF-09, AF-12 (partial)**            | **FLOW-001~006 wake/schedule contracts undocumented**                                                                                               | Document the background/wake contract: add wake/cron/monitor sections to `background-task-layer.md`, `/schedule`+`/monitor` rows to `command-inventory.md`, and the `spawnScheduledWake`/`spawnMonitorWake` host-context bridge to `cross-cutting-contracts.md`.                                                   | `BEHAVIOR-004-document-wake-schedule-contracts`             | Partial — the conformance gate (INFRA-003) should flag new cross-package host-context methods that have no spec reference.                                                                                                                                 |
| **AF-07**                             | **Stale `[Planned]` WS sidecar banner**                                                                                                             | Downgrade `agent-system.md` WS section to "partially implemented; only `startWebSidecarServer()` + CLI `--web` flags pending"; cite the implemented signatures.                                                                                                                                                    | Fold into `BEHAVIOR-004` (same transport/wake area)         | No (one-off).                                                                                                                                                                                                                                              |
| **AF-08**                             | **cross-cutting-contracts.md phantom owners**                                                                                                       | Mark auth/credits contract owners as "Planned (package not yet created)"; resolved by the AF-02 guard.                                                                                                                                                                                                             | Fold into `INFRA-005`                                       | Yes (AF-02 guard).                                                                                                                                                                                                                                         |
| **AF-10, AF-18, AF-19**               | **apps-and-deployment.md stale**                                                                                                                    | Remove dead `apps/docs/scripts/*` paths; add `action`/`starter-nextjs`/`www`; clarify agent-web Vercel-vs-Firebase deploy reality.                                                                                                                                                                                 | `INFRA-008-apps-deployment-doc-refresh`                     | Partial — a scan that every path cited in a mermaid/code-fence inside architecture docs resolves on disk.                                                                                                                                                  |
| **AF-11**                             | **Broken mermaid diagrams**                                                                                                                         | Declare missing nodes (`Playground`, `TypeContracts`, `IfaceTransport`, `IfaceTui`) or remove the phantom edges in `dependency-direction.md` + `agent-system.md`.                                                                                                                                                  | `INFRA-009-fix-mermaid-undeclared-nodes`                    | **Yes** — a mermaid-lint step that fails on edge endpoints referencing undeclared nodes.                                                                                                                                                                   |
| **AF-14**                             | **Interface Package Rule under-enforced**                                                                                                           | Decide: either (a) relax the rule prose to reflect that transport legitimately consumes interface types from `agent-framework`, or (b) extract those interface types to an `agent-interface-*` package and migrate. **Requires a design decision (architecture-direction), not a doc fix** — escalate to the user. | `INFRA-010-interface-package-rule-reconcile` (design-gated) | Yes (after decision) — extend `check-dependency-direction.mjs` to assert interface-type imports come from `agent-interface-*`.                                                                                                                             |

## 4. P2 — Single Cleanup Backlog

`INFRA-011-architecture-doc-p2-cleanup` — batch the cosmetic fixes: AF-15 (Assembly→Adapters "policy
not edge" note), AF-16 (interface-\* plural), AF-17 (refresh ARCHITECTURE-MAP date + add an auto-stamp),
AF-20 (agent-web-ui SPEC title), AF-21 (agent-framework scope), AF-22 (repository-overview family
table), AF-23 (agent-command transport naming). No individual guard; covered by the package-name guard
(AF-06) and date-stamp automation.

## 5. Process Findings → INFRA-003 Inputs

| Finding                                                 | Action                                                                                                               |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **AF-24** gate-guard task template lacks `## Test Plan` | Fix the `backlog-gate-guard` GATE-IMPLEMENT task template to include a `## Test Plan` stub. Fold into **INFRA-003**. |
| **AF-25** 33 files >300 lines (warning)                 | Out of scope; leave as the existing `file-size` warning. No backlog.                                                 |

## 6. Recommended Mechanical Guards (the case for INFRA-003)

The audit's central lesson: **mechanical enforcement caught the dependency graph perfectly but nothing
guards the prose/diagram layer**, which is exactly where all 25 findings live. The highest-leverage
guards, in priority order:

1. **Workspace-package-name guard** — fail if any architecture doc / SPEC references an `@robota-sdk/agent-*`
   token that is not a real workspace package (or lacks a "Planned" marker). Single-handedly prevents
   AF-02, AF-03, AF-04, AF-05, AF-06, AF-08, AF-12, AF-13.
2. **Cited-path guard** — fail if a path inside a code-fence/mermaid in an architecture doc does not
   resolve on disk. Prevents AF-10.
3. **Mermaid undeclared-node lint** — prevents AF-11.
4. **Foundation-package SSOT guard** — prevents AF-01.
5. **Doc freshness stamp** — auto-update "source-verified" dates. Prevents AF-17.

These guards are the concrete deliverable INFRA-003 should wrap into the conformance skill set + gate,
composing with the existing `check-dependency-direction.mjs` + `harness:scan`.

## 7. Sequencing

1. **INFRA-002** (this) — audit + proposal. ✔
2. **P0 backlogs** (`INFRA-004`, `INFRA-005`, `INFRA-006`) — drafts created now (TC-06).
3. **INFRA-003** — conformance skill system + gate, implementing guards #1–#5 above so the P1/P2 sweeps
   can be verified mechanically rather than re-audited by hand.
4. **P1/P2 thematic backlogs** — executed with the new guards in place.

> All follow-up backlog IDs above are _proposed_; each must still pass GATE-WRITE → GATE-APPROVAL before
> implementation. Only the three P0 drafts are created by INFRA-002 (TC-06).
