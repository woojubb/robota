---
status: in-progress
type: RULE
tags: []
lane: L2
---

# PROC-034: batch execution gates at work-unit boundaries

Paired with `.agents/tasks/PROC-034-batch-execution-gates-at-work-unit-boundaries.md`. Direct owner-approved amendment; no remote issue is invented.

## Problem

The staged planning-order checker rejects an approved documentation-only Task plus its rule changes in the same commit with a missing planning checkpoint ancestor error. Per-supplement workflow instructions additionally fragment coherent work into repeated reviews, records, commits and verification. Historical checker implementation began before its required planning checkpoint; this clean-tree recovery must preserve that fact.

## Prior Art Research

Waived: bounded repository-specific recovery of an already approved and independently reviewed internal harness change; no product API or new architecture is being selected.

## Architecture Review

### Affected Scope

Repository execution guidance and internal scripts/harness planning-order validation only. No product package, hook, CI or manifest changes.

### Alternatives Considered

1. Retain per-step checkpoints for documentation amendments.
   - Pro: no checker change.
   - Con: retains the exact owner-rejected fragmentation.
2. Narrow atomic documentation predicate with existing product checkpoints unchanged.
   - Pro: batches approved documentation without permitting runnable changes.
   - Con: requires explicit path, Git mode and evidence validation in both consumers.

### Decision

**Delivery mode:** `single`

Use alternative 2, as directly approved. Preserve the prior committed lane floor and strict Markdown allowlist. A single open Task needs DIRECT approval plus non-empty quoted instruction, not-applicable/0 PLAN and no paired spec. Only regular non-executable files qualify. Existing failures and hidden-worktree checks remain fail-closed. Approval of this checker implementation cannot use its own documentation exception.

#### Historical Work and Recovery Authority

HISTORICAL, not current completion: the original main worktree implemented the rule amendment and checker before a required L1 planning checkpoint. Its L0 work run 3333 remains unchanged. Prior results were 254/254 combined tests, then 184/184 plan-order tests after reader extraction, and independent review PASS. They do not prove this recovery tree or erase the ordering violation.

2026-09-05 owner instructions: "실행규칙 통합 승인함"; "검사 코드까지 영구 개정해". The owner also requested committing, integrating, pushing and merging into develop; the integration owner retains those operations and their ordinary checks.
After the explicit question about preserving this violation and recovering through a clean tree with a genuine planning checkpoint before reapplication, the owner answered "예외를 승인합니다". This is a one-time PROC-034 historical-order recovery exception, not permission to backdate evidence, disable hooks, waive verification, or grandfather future work.

The preserved patch is /tmp/proc034-approved-recovery.patch, SHA256 ec2c660c7377a15228e636b50fab953f2c9685532c17915e0650903be781044c. The reader is separately preserved at /tmp/proc034-documentation-batch-reader.mjs, SHA256 9efca54b4cb172eea5fd57e44db685a6358fed8466577ee70c580a41832e7901. Recovery run daa29363 was abandoned during planning when owner-rule alignment raised the complete scope to L2; current run 1ae1db70-30e0-4dfe-b2c0-93fdf22f61a7 records actual L2 recovery only. This plan precedes reapplication in this clean tree; it does not pretend to precede the historical implementation.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: internal harness consumers, not a product command family
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

Commit this genuine L2 planning pair after its actual gates and before reapplying the preserved implementation. Reuse one plan and one integrated correction/verification batch. Keep predicate ownership in plan-order-records.mjs, Git-object binding in documentation-batch-reader.mjs, and staged/history routing in scan-user-execution-plan-order.mjs. Keep the existing section reader and PLAN regex behavior when extracting readPlanSignal. The exception never becomes an L0 ancestor ground. Preserve original worktree/history and independently reviewed evidence; rerun current verification after reapplication.

Align the blanket initial-planning text in backlog-execution.md and the relevant gate-catalogue wording with a link to the narrow execution-cadence documentation exception. These owner-rule edits raise the complete batch to L2; they do not make product, executable, hook or CI changes eligible for the exception. Validate this owner routing as part of TC-01 and the final independent review, without adding another plan or delivery unit.

## Affected Files

- `scripts/harness/plan-order-records.mjs`
- `scripts/harness/documentation-batch-reader.mjs`
- `scripts/harness/scan-user-execution-plan-order.mjs`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
- `AGENTS.md`, approved execution-cadence rule and its rule/skill/agent consumers, recurrence ledger and Task README: exact preserved patch inventory above.
- `.agents/tasks/PROC-034-batch-execution-gates-at-work-unit-boundaries.md` and this paired spec.
- Additional approved consistency repairs: `.agents/rules/backlog-execution.md` and `.agents/specs/gate-catalogue.md`, limited to routing the documentation exception to its owner without weakening executable planning.
- No auto-lessons/weekly-digest churn, product source, hook, CI or manifest change belongs to this recovery.

## Completion Criteria

- [ ] TC-01: Reapply the approved cadence amendment as one coherent batch, preserving initial planning, final verification and independent review boundaries.
- [ ] TC-02: Accept an explicitly approved documentation-only Task/change atomic commit in staged and both history paths, without granting ancestor implementation authority.
- [ ] TC-03: Refuse missing approval, non-N/A evidence, ambiguous Tasks, paired specs, executable/symlink files, higher-lane paths, hidden residue and later unplanned product changes.
- [ ] TC-04: Run the complete plan-order and focused governance regression batch, preserve historical RED evidence, and verify syntax, formatting and unchanged file-size ceilings after reapplication.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                                        | Notes                                                                                   |
| ----- | ----------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| TC-01 | Unit        | Existing harness governance .test.mjs suites and independent diff review               | Preserve mandatory final gates; semantic cadence judgement belongs in one final review. |
| TC-02 | Integration | scripts/harness/**tests**/scan-user-execution-plan-order.test.mjs                      | Stage, commit and replay identical Git fixtures; include later valid checkpoint.        |
| TC-03 | Integration | scripts/harness/**tests**/scan-user-execution-plan-order.test.mjs                      | Negative mixed-scope/evidence/mode/residue cases and later unplanned implementation.    |
| TC-04 | Regression  | Existing plan-order .test.mjs suite, governance suites, Node syntax and file-size scan | Historical results remain historical; root runs current integrated verification.        |

## User Execution Test Scenarios

Not applicable.

**Reason:** Repository guidance and internal Git-order checks have no shipped product user surface; real Git fixture regression tests verify their process boundary.

## Tasks

- [ ] `.agents/tasks/PROC-034-batch-execution-gates-at-work-unit-boundaries.md` — created, prospective recovery work remains unchecked

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-09-05

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — All 4 checklist items are `[x]`: no `### Architecture Review Checklist` under `## Architecture Review`
  **Required action:** add the checklist
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: no checklist item mentioning "Sibling scan"
  **Required action:** add the Sibling scan item

**Judged at:** HEAD `73b53e35c3f1` · base `origin/develop@73b53e35c3f1` · document `.agents/spec-docs/draft/PROC-034-batch-execution-gates-at-work-unit-boundaries.md` blob `06c1d9758b26` (untracked)

### [GATE-WRITE] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → review-ready
**Ordering:** Entry gate, no predecessor; current draft path/status agree. Previous mechanical FAIL is preserved above. Current caller-supplied mechanical result is 20 PASS, 0 FAIL, 7 semantic pending; independent review resolves those seven here.

- GATE-WRITE — File begins with `---` YAML frontmatter block: PASS — YAML opening delimiter present.
- GATE-WRITE — `status: draft` present in frontmatter: PASS — Current frontmatter is draft.
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT · INFRA · PERF · SECURITY · OBSERVABILITY: PASS — RULE is allowed.
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): PASS — tags: [] present.
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): PASS — Problem names staged planning-order rejection of atomic documentation commit and repeated per-supplement workflow fragmentation.
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): PASS — Occurs when the approved documentation-only Task and rule changes are staged in one commit; prior main-tree implementation before checkpoint is separately named.
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: PASS — Problem has concrete multi-sentence description without banned placeholders.
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: PASS — Prior Art Research section exists.
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec — NOT third-party source code per `research.md`), OR explicitly states no comparable reference was found: PASS — N/A under the explicit bounded repository-specific research waiver, not a fabricated external source.
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare or missing section is FAIL: PASS — Waived line gives bounded recovery reason and excludes product/new architecture selection.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): PASS — Bounded waiver is consistent with reuse: Alternatives compare retained checkpoints against narrow atomic predicate; Decision preserves prior lane floor and Git/evidence constraints.
- GATE-WRITE — All 4 checklist items are `[x]`: PASS — All four Architecture Review Checklist boxes are checked.
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: PASS — Checked sibling scan expressly says N/A for internal harness consumers rather than product command family.
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: PASS — Two alternatives each have a pro and con.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — Decision chooses batching benefit while paying strict path, Git mode and evidence-validation cost; executable implementation cannot approve itself.
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interface surface, or reclassifies a layer / product-family boundary, the Sibling scan / Decision MUST (a) name the analogous existing layer it mirrors + its product-family classification, and (b) show reuse is at the shared contract/core level, not a dependency on a sibling PRODUCT. See `spec-workflow.md` "New-Surface Architecture Placement". (N/A only if no new surface/boundary is introduced.): PASS — N/A: internal reader extraction and existing consumer routing introduce no package/app/product or public interface/layer reclassification.
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: PASS — Four criteria are TC-01 through TC-04.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: PASS — TC-01 covers cadence and owner alignment; TC-02 acceptance and non-ancestor authority; TC-03 refusal counterpaths; TC-04 integrated verification and historical evidence preservation.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): PASS — Criteria command reapplication/verification and observable accept/refuse outcomes; test rows identify Git fixture execution at staged and both history paths.
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": PASS — No prohibited vague completion phrases in criteria.
- GATE-WRITE — `## Test Plan` section present: PASS — Test Plan exists.
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): PASS — Four Test Plan rows match four completion criteria.
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): PASS — Every row has Unit/Integration/Regression and named tool/approach.
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: PASS — N/A: no manual-tool row.
- GATE-WRITE — Tasks section present with placeholder: PASS — Tasks section names exact existing paired Task, unchecked.
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): PASS — Historical first-run mechanical FAIL is retained. This is a re-judgement, so prior nonempty evidence is required history, not a fresh empty-log failure.
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): PASS — No prohibited body Status or Classification heading.

**Scope and historical authority:** Both preserved input SHA256 values were verified and current worktree inventory contains only this spec and its paired Task. This PASS evaluates prospective clean-tree recovery; it does not backdate or erase historical implementation-before-planning. Task records exact author outcome `SCENARIO DRAFTED: not-applicable | 0` with internal process-boundary reason; no engineering test is claimed as product execution.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-05

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "검사 코드까지 영구 개정해"
**Given:** 2026-09-05, this conversation
**Review fingerprint:** 8bd617bbd0be (review 2230b639, type/tags a2fda961)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-05, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (8bd617bbd0be) equals the document's current fingerprint

**Judged at:** HEAD `73b53e35c3f1` · base `origin/develop@73b53e35c3f1` · document `.agents/spec-docs/backlog/PROC-034-batch-execution-gates-at-work-unit-boundaries.md` blob `974349ee44ec` (untracked)

**Independent semantic review:** GATE-APPROVAL, 2026-09-05. The actual mechanical result supplied by the orchestrator is 6 PASS, 0 FAIL, 3 pending. Prior GATE-WRITE PASS is present; current status is review-ready in backlog/. The existing DIRECT route, exact instruction, date and review fingerprint above are preserved, not reissued.

- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — The current conversation's "검사 코드까지 영구 개정해" extends the already-approved execution-cadence amendment to its checker. The paired plan identifies exactly that narrow documentation-atomic predicate, its staged/history consumers, and owner-rule alignment; the separate "예외를 승인합니다" authorizes clean-tree recovery while retaining the historical violation. This is current user authority applied to the same identified work, not approval inferred from another agent's recommendation.
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry argues for: PASS — N/A under DIRECT; no delegated class is claimed or created.
- GATE-APPROVAL — Independent architecture validation (conditional): PASS — N/A: the plan changes internal harness implementation/routing and governance, not a new package, app, product/interface surface or layer/product-family classification. The internal reader is not a new public contract.

**Historical-order disposition:** The pre-planning implementation on the original tree remains a recorded historical violation under the owner's one-time recovery exception. Current git status contains only the exact paired Task/spec, with no implementation reapplication yet. This approval authorizes prospective recovery; it does not claim that an earlier gate occurred, erase prior FAIL evidence, or waive final verification.
**Guardian verdict:** PASS — DIRECT approval is specifically directed at the prospective PROC-034 recovery design; all three semantic conditions are satisfied or explicitly inapplicable.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-05

**Status upgrade:** approved → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "검사 코드까지 영구 개정해"
**Given:** 2026-09-05, this conversation
**Review fingerprint:** a0777eefcd20 (review 80474830, type/tags a2fda961)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-05, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (a0777eefcd20) equals the document's current fingerprint

**Judged at:** HEAD `73b53e35c3f1` · base `origin/develop@73b53e35c3f1` · document `.agents/spec-docs/todo/PROC-034-batch-execution-gates-at-work-unit-boundaries.md` blob `97e5604713a6` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-05

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-05; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/PROC-034-batch-execution-gates-at-work-unit-boundaries.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/PROC-034-batch-execution-gates-at-work-unit-boundaries.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (4)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 374 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/PROC-034-batch-execution-gates-at-work-unit-boundaries.md",
  "specPath": ".agents/spec-docs/todo/PROC-034-batch-execution-gates-at-work-unit-boundaries.md",
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
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/PROC-034-batch-execution-gates-at-work-unit-boundaries.md",
    ".agents/tasks/PROC-034-batch-execution-gates-at-work-unit-boundaries.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged at:** HEAD `73b53e35c3f1` · base `origin/develop@73b53e35c3f1` · document `.agents/spec-docs/todo/PROC-034-batch-execution-gates-at-work-unit-boundaries.md` blob `1a4f8e0867c3` (untracked)
