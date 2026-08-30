---
status: in-progress
type: RULE
tags: [workflow, harness]
lane: L2
---

# PROC-023: Record continuation artifact declaration before the B1 gate

Paired with `.agents/tasks/PROC-023-record-continuation-artifact-declaration-before-the-b1-gate.md`. Arising from [issue #2063](https://github.com/woojubb/robota/issues/2063).

## Problem

On a fresh branch whose base contains PR #2551 merge commit
`06f4f0bd4671366bd4212b7a3e6102986d4ba635`, GATE-IMPLEMENT (continuation) for AGREEMENT-005 returns
FAIL even though the prerequisite manifest and all four Tasks are readable on `develop`. The guardian
found that the base version of the active spec has no machine-readable `**Continuation artifacts:**`
line. Adding that line in the same continuation checkpoint is too late: the plan-order contract binds
`sequencedArtifacts` to the parent/base spec and rejects the staged transition with `parent raw PASS
entries must remain byte-identical in exact prefix order before exactly one appended entry`.

Reproduction: cut a branch from `06f4f0bd...`, add the six-artifact declaration to AGREEMENT-005, append
a continuation PASS, and run `node scripts/harness/scan-user-execution-plan-order.mjs --staged`; the
guardian and scanner refuse because the declaration was absent from the branch base. No implementation or
GitHub Issue mutation has occurred.

## Prior Art Research

Waived: This is a repository-local checkpoint-order correction whose governing gate contract, failed guardian evidence, and staged scanner output are the complete authority; no external product behavior is involved.

## Architecture Review

### Affected Scope

- `.agents/spec-docs/active/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md`
  — add only the six prerequisite artifact identities and preserve the recorded FAIL evidence.
- This PROC-023 Task/spec pair and its gate/loop evidence.
- No package, app, source, workflow, gate implementation, or GitHub Issue state.

### Alternatives Considered

1. Rewrite or combine the declaration with AGREEMENT-005's failed continuation checkpoint.
   - Pro: Fewer commits and no additional Task/spec pair.
   - Con: Fails the parent-spec time binding and would make approval retrospective; rejected.
2. Land the declaration through a separate governed work unit, then retry from fresh `develop`.
   - Pro: Preserves the failed verdict, gives the correction its own checkpoint, and makes the declaration
     part of the later continuation branch's immutable base.
   - Con: Requires one small prerequisite PR and post-merge cycle.
3. Modify the gate or scanner to admit a same-checkpoint declaration.
   - Pro: Avoids a prerequisite PR for future cases.
   - Con: Changes repository-wide gate authority to solve one missing planning line and weakens temporal
     ordering; rejected.

### Decision

Choose alternative 2. The extra planning PR is cheaper than weakening or bypassing the checkpoint's
temporal guarantee. The correction is exactly one semantic declaration in AGREEMENT-005 plus this
governed record; it does not authorize B1 mutation. After it lands, the B1 apply branch must be cut from
that merge, re-run the guardian, and receive a new PASS before changing the manifest or GitHub.

The exact declaration names the six blobs independently verified on `develop`: the durable manifest,
AGREEMENT-005 Task/spec, and ARCH-113/114/115 Tasks. Existing GATE-IMPLEMENT PASS bytes remain unchanged.
An adversarial check keeps three failures visible: a missing/extra artifact, a same-commit retrospective
declaration, or any package/GitHub mutation blocks completion.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: This is a repository-local checkpoint-order correction whose governing gate contract, failed guardian evidence, and staged scanner output are the complete authority; no external product behavior is involved.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. Commit PROC-023's approved planning checkpoint without modifying AGREEMENT-005.
2. Add the exact `**Continuation artifacts:**` line under AGREEMENT-005 `### Decision` and restore the
   guardian's recorded FAIL entry without changing any prior PASS bytes.
3. Verify the exact six paths, topic ordering, affected scans, and absence of product/GitHub mutation.
4. Complete PROC-023, merge the correction PR, independently verify it, then cut a fresh B1 apply branch.

## Affected Files

- `.agents/spec-docs/active/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md`
- `.agents/spec-docs/draft/PROC-023-record-continuation-artifact-declaration-before-the-b1-gate.md`
- `.agents/tasks/PROC-023-record-continuation-artifact-declaration-before-the-b1-gate.md`
- `.agents/loop-runs/user-request-gate.jsonl`

## Completion Criteria

- [ ] TC-01: the checkpoint-evidence parser reads exactly six ordered continuation artifacts from the
      AGREEMENT-005 Decision, and the prior raw GATE-IMPLEMENT PASS digest is unchanged from
      `06f4f0bd4671366bd4212b7a3e6102986d4ba635`.
- [ ] TC-02: `node scripts/harness/scan-user-execution-plan-order.mjs` and its staged form both exit 0
      with PROC-023's checkpoint preceding the AGREEMENT-005 correction.
- [ ] TC-03: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
      exits 0, and `git diff --name-only origin/develop...HEAD` contains no package/app/source path.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                                | Notes                                       |
| ----- | --------- | ------------------------------------------------------------------------------ | ------------------------------------------- |
| TC-01 | Contract  | checkpoint-evidence helper + SHA-256 comparison                                | Exact set and immutable prior PASS bytes    |
| TC-02 | Harness   | `scan-user-execution-plan-order.mjs` history and `--staged` modes              | Proves causal order, not only final content |
| TC-03 | Suite     | `run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` | Also inspect changed-path scope             |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/PROC-023-record-continuation-artifact-declaration-before-the-b1-gate.md` — todo

## Approval Recommendation

Approve this bounded planning correction only. The recommendation is justified because the independent
guardian recorded one exact FAIL, the staged scanner independently reproduced the same time-binding
failure, and alternative 2 is the only route that preserves both records without changing gate semantics.
Approval does not authorize any GitHub Issue mutation or product/runtime change.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-30

**Status upgrade:** draft → review-ready

- GATE-WRITE — File begins with `---` YAML frontmatter block: the file begins with a complete `---` YAML frontmatter block.
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft` is present.
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: `type: RULE` is one of the 11 allowed values.
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags: [workflow, harness]` is present with two values.
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): GATE-IMPLEMENT (continuation) returns FAIL because the base spec lacks a machine-readable `**Continuation artifacts:**` line, and the exact parent-prefix rejection is recorded.
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): the Problem names base commit `06f4f0bd...`, the staged declaration/PASS setup, and the exact `scan-user-execution-plan-order.mjs --staged` command.
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: the Problem contains neither placeholder and gives a concrete multi-sentence account.
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` is present.
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec — NOT third-party source code per `research.md`), OR explicitly states no comparable reference was found: the section uses the permitted explicit waiver route for a repository-local checkpoint-order contract.
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare or missing section is FAIL: `Waived:` identifies the gate contract, failed guardian evidence, and staged scanner output as the complete relevant authority.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): the alternatives compare same-checkpoint editing, a separate governed work unit, and changing gate semantics against the documented time-binding failure.
- GATE-WRITE — All 4 checklist items are `[x]`: all 5 displayed Architecture Review Checklist items are `[x]`.
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: the checked item records an explicit repository-local `N/A` reason.
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: three alternatives each state both a Pro and a Con.
- GATE-WRITE — Decision references the trade-off that drove the choice: the Decision accepts one extra planning PR to preserve temporal ordering rather than weakening or bypassing the checkpoint guarantee.
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interface surface, or reclassifies a layer / product-family boundary, the Sibling scan / Decision MUST name the analogous existing layer and show shared contract/core reuse: N/A — the scope adds no package, app, presentation/interface surface, layer, or product-family boundary.
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: all 3 criteria use `TC-NN` identifiers.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: TC-01 covers declaration/digest integrity, TC-02 covers causal ordering, and TC-03 covers affected-scan and changed-path isolation.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): TC-01 specifies parser output and digest equality; TC-02 and TC-03 specify command exit status and diff contents.
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of the four prohibited phrases appears in Completion Criteria.
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` is present.
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 3 Test Plan rows match the 3 Completion Criteria identifiers.
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): all 3 rows have a non-empty Test Type and Tool / Approach with no `TBD`.
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: there are 0 manual rows, so the conditional requirement is satisfied.
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` contains the paired Task placeholder.
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): the section was empty before this first GATE-WRITE entry.
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): neither body section is present.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-30

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "너가 타당한 근거와 함께 추천안을 제안하면 그게 타당할 경우 승인한다."
**Given:** 2026-08-30, this conversation
**Review fingerprint:** ee2cfd9ee218 (review dfbf5ac6, type/tags 42a75dd9)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-30, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (ee2cfd9ee218) equals the document's current fingerprint

### [GATE-APPROVAL] — ❌ FAIL | 2026-08-30

**Status remains:** review-ready
**Failed criteria:**

- Route DIRECT — Approval is a direct, unambiguous statement directed at this spec document: the quoted instruction is a conditional standing authorization given before this newly discovered PROC-023 work unit was presented; it does not name or directly confirm PROC-023, and approval of a different item in the same conversation cannot approve this document.
  **Required action:** Present PROC-023's bounded recommendation to the user and record an explicit approval directed at this document before re-running GATE-APPROVAL.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-30

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "PROC-023-record-continuation-artifact-declaration-before-the-b1-gate를 승인하고, 실패한 GATE-APPROVAL의 재실행을 허용합니다."
**Given:** 2026-08-30, this conversation
**Review fingerprint:** ee2cfd9ee218 (review dfbf5ac6, type/tags 42a75dd9)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-30, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (ee2cfd9ee218) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: the instruction names the complete `PROC-023-record-continuation-artifact-declaration-before-the-b1-gate` identifier, explicitly says it is approved, and authorizes this failed gate's rerun.
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A — this run uses Route DIRECT and claims no delegated class.
- GATE-APPROVAL — Independent architecture validation (conditional): N/A — the Decision and Affected Scope add only planning-document evidence and explicitly introduce no package, app, presentation/interface surface, layer, or product-family reclassification.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-30

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-30; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/PROC-023-record-continuation-artifact-declaration-before-the-b1-gate.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/PROC-023-record-continuation-artifact-declaration-before-the-b1-gate.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (3)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 325 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 3 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/PROC-023-record-continuation-artifact-declaration-before-the-b1-gate.md",
  "specPath": ".agents/spec-docs/todo/PROC-023-record-continuation-artifact-declaration-before-the-b1-gate.md",
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
    ".agents/loop-runs/user-request-gate.jsonl",
    ".agents/spec-docs/todo/PROC-023-record-continuation-artifact-declaration-before-the-b1-gate.md",
    ".agents/tasks/PROC-023-record-continuation-artifact-declaration-before-the-b1-gate.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->
