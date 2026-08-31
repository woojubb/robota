---
status: in-progress
type: RULE
tags: [workflow, harness]
lane: L2
---

# PROC-025: Record AGREEMENT-006 continuation contract before B2 apply

## Problem

On a fresh branch based on PR #2560 merge `3ca5ab0cc5ab550d80ae3b3e3ae08af657d0bb0f`,
GATE-IMPLEMENT (continuation) for AGREEMENT-006 fails before any B2 GitHub mutation. The integrated
AGREEMENT Decision sequences a later evidence batch but does not contain the machine-readable
`Continuation artifacts` declaration that binds that batch, and the paired Task remains `status: todo`
while the spec is already `status: in-progress`. Staging the B2 manifest consequently makes
`scan-user-execution-plan-order` refuse the branch because it has no valid continuation checkpoint.

Reproduction: cut a branch at the PR #2560 merge, append the guardian's continuation entry, stage the
B2 manifest, and run the staged plan-order scan. The guardian reports the missing declaration; the scan
reports that the paired Task is not `in-progress` and refuses the manifest as implementation without a
planning-checkpoint ancestor. No Issue body, Task marker, label, dependency, relationship, or state has
been mutated.

no-issue: repository-internal planning-order correction discovered while executing the already-approved
AGREEMENT-006 migration; it introduces no new external problem or execution owner.

## Prior Art Research

Waived: The repository's continuation guardian, checkpoint-evidence contract, failed staged scan, and
the completed PROC-023/PROC-024 correction records are the complete local authority for this
planning-order defect; no external product behavior is involved.

## Architecture Review

### Affected Scope

- `.agents/spec-docs/active/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md`
  — preserve the failed verdict and add the exact six continuation artifact paths.
- `.agents/tasks/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md`
  — align the Task lifecycle with its already-active paired spec.
- This PROC-025 Task/spec pair and its gate/loop evidence.
- No package, app, source, workflow implementation, label registry, or live GitHub Issue state.

### Alternatives Considered

1. Add the declaration and Task status directly to the failed B2 apply branch.
   - Pro: avoids an extra PR.
   - Con: the declaration would be retrospective rather than present in the immutable continuation base;
     the guardian and staged plan-order scan reject that ordering.
2. Land a separate governed correction, then re-cut B2 apply from the new `develop` merge.
   - Pro: preserves the failed evidence, makes both lifecycle facts part of the later immutable base, and
     keeps the continuation contract falsifiable.
   - Con: requires one planning-only PR and post-merge cycle.
3. Relax the continuation guardian or plan-order scanner for this AGREEMENT.
   - Pro: would admit the current branch.
   - Con: weakens repository-wide temporal authorization to accommodate one malformed planning record and
     would permit retrospective plans elsewhere.

### Decision

Choose alternative 2. The correction is the smallest change that fixes both measured base facts without
weakening a gate: add the exact six-path declaration, move only the paired AGREEMENT Task from `todo` to
`in-progress`, and preserve every prior PASS byte plus the new FAIL evidence. After the correction merge
is independently verified, discard the old apply branch, cut a fresh apply branch from the new
`origin/develop`, and run GATE-IMPLEMENT (continuation) before restoring any manifest authorization.

> **Contained — PROC-026.** This document-specific correction is required to repair the already-merged
> AGREEMENT-006 base. The first-checkpoint producer's missing continuation-readiness contract is tracked
> separately by [issue #2561](https://github.com/woojubb/robota/issues/2561); PROC-025 does not change that
> producer or claim the recurring cause is fixed.

The six paths are the durable manifest, AGREEMENT-006 Task/spec, and DATA-008/DATA-009/ARCH-116 Tasks.
The change does not authorize Issue mutation by itself, alter the approved Task topology, change product
placement, or claim any child implementation delivered.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — repository governance records only; no package layer changes.
- [x] Sibling scan 완료 — PROC-023 and PROC-024 were inspected as the two direct continuation-correction precedents.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: N/A — no package, app, interface, presentation surface, or layer reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. Land PROC-025's own planning checkpoint without modifying AGREEMENT-006.
2. Add the exact `Continuation artifacts` declaration under AGREEMENT-006 `### Decision`, preserve the
   guardian's recorded FAIL entry, and set only the paired AGREEMENT-006 Task to `in-progress`.
3. Verify the six exact paths, unchanged prior PASS evidence, Task/spec lifecycle agreement, topic
   ordering, affected scans, and absence of live GitHub mutation.
4. Complete and merge PROC-025, independently verify the merge, then re-cut B2 apply from fresh
   `origin/develop` and rerun the continuation guardian.

## Affected Files

- `.agents/spec-docs/active/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md`
- `.agents/tasks/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md`
- `.agents/spec-docs/draft/PROC-025-record-agreement-006-continuation-contract-before-b2-apply.md`
- `.agents/tasks/PROC-025-record-agreement-006-continuation-contract-before-b2-apply.md`
- `.agents/loop-runs/user-request-gate.jsonl`

## Completion Criteria

- [ ] TC-01: AGREEMENT-006's Decision contains exactly one machine-readable declaration of the manifest,
      paired Task/spec, and three child Task paths, and the checkpoint-evidence parser returns those six
      paths with no missing or extra entry.
- [ ] TC-02: AGREEMENT-006's Task/spec pair both read `status: in-progress`, every pre-existing
      GATE-IMPLEMENT PASS byte remains unchanged, and the 2026-08-31 continuation FAIL remains recorded.
- [ ] TC-03: the correction topic passes staged/history plan-order and affected harness scans while live
      issues #2079/#2070/#2085/#2104/#2118 retain their pre-correction bodies, labels, relationships,
      dependencies, markers, and states.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                                       | Notes                                   |
| ----- | ----------- | ------------------------------------------------------------------------------------- | --------------------------------------- |
| TC-01 | Unit        | checkpoint-evidence contract parser plus exact six-path assertion                     | No package build required.              |
| TC-02 | Lifecycle   | Task/spec frontmatter read plus raw PASS digest/prefix comparison                     | Preserve the guardian FAIL as evidence. |
| TC-03 | Integration | staged/history plan-order, affected scans, and authenticated read-only Issue snapshot | No GitHub write is permitted.           |

## Tasks

- [ ] `.agents/tasks/PROC-025-record-agreement-006-continuation-contract-before-b2-apply.md` — approved planning-order correction pending implementation checkpoint

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable because PROC-025 changes only repository governance records: the AGREEMENT-006
continuation declaration, paired Task lifecycle alignment, and preserved gate evidence. It performs no
live GitHub mutation and delivers no runnable Robota CLI, TUI/browser, public SDK, product-output, or
product-state behavior. Parser, plan-order, lifecycle, evidence-preservation, and read-only Issue checks
remain engineering verification in the Test Plan.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-31

**Status upgrade:** draft → review-ready

- GATE-WRITE — Ordering check: PASS — GATE-WRITE is the entry gate, so no prior gate is required; the document declares `status: draft` and is in `.agents/spec-docs/draft/`.
- GATE-WRITE — File begins with YAML frontmatter: PASS — the file begins with a delimited `---` YAML frontmatter block.
- GATE-WRITE — `status: draft` present in frontmatter: PASS — the frontmatter declares `status: draft`.
- GATE-WRITE — `type:` is one of the permitted values: PASS — `type: RULE` is one of the 11 permitted values.
- GATE-WRITE — `tags:` field present in frontmatter: PASS — `tags: [workflow, harness]` is present.
- GATE-WRITE — Contains a concrete symptom: PASS — on a fresh branch at merge `3ca5ab0cc5ab550d80ae3b3e3ae08af657d0bb0f`, the continuation guardian reports a missing machine-readable `Continuation artifacts` declaration and the staged plan-order scan refuses the B2 manifest because the paired Task remains `todo` while its spec is `in-progress`.
- GATE-WRITE — Contains a reproduction condition: PASS — the Problem gives the exact base, directs the reader to append the guardian continuation entry and stage the B2 manifest, and names the staged plan-order scan whose refusal reproduces the defect before any Issue mutation.
- GATE-WRITE — Problem contains no TBD, TODO, or vague single-sentence description: PASS — the Problem is multi-paragraph, names exact states, commands/operations, revision, and observed refusals, and contains no unresolved `TBD` or `TODO` placeholder.
- GATE-WRITE — Prior Art Research section present: PASS — `## Prior Art Research` is present.
- GATE-WRITE — Prior Art Research is substantiated or explicitly waived: PASS — the section explicitly waives external product research because the repository continuation guardian, checkpoint-evidence contract, failed staged scan, and completed PROC-023/PROC-024 correction records are the applicable local authorities.
- GATE-WRITE — Explicit `Waived: <reason>` line present: PASS — the section begins with an explicit `Waived:` reason tied to this repository-internal planning-order correction.
- GATE-WRITE — Research findings feed Alternatives Considered and Decision: PASS — the identified guardian/checkpoint contract and prior correction records drive the comparison between retrospective editing, a separately landed immutable-base correction, and weakening the gate; the Decision selects the separate correction because only it preserves temporal authorization.
- GATE-WRITE — All Architecture Review checklist items are checked: PASS — all five displayed checklist items, including the four required architecture items, are checked.
- GATE-WRITE — Sibling scan is checked with evidence or explicit N/A: PASS — the checked sibling item names PROC-023 and PROC-024 as the two direct continuation-correction precedents inspected.
- GATE-WRITE — Alternatives Considered has at least two entries with pro and con: PASS — three alternatives are present and each records an explicit pro and con.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — the Decision accepts one extra planning-only PR and post-merge verification to make the lifecycle and declaration facts part of the immutable continuation base, instead of admitting retrospective authorization or weakening repository-wide gates.
- GATE-WRITE — New-surface placement conditional: PASS (N/A) — the correction changes repository governance records only and introduces no package, app, presentation/interface surface, or layer/product-family reclassification.
- GATE-WRITE — Every Completion Criterion has a TC-N prefix: PASS — all three criteria are prefixed `TC-01` through `TC-03`.
- GATE-WRITE — At least one criterion per distinct feature or sub-item: PASS — TC-01 covers the exact continuation declaration/parser result, TC-02 covers Task/spec lifecycle plus preserved PASS/FAIL evidence, and TC-03 covers plan-order/scans plus unchanged live GitHub state.
- GATE-WRITE — Each criterion uses Command or Observable behavior form: PASS — every criterion names inspectable paths, parser output, frontmatter states, byte-preservation evidence, scan results, or authenticated live Issue fields.
- GATE-WRITE — No banned vague Completion Criteria phrase: PASS — none uses `works correctly`, `no errors`, `implemented`, or `displays correctly`.
- GATE-WRITE — Test Plan section present: PASS — `## Test Plan` is present.
- GATE-WRITE — One Test Plan row exists for each TC-N: PASS — three rows correspond one-to-one with TC-01 through TC-03.
- GATE-WRITE — Each Test Plan row has non-empty Test Type and Tool or Approach: PASS — every row has a non-empty Test Type and Tool/Approach and none contains `TBD`.
- GATE-WRITE — Manual rows explain why automation is not possible: PASS (N/A) — no row uses `manual` as its tool, so no manual-only Notes justification is required.
- GATE-WRITE — Tasks section present with placeholder: PASS — `## Tasks` contains the exact future PROC-025 Task path and states that it is not yet created pending GATE-APPROVAL.
- GATE-WRITE — Evidence Log section present and initially empty: PASS — this is the first GATE-WRITE run and the section was empty before this entry.
- GATE-WRITE — No body Status or Classification sections: PASS — there is no body-level `## Status` or `## Classification` section.
- GATE-WRITE — Completion Criteria and Test Plan counts match: PASS — Completion Criteria count `3` matches Test Plan row count `3`.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-31

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "타당한 근거와 함께 추천안을 제시하면 타당할 경우 승인하겠다. 지금부터 goal을 달성할 때까지 모두 동일한 기준으로 처리한다"
**Given:** 2026-08-31, this conversation
**Review fingerprint:** 38d11d6fb105 (review c60e35c9, type/tags 42a75dd9)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-31, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (38d11d6fb105) equals the document's current fingerprint

### [GATE-APPROVAL] — ❌ FAIL | 2026-08-31

**Status remains:** review-ready
**Failed criteria:**

- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: the
  quoted instruction conditionally authorizes recommendations "from now until the goal is achieved";
  it does not name or directly confirm PROC-025 and is therefore standing authorization rather than
  Route DIRECT approval of this particular spec. `backlog-execution.md` explicitly states that standing
  authorization to keep working is not, on its own, approval of any particular spec, and PROC-025 does
  not invoke a registered Route CLASS.
  **Required action:** obtain direct, unambiguous user approval naming this PROC-025 recommendation, or
  use a pre-registered delegated class whose scope and measured evidence condition cover the item,
  before re-running GATE-APPROVAL.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-31

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인함."
**Given:** 2026-08-31, this conversation
**Review fingerprint:** 38d11d6fb105 (review c60e35c9, type/tags 42a75dd9)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-31, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (38d11d6fb105) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — `승인함.` was the user's immediate reply to the explicit request `PROC-025 교정안을 승인한다.`, so the short confirmation directly approves this named spec rather than a different item or a standing class.
- GATE-APPROVAL — The item is inside the class as the registry defines it: PASS (N/A) — route `DIRECT` is selected and no delegated class is invoked.
- GATE-APPROVAL — Independent architecture validation (conditional): PASS (N/A) — PROC-025 changes repository governance records only and introduces no package, app, interface or presentation surface, or layer/product-family reclassification.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-31

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-31; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/PROC-025-record-agreement-006-continuation-contract-before-b2-apply.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/PROC-025-record-agreement-006-continuation-contract-before-b2-apply.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (3)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 531 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 5 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/PROC-025-record-agreement-006-continuation-contract-before-b2-apply.md",
  "specPath": ".agents/spec-docs/todo/PROC-025-record-agreement-006-continuation-contract-before-b2-apply.md",
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
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/loop-runs/backlog-execution-orchestrator.jsonl",
    ".agents/loop-runs/user-execution-scenario.jsonl",
    ".agents/loop-runs/user-request-gate.jsonl",
    ".agents/spec-docs/todo/PROC-025-record-agreement-006-continuation-contract-before-b2-apply.md",
    ".agents/tasks/PROC-025-record-agreement-006-continuation-contract-before-b2-apply.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->
