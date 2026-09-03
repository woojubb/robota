---
status: approved
type: AGREEMENT
tags: [github, migration, batching]
lane: L2
---

# AGREEMENT-012: coordinate strict metadata decoder adoption

## Problem

The source hierarchy under issue #2066 still represents skill, plugin, and agent-definition metadata trust as duplicate GitHub execution entries even though RULE-023 assigns internal implementation ownership to Tasks; issue #2094 is its first leaf, not the hierarchy root. Staging the declared Tasks without a relationship owner makes the repository planning-order guard refuse the multi-Task prelude, while processing them one by one repeats equivalent gates and read-backs.

## Prior Art Research

Waived: RULE-023 already researched and approved the Issue-to-Task migration model. This spec applies that repository-local decision to a finite homogeneous group and creates no new product, protocol, package, API, or user-interface design.

## Architecture Review

### Affected Scope

- This exact AGREEMENT Task/spec and 2 child Tasks.
- The RULE-023 durable manifest and later GitHub records for the exact source rows.
- No product source, runtime surface, public API, or package dependency.

### Alternatives Considered

1. **Process every row as an independent planning lifecycle.**
   - Pro: smallest individual commits.
   - Con: repeats equivalent gate and verification overhead without a different safety boundary.
2. **Use this exact atomic AGREEMENT projection.**
   - Pro: preserves one source per Task, native dependency order, and one bounded rollback/read-back unit.
   - Con: increases the batch rollback unit.
3. **Keep duplicate child Issues indefinitely.**
   - Pro: requires no migration.
   - Con: preserves duplicate queue and priority ownership contrary to RULE-023.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — planning and GitHub administration only.
- [x] Sibling scan 완료 — source rows, current Tasks, dependencies, markers, PRs, and parent map were inspected.
- [x] 대안 최소 2개 검토 완료 — three alternatives above.
- [x] 결정 근거 문서화 완료 — exact ownership and reduced serial overhead drive the choice.
- [x] New-surface placement: N/A — no package, application, presentation surface, or public interface.

### Decision

Use one atomic AGREEMENT for this group. The larger rollback unit is accepted because every row has the same administrative terminal meaning and exact independent Task owner; in exchange, planning and read-back are performed once for the group. RETAIN-class parent issue #2066 remains an Issue. Included security/data issue #2094 and issue #2095 are strict-loader integration slices with no separate claimant or release lifecycle; SECURITY-003 and SECURITY-004 preserve fail-closed trust constraints and mutation remains separately gated.

**Delivery mode:** `single`

## Solution

1. Land the exact Task projection without product implementation.
2. Freeze the current body, labels, marker, assignee, hierarchy, dependency, and target Task path for each row.
3. Append one marker, remove only the P-priority label, preserve the source body as a prefix, and close absorbed rows `NOT_PLANNED`.
4. Update the canonical parent map and replay idempotently without duplicate markers or extra mutations.
5. Perform one post-write group reconciliation and one affected repository verification.

## Completion Criteria

- [ ] TC-01: Observable: every declared Task exists on `develop` and cites its exact source Issue.
- [ ] TC-02: Observable: native dependency order and named external prerequisites remain intact.
- [ ] TC-03: Observable: the durable manifest authorizes exactly this group and no other Issue.
- [ ] TC-04: Observable: canonical parent issue #2066 contains the complete exact owner map; every absorbed row has one `woojubb` marker, no P-priority label, `CLOSED/NOT_PLANNED`, a byte-identical source-body prefix, unchanged hierarchy and dependencies, and no removed assignee or historical URL; replay adds nothing.
- [ ] TC-05: Command: the full group read-back and affected repository scan exit zero after population reconciliation.

## Test Plan

| Criterion | Test Type | Tool / Approach                                                                         |
| --------- | --------- | --------------------------------------------------------------------------------------- |
| TC-01     | automated | Task lifecycle and exact source-URL scan                                                |
| TC-02     | automated | frozen/post-write dependency and prerequisite comparison                                |
| TC-03     | automated | manifest exact-set assertion                                                            |
| TC-04     | automated | complete parent-map/body/relationship/assignee/history read-back plus idempotent replay |
| TC-05     | automated | GitHub audit, population arithmetic, and affected scans                                 |

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This work unit changes Task/spec governance and future GitHub Issue administration only; it exposes no runnable Robota product surface, so child Tasks own future runtime scenarios.

## Tasks

Paired execution record:
`.agents/tasks/AGREEMENT-012-coordinate-strict-metadata-decoder-adoption.md`.

- [ ] SECURITY-003 — todo — `.agents/tasks/SECURITY-003-migrate-skill-and-plugin-discovery-to-the-strict-decoder.md`
- [ ] SECURITY-004 — todo — `.agents/tasks/SECURITY-004-migrate-agent-definition-loading-to-the-strict-decoder.md`

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-03

**Status upgrade:** draft → review-ready

- GATE-WRITE — File begins with `---` YAML frontmatter block: PASS — the file begins with a delimited `---` frontmatter block.
- GATE-WRITE — `status: draft` present in frontmatter: PASS — frontmatter declares `status: draft`.
- GATE-WRITE — `type:` is exactly one permitted value: PASS — `type: AGREEMENT` is one of the 11 allowed values.
- GATE-WRITE — `tags:` field present in frontmatter: PASS — `tags:` is present with three values.
- GATE-WRITE — Contains a concrete symptom: PASS — strict-metadata source rows under issue #2066 remain duplicate GitHub execution entries, and the repository planning-order guard refuses their multi-Task prelude when it lacks a relationship owner.
- GATE-WRITE — Contains a reproduction condition: PASS — the Problem identifies staging the two declared Tasks under true hierarchy root issue #2066, rather than first leaf issue #2094, without a relationship owner as the condition that triggers the refusal.
- GATE-WRITE — Does not contain `TBD`, `TODO`, or a vague single-sentence Problem: PASS — the Problem contains neither token and has 475 characters across two specific sentences.
- GATE-WRITE — `## Prior Art Research` or `## Research` section present: PASS — `## Prior Art Research` is present.
- GATE-WRITE — Prior Art Research is substantiated by a source, no-comparable-reference result, or waiver: PASS — the section explicitly waives duplicate external research in favor of RULE-023's approved repository-local Issue-to-Task migration model.
- GATE-WRITE — Explicit `Waived: <reason>` alternative is satisfied: PASS — the waiver explains that this finite administrative application creates no product, protocol, package, API, or UI design question.
- GATE-WRITE — Research findings or waiver feed Alternatives Considered and Decision: PASS — RULE-023's exact Task ownership model directly yields the serial, atomic, and retain-duplicate alternatives and the selected atomic projection while retaining parent issue #2066.
- GATE-WRITE — All Architecture Review checklist items are checked: PASS — all five displayed items are `[x]`.
- GATE-WRITE — Sibling scan is checked with completion evidence or an explicit N/A reason: PASS — the checked item records inspection of source rows, Tasks, dependencies, markers, pull requests, and the parent map.
- GATE-WRITE — Alternatives Considered has at least two entries with Pro and Con: PASS — three numbered alternatives each state both.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — it accepts a larger batch rollback unit in exchange for one planning and read-back cycle; SECURITY-003 and SECURITY-004 preserve the fail-closed trust constraints of security/data issue #2094 and issue #2095.
- GATE-WRITE — New-surface placement conditional: PASS as N/A — this administrative migration introduces no package, app, presentation/public interface, product-family surface, or layer reclassification.
- GATE-WRITE — Every Completion Criterion has a `TC-NN` prefix: PASS — all five criteria are prefixed `TC-01:` through `TC-05:`.
- GATE-WRITE — At least one criterion exists per distinct feature or sub-item: PASS — TC-01 covers SECURITY-003 and SECURITY-004 ownership; TC-02 dependency and prerequisite preservation; TC-03 exact manifest authority; TC-04 terminal mutation, issue #2066's complete parent map, preservation, and replay idempotence; and TC-05 reconciliation and scans.
- GATE-WRITE — Each criterion uses Command or Observable behavior form: PASS — every criterion requires inspectable paths, exact sets, dependency state, marker/label/state/body/map/history results, replay behavior, or named commands exiting zero.
- GATE-WRITE — No criterion uses a forbidden vague phrase: PASS — none contains `works correctly`, `no errors`, `implemented`, or `displays correctly`.
- GATE-WRITE — `## Test Plan` section present: PASS — the section is present.
- GATE-WRITE — One Test Plan row exists for each Completion Criterion: PASS — five rows match the five completion criteria.
- GATE-WRITE — Every Test Plan row has a non-empty Test Type and Tool/Approach without `TBD`: PASS — all five rows satisfy the required fields.
- GATE-WRITE — Manual Test Plan rows explain why automation is impossible: PASS — there are zero manual rows.
- GATE-WRITE — `## Tasks` section present with placeholder: PASS — the section names the paired AGREEMENT-012 execution record before SECURITY-003 and SECURITY-004.
- GATE-WRITE — `## Evidence Log` was present and empty before this first entry: PASS — the mechanical dry-run observed zero prior entries and no later-gate entry.
- GATE-WRITE — No body `## Status` or `## Classification` section: PASS — neither body section exists.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-03

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "모두 승인함. 모든 너의 제안에 대해 타당한 근거가 있다면 자동으로 사전 승인함"
**Given:** 2026-09-03, this conversation
**Review fingerprint:** 049f43a245fc (review 85efbee7, type/tags 8493cd67)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-03, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (049f43a245fc) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the user replied `모두 승인함. 모든 너의 제안에 대해 타당한 근거가 있다면 자동으로 사전 승인함` to the current proposal containing AGREEMENT-012; `모두 승인함` directly approves the presented work, and the stated evidence condition is satisfied by this document's independent GATE-WRITE PASS.
- GATE-APPROVAL — The item is inside the class as the registry defines it: PASS (N/A) — the newest entry selects the mutually exclusive DIRECT route, so no delegated approval class is asserted and the Route CLASS boundary criterion does not apply.
- GATE-APPROVAL — Independent architecture validation (conditional): PASS (N/A) — this administrative planning and GitHub migration spec introduces no package, app, product/interface/presentation surface, sibling-product dependency, or layer/product-family reclassification; its GATE-WRITE review records the same N/A boundary.
