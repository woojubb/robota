---
status: in-progress
type: AGREEMENT
tags: [github, migration, batching]
lane: L2
---

# AGREEMENT-016: coordinate the throughput child-Issue dispositions

## Problem

The source hierarchy under issue #2512 still represents verification receipt reuse and independent gate parallelism as duplicate GitHub execution entries even though RULE-023 assigns internal implementation ownership to Tasks. Staging the declared Tasks without a relationship owner makes the repository planning-order guard refuse the multi-Task prelude, while processing them one by one repeats equivalent gates and read-backs.

## Prior Art Research

Waived: RULE-023 already researched and approved the Issue-to-Task migration model. This spec applies that repository-local decision to a finite homogeneous group and creates no new product, protocol, package, API, or user-interface design.

## Architecture Review

### Affected Scope

- This exact AGREEMENT Task/spec and 1 child Tasks.
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

Use one atomic AGREEMENT for this group. The larger rollback unit is accepted because every row has the same administrative terminal meaning and exact independent Task owner; in exchange, planning and read-back are performed once for the group. A row remains an Issue only when it needs an independently meaningful external lifecycle; priority, domain, or independent releasability alone does not establish that exception. The exact Task and source history preserve all verification-integrity constraints after absorption.

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
- [ ] TC-04: Observable: every absorbed row has one `woojubb` marker, no P-priority label, `CLOSED/NOT_PLANNED`, a preserved source-body prefix, unchanged native hierarchy, dependencies, and assignees, a resolvable historical Issue URL, and an exact entry in the complete canonical parent map; replay adds nothing.
- [ ] TC-05: Command: the full group read-back and affected repository scan exit zero after population reconciliation.

## Test Plan

| Criterion | Test Type | Tool / Approach                                          |
| --------- | --------- | -------------------------------------------------------- |
| TC-01     | automated | Task lifecycle and exact source-URL scan                 |
| TC-02     | automated | frozen/post-write dependency and prerequisite comparison |
| TC-03     | automated | manifest exact-set assertion                             |
| TC-04     | automated | one authenticated group read-back plus idempotent replay |
| TC-05     | automated | GitHub audit, population arithmetic, and affected scans  |

The approved rows are executed as one bounded administrative batch, followed by one complete reconciliation.

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This work unit changes Task/spec governance and future GitHub Issue administration only; it exposes no runnable Robota product surface, so child Tasks own future runtime scenarios.

## Tasks

Paired execution record:
`.agents/tasks/AGREEMENT-016-coordinate-the-throughput-child-issue-dispositions.md`.

- [ ] INFRA-154 — todo — `.agents/tasks/INFRA-154-reuse-final-tree-verification-receipts-and-parallelize-independent-gates.md`

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-03

**Status upgrade:** draft → review-ready

- GATE-WRITE — File begins with `---` YAML frontmatter block: PASS — the file begins with a delimited `---` frontmatter block.
- GATE-WRITE — `status: draft` present in frontmatter: PASS — frontmatter declares `status: draft`.
- GATE-WRITE — `type:` is exactly one permitted value: PASS — `type: AGREEMENT` is one of the 11 allowed values.
- GATE-WRITE — `tags:` field present in frontmatter: PASS — `tags:` is present with three values.
- GATE-WRITE — Contains a concrete symptom: PASS — throughput source rows under issue #2512 remain duplicate GitHub execution entries, and the repository planning-order guard refuses their Task prelude when it lacks a relationship owner.
- GATE-WRITE — Contains a reproduction condition: PASS — the Problem identifies staging the declared Task under issue #2512 without a relationship owner as the condition that triggers the refusal.
- GATE-WRITE — Does not contain `TBD`, `TODO`, or a vague single-sentence Problem: PASS — the Problem contains neither token and has 429 characters across two specific sentences.
- GATE-WRITE — `## Prior Art Research` or `## Research` section present: PASS — `## Prior Art Research` is present.
- GATE-WRITE — Prior Art Research is substantiated by a source, no-comparable-reference result, or waiver: PASS — the section explicitly waives duplicate external research in favor of RULE-023's approved repository-local Issue-to-Task migration model.
- GATE-WRITE — Explicit `Waived: <reason>` alternative is satisfied: PASS — the waiver explains that this finite administrative application creates no product, protocol, package, API, or UI design question.
- GATE-WRITE — Research findings or waiver feed Alternatives Considered and Decision: PASS — RULE-023's exact Task ownership model directly yields the serial, atomic, and retain-duplicate alternatives and the selected paired AGREEMENT projection.
- GATE-WRITE — All Architecture Review checklist items are checked: PASS — all five displayed items are `[x]`.
- GATE-WRITE — Sibling scan is checked with completion evidence or an explicit N/A reason: PASS — the checked item records inspection of source rows, Tasks, dependencies, markers, pull requests, and the parent map.
- GATE-WRITE — Alternatives Considered has at least two entries with Pro and Con: PASS — three numbered alternatives each state both.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — it accepts the paired planning rollback unit in exchange for one planning and read-back cycle, while INFRA-154 and source history preserve the verification-integrity constraints of issue #2518.
- GATE-WRITE — New-surface placement conditional: PASS as N/A — this administrative migration introduces no package, app, presentation/public interface, product-family surface, or layer reclassification.
- GATE-WRITE — Every Completion Criterion has a `TC-NN` prefix: PASS — all five criteria are prefixed `TC-01:` through `TC-05:`.
- GATE-WRITE — At least one criterion exists per distinct feature or sub-item: PASS — TC-01 covers INFRA-154 exact ownership and source identity; TC-02 dependency and prerequisite preservation; TC-03 exact manifest authority; TC-04 terminal mutation, complete parent mapping, source/history/relationship preservation, and replay idempotence; and TC-05 reconciliation and scans.
- GATE-WRITE — Each criterion uses Command or Observable behavior form: PASS — every criterion requires inspectable paths, exact sets, dependency state, marker/label/state/body/map/history results, replay behavior, or named commands exiting zero.
- GATE-WRITE — No criterion uses a forbidden vague phrase: PASS — none contains `works correctly`, `no errors`, `implemented`, or `displays correctly`.
- GATE-WRITE — `## Test Plan` section present: PASS — the section is present.
- GATE-WRITE — One Test Plan row exists for each Completion Criterion: PASS — five rows match the five completion criteria.
- GATE-WRITE — Every Test Plan row has a non-empty Test Type and Tool/Approach without `TBD`: PASS — all five rows satisfy the required fields.
- GATE-WRITE — Manual Test Plan rows explain why automation is impossible: PASS — there are zero manual rows.
- GATE-WRITE — `## Tasks` section present with placeholder: PASS — the section names the paired AGREEMENT-016 execution record before INFRA-154.
- GATE-WRITE — `## Evidence Log` was present and empty before this first entry: PASS — the mechanical dry-run observed zero prior entries and no later-gate entry.
- GATE-WRITE — No body `## Status` or `## Classification` section: PASS — neither body section exists.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-03

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "모두 승인함. 모든 너의 제안에 대해 타당한 근거가 있다면 자동으로 사전 승인함"
**Given:** 2026-09-03, this conversation
**Review fingerprint:** d4e96a32ea30 (review 810bdf3f, type/tags 8493cd67)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-03, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (d4e96a32ea30) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the user replied `모두 승인함. 모든 너의 제안에 대해 타당한 근거가 있다면 자동으로 사전 승인함` to the current proposal containing AGREEMENT-016; `모두 승인함` directly approves the presented work, and the stated evidence condition is satisfied by this document's independent GATE-WRITE PASS.
- GATE-APPROVAL — The item is inside the class as the registry defines it: PASS (N/A) — the newest entry selects the mutually exclusive DIRECT route, so no delegated approval class is asserted and the Route CLASS boundary criterion does not apply.
- GATE-APPROVAL — Independent architecture validation (conditional): PASS (N/A) — this administrative planning and GitHub migration spec introduces no package, app, product/interface/presentation surface, sibling-product dependency, or layer/product-family reclassification; its GATE-WRITE review records the same N/A boundary.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-03

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-03; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/AGREEMENT-016-coordinate-the-throughput-child-issue-dispositions.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/AGREEMENT-016-coordinate-the-throughput-child-issue-dispositions.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (5)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 412 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/AGREEMENT-016-coordinate-the-throughput-child-issue-dispositions.md",
  "specPath": ".agents/spec-docs/todo/AGREEMENT-016-coordinate-the-throughput-child-issue-dispositions.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/AGREEMENT-016-coordinate-the-throughput-child-issue-dispositions.md",
    ".agents/tasks/AGREEMENT-016-coordinate-the-throughput-child-issue-dispositions.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->
