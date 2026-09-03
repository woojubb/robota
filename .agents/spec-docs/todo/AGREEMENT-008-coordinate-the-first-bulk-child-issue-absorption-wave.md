---
status: approved
type: AGREEMENT
tags: [github, migration, batching]
lane: L2
---

# AGREEMENT-008: Coordinate the first bulk child-Issue absorption wave

## Problem

RULE-023 established that internal implementation decomposition belongs in Tasks, but 17 non-security
records under canonical issue #2079 still exist only as independently prioritized GitHub queue entries.
Together with the five command-contract records already modeled by AGREEMENT-007, they form a coherent
22-row migration wave. Processing them one at a time repeats the same planning, conversion, and read-back
overhead without improving the safety boundary.

The current repository reproduces the coordination gap by staging the 17 exact Task files and running a
normal `git commit`: `scan-user-execution-plan-order` exits 1 with `staged implementation has no planning
checkpoint ancestor` because several independently named Task preludes cannot share one commit unless an
AGREEMENT declares their complete projection. This occurs on base
`cbb906bf736f3cc07409ad5cc162c736042782d6` before any C1 GitHub write.

## Prior Art Research

Waived: RULE-023 already completed external research for the exact Issue-to-Task ownership and migration
model. AGREEMENT-008 applies that accepted repository-local contract to a finite set and introduces no new
product, API, protocol, package, or user-facing design question. The relevant local evidence is the
RULE-023 manifest, the previously completed B1/B2 rows, and the scanner's atomic AGREEMENT contract.

## Architecture Review

### Affected Scope

- One AGREEMENT Task/spec and 17 exact todo Task records.
- The existing RULE-023 durable migration manifest in the later apply commit.
- Exactly 22 GitHub Issue rows and canonical parent issue #2079 in the later external mutation.
- No product source, package manifest, runtime surface, public API, or user interface.

### Alternatives Considered

1. **Open and checkpoint 17 independent planning units serially.**
   - Pro: smallest per-record repository commits.
   - Con: repeats the same gate and verification overhead 17 times and contradicts the owner's explicit
     instruction to batch homogeneous migration work.
2. **Declare one atomic AGREEMENT projection for all 17 Task owners.**
   - Pro: preserves exact source ownership and satisfies the repository's native multi-Task planning form
     while enabling one 22-row external apply/read-back boundary.
   - Con: increases the rollback unit and requires one relationship owner.
3. **Use one generic Task for all source Issues.**
   - Pro: fewest files.
   - Con: destroys independently executable outcomes and exact Task-to-source-Issue identity.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — repository planning and GitHub administration only.
- [x] Sibling scan 완료 — AGREEMENT-007, the 17 source rows, all existing Task IDs, B1/B2 evidence, and
      RULE-023 owner files were inspected.
- [x] 대안 최소 2개 검토 완료 — three alternatives above.
- [x] 결정 근거 문서화 완료 — exact ownership and reduced serial overhead drive the decision.
- [x] New-surface placement: N/A — no package, app, presentation surface, public interface, or product
      family is introduced.

### Decision

Treat the 17 records as one atomic planning graph rooted at AGREEMENT-008, and combine them with the five
already-modeled AGREEMENT-007 command records only at the external C1 apply boundary. Each child keeps its
exact source Issue and independently executable outcome. GitHub changes remain row-specific and
idempotent, while validation and population reconciliation occur once for the complete 22-row wave.

The trade-off is a larger rollback unit in exchange for far less serial overhead. This is acceptable
because every row is non-security, unassigned, has an exact Task owner, preserves native relationships,
and uses the same terminal meaning: the Issue is no longer planned independently while work continues in
the Task.

**Delivery mode:** `single`

## Solution

1. Land the 17 Task records atomically with this AGREEMENT.
2. Freeze all 22 exact source Issue, label, marker, Task path, body-notice, relationship-preservation, and
   terminal-state mutations in the RULE-023 durable manifest.
3. Apply Task markers and priority-label removals, then close in dependency-safe reverse order as
   `NOT_PLANNED`.
4. Update the canonical issue #2079 execution-owner map and preserve each source body as the prefix of its
   migration notice.
5. Perform one complete read-back and one repository verification pass after all writes.

## Completion Criteria

- [ ] TC-01: Observable: all 17 exact child Task paths exist on `develop` and cite their exact source
      Issues.
- [ ] TC-02: Observable: the durable RULE-023 manifest names exactly 22 C1 rows and authorizes no other
      Issue.
- [ ] TC-03: Observable: all 22 rows have exactly one `woojubb` Task marker, no P-priority label, and
      terminal state `CLOSED/NOT_PLANNED`; replay produces no duplicate marker or additional mutation.
- [ ] TC-04: Observable: issue #2079 contains the complete exact execution-owner map, every target body
      preserves its frozen source body byte-for-byte as a prefix, native hierarchy and dependency
      projections are unchanged except target closure, and no assignee or historical URL is removed.
- [ ] TC-05: Command: the complete post-write issue audit and affected repository scan exit zero after the
      evidence manifest records the reconciled population.

## Test Plan

| Criterion | Test Type | Tool / Approach                                                             |
| --------- | --------- | --------------------------------------------------------------------------- |
| TC-01     | automated | Task lifecycle and exact Issue-source scans over all 17 children            |
| TC-02     | automated | JSON schema and exact-set assertion for the 22-row C1 batch                 |
| TC-03     | automated | one GraphQL/REST read-back plus idempotent replay of all 22 rows            |
| TC-04     | automated | compare issue #2079 map, body prefixes, and frozen/post-write relationships |
| TC-05     | automated | `github-issue-triage audit`, affected scans, and population arithmetic      |

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This work unit changes Task/spec governance and future GitHub Issue administration only; it exposes no runnable Robota product surface, so child Tasks own future runtime scenarios.

## Tasks

Paired execution record:
`.agents/tasks/AGREEMENT-008-coordinate-the-first-bulk-child-issue-absorption-wave.md`.

- [ ] REFACTOR-027 — todo — `.agents/tasks/REFACTOR-027-remove-phantom-service-and-factory-ports-from-agent-core.md`
- [ ] REFACTOR-028 — todo — `.agents/tasks/REFACTOR-028-finish-removing-the-ghost-workflow-subsystem-from-agent-core.md`
- [ ] TRANS-011 — todo — `.agents/tasks/TRANS-011-the-transport-registry-erases-heterogeneous-exact-session-capabilities-into-one-.md`
- [ ] TRANS-012 — todo — `.agents/tasks/TRANS-012-coordinate-exact-session-capability-transport-bindings.md`
- [ ] TRANS-013 — todo — `.agents/tasks/TRANS-013-bind-http-and-mcp-to-their-exact-session-ports.md`
- [ ] TRANS-014 — todo — `.agents/tasks/TRANS-014-bind-ws-protocol-and-webrtc-adapters-to-exact-session-ports.md`
- [ ] TRANS-015 — todo — `.agents/tasks/TRANS-015-remove-iinteractive-session-from-production-transport-seams.md`
- [ ] CMD-014 — todo — `.agents/tasks/CMD-014-coordinate-command-features-as-owner-aligned-vertical-slices.md`
- [ ] CMD-015 — todo — `.agents/tasks/CMD-015-move-execution-background-and-schedule-commands-to-their-owners.md`
- [ ] CMD-016 — todo — `.agents/tasks/CMD-016-move-session-history-compact-and-rewind-commands-to-their-owners.md`
- [ ] CMD-017 — todo — `.agents/tasks/CMD-017-move-provider-settings-and-plugin-commands-to-their-owners.md`
- [ ] CMD-018 — todo — `.agents/tasks/CMD-018-move-help-language-and-permission-commands-to-the-product-shell.md`
- [ ] CMD-019 — todo — `.agents/tasks/CMD-019-expose-coding-commands-as-leaf-entries-and-remove-umbrella-consumers.md`
- [ ] HOST-015 — todo — `.agents/tasks/HOST-015-coordinate-headless-and-programmatic-host-extraction.md`
- [ ] HOST-016 — todo — `.agents/tasks/HOST-016-extract-the-headless-stdio-host-package.md`
- [ ] HOST-017 — todo — `.agents/tasks/HOST-017-extract-the-programmatic-in-process-host-package.md`
- [ ] HOST-018 — todo — `.agents/tasks/HOST-018-migrate-consumers-and-remove-the-agent-transport-umbrella.md`

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-03

**Status upgrade:** draft → review-ready

- GATE-WRITE — File begins with `---` YAML frontmatter block: PASS — the file begins with a delimited `---` frontmatter block.
- GATE-WRITE — `status: draft` present in frontmatter: PASS — frontmatter declares `status: draft`.
- GATE-WRITE — `type:` is exactly one permitted value: PASS — `type: AGREEMENT` is one of the 11 allowed values.
- GATE-WRITE — `tags:` field present in frontmatter: PASS — `tags:` is present with three values.
- GATE-WRITE — Contains a concrete symptom: PASS — 17 non-security records under canonical issue #2079 remain independently prioritized GitHub queue entries, and staging their exact Tasks without one complete AGREEMENT projection makes `scan-user-execution-plan-order` refuse the commit.
- GATE-WRITE — Contains a reproduction condition: PASS — the Problem names the 17 staged Task files, a normal `git commit`, exit 1 with `staged implementation has no planning checkpoint ancestor`, exact base `cbb906bf736f3cc07409ad5cc162c736042782d6`, and the pre-C1-write state.
- GATE-WRITE — Does not contain `TBD`, `TODO`, or a vague single-sentence Problem: PASS — the Problem contains neither token and has 915 characters across five specific sentences.
- GATE-WRITE — `## Prior Art Research` or `## Research` section present: PASS — `## Prior Art Research` is present.
- GATE-WRITE — Prior Art Research is substantiated by a source, no-comparable-reference result, or waiver: PASS — the section explicitly waives duplicate external research in favor of RULE-023's completed research and names the local manifest, completed B1/B2 rows, and scanner contract checked.
- GATE-WRITE — Explicit `Waived: <reason>` alternative is satisfied: PASS — the waiver explains that this finite administrative application introduces no new product, API, protocol, package, or user-facing design question.
- GATE-WRITE — Research findings or waiver feed Alternatives Considered and Decision: PASS — the accepted exact Issue-to-Task ownership model and atomic AGREEMENT scanner contract directly yield the serial, atomic exact-owner, and generic-owner alternatives and the selected atomic graph.
- GATE-WRITE — All Architecture Review checklist items are checked: PASS — all five displayed items are `[x]`.
- GATE-WRITE — Sibling scan is checked with completion evidence or an explicit N/A reason: PASS — the checked item names AGREEMENT-007, all 17 source rows and Task IDs, B1/B2 evidence, and RULE-023 owner files inspected.
- GATE-WRITE — Alternatives Considered has at least two entries with Pro and Con: PASS — three numbered alternatives each state both.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — it explicitly accepts a larger rollback unit in exchange for reduced serial overhead because the 22 rows share non-security, unassigned, exact-owner, relationship-preserving terminal semantics.
- GATE-WRITE — New-surface placement conditional: PASS as N/A — this administrative planning and GitHub migration unit introduces no package, app, presentation/public interface, product-family surface, or layer reclassification.
- GATE-WRITE — Every Completion Criterion has a `TC-NN` prefix: PASS — all five criteria are prefixed `TC-01:` through `TC-05:`.
- GATE-WRITE — At least one criterion exists per distinct feature or sub-item: PASS — TC-01 covers the 17 exact Task owners, TC-02 the exact 22-row authority, TC-03 terminal mutations plus idempotent replay, TC-04 the #2079 map plus byte-identical body prefixes and relationship/history preservation, and TC-05 final audit and population reconciliation.
- GATE-WRITE — Each criterion uses Command or Observable behavior form: PASS — every TC requires inspectable paths, exact sets, marker/label/state results, replay behavior, preserved bytes/relationships/history, or named commands exiting zero.
- GATE-WRITE — No criterion uses a forbidden vague phrase: PASS — none contains `works correctly`, `no errors`, `implemented`, or `displays correctly`.
- GATE-WRITE — `## Test Plan` section present: PASS — the section is present.
- GATE-WRITE — One Test Plan row exists for each Completion Criterion: PASS — five rows match the five TC criteria.
- GATE-WRITE — Every Test Plan row has a non-empty Test Type and Tool/Approach without `TBD`: PASS — all five rows satisfy the required fields.
- GATE-WRITE — Manual Test Plan rows explain why automation is impossible: PASS — there are zero manual rows.
- GATE-WRITE — `## Tasks` section present with placeholder: PASS — the section names the paired AGREEMENT-008 execution record before all 17 todo child Tasks.
- GATE-WRITE — `## Evidence Log` was present and empty before this first entry: PASS — the mechanical dry-run observed zero prior entries and no later-gate entry.
- GATE-WRITE — No body `## Status` or `## Classification` section: PASS — neither body section exists.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-03

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "모두 승인함. 모든 너의 제안에 대해 타당한 근거가 있다면 자동으로 사전 승인함"
**Given:** 2026-09-03, this conversation
**Review fingerprint:** 22952bd74765 (review 492bb24d, type/tags 8493cd67)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-03, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (22952bd74765) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the user replied `모두 승인함. 모든 너의 제안에 대해 타당한 근거가 있다면 자동으로 사전 승인함` to the current proposal containing AGREEMENT-008; `모두 승인함` directly approves the presented work, and the stated evidence condition is satisfied by this document's independent GATE-WRITE PASS.
- GATE-APPROVAL — The item is inside the class as the registry defines it: PASS (N/A) — the newest entry selects the mutually exclusive DIRECT route, so no delegated approval class is asserted and the Route CLASS boundary criterion does not apply.
- GATE-APPROVAL — Independent architecture validation (conditional): PASS (N/A) — this administrative planning and GitHub migration spec introduces no package, app, product/interface/presentation surface, sibling-product dependency, or layer/product-family reclassification; its GATE-WRITE review records the same N/A boundary.
