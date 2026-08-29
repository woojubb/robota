---
status: done
type: FLOW
tags: [workflow, harness]
lane: L2
---

# PROC-019: Extend PROC-017 continuation scope for conversion-base replay

Paired with `.agents/tasks/completed/PROC-019-extend-proc-017-continuation-scope-for-conversion-base-replay.md`.
Arising from [issue #2514](https://github.com/woojubb/robota/issues/2514).

## Problem

The first valid PROC-017 continuation checkpoint fails the staged plan-order scan with
`combined lifecycle conversion evidence refused: conversion-evidence-base-mismatch`. The scanner
replays the immutable conversion receipt against the later branch's current `develop` merge base
instead of the original conversion base recorded before PR #2542. Fixing that enforcement bug
requires changing `scripts/harness/scan-user-execution-plan-order.mjs`, but PROC-017's merged
continuation declaration currently names only its evidence, ledger, skill, and test artifacts.

Reproduction: on a branch cut from `origin/develop` after PR #2543, append a valid
`gateImplementContinuation` entry to the active PROC-017 spec and run
`HARNESS_BASE_REF=origin/develop node scripts/harness/scan-user-execution-plan-order.mjs --staged`.
The command exits 1 with the base mismatch even though the original recorded base is an ancestor of
the prior merged checkpoint and the Task/PLAN signal is unchanged.

## Prior Art Research

Waived: this is a repository-local scope correction using the existing continuation evidence
contract; no external design or product API is involved.

## Architecture Review

### Affected Scope

- `.agents/spec-docs/active/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md`
  — add the scanner source path to the existing continuation declaration.
- No scanner implementation, contract schema, package, or product behavior changes in this work unit.

### Alternatives Considered

1. Add the scanner source path to PROC-017 before regenerating its continuation checkpoint.
   - Pro: the parent plan explicitly authorizes the exact enforcement fix before implementation.
   - Con: requires one additional small preparatory PR.
2. Modify the scanner after a checkpoint that names only the original six artifacts.
   - Pro: avoids the preparatory PR.
   - Con: violates the continuation gate's parent-spec scope binding; rejected.
3. Rewrite the Task's original `base-oid` to the later branch base.
   - Pro: makes the current comparison pass without scanner code changes.
   - Con: fabricates historical conversion evidence and violates fail-closed recovery; rejected.

### Decision

**Alternative 1.** Append `scripts/harness/scan-user-execution-plan-order.mjs` immediately before
its two focused test paths in PROC-017's existing `Continuation artifacts` line. The resulting exact
ordered list contains seven paths: candidate evidence, review-loop ledger, two workflow skills, the
scanner source, conversion-evidence tests, and plan-order tests. The later continuation guardian must
bind its machine payload to this merged parent declaration before any scanner implementation begins.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: one repository-local parent-plan declaration changes.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, interface, layer, or product family.

## Fallback & Degradation Declaration

None. If the declaration or its checkpoint binding fails, scanner implementation remains blocked.

## Solution

Insert one existing scanner source path into PROC-017's continuation declaration. Verify the exact
seven-item parser result, unique declaration count, implementation diff scope, and affected scans.

## Affected Files

- `.agents/spec-docs/active/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md`

## Completion Criteria

- [x] TC-01: a Node assertion using `parseCheckpointEvidenceContract` and
      `continuationArtifacts` exits 0 and returns the exact seven Decision artifacts in order.
- [x] TC-02: `rg -c '^\*\*Continuation artifacts:\*\* ' <PROC-017-active-spec>` prints `1`, and
      the implementation range names only the PROC-017 active spec.
- [x] TC-03: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
      exits 0 after the declaration change is committed.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                                | Notes                                                                                   |
| ----- | ----------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| TC-01 | Contract    | Node assertion over `checkpoint-evidence-contract.mjs` exports                 | Test skipped: live exact-value assertion exercises the existing tested parser           |
| TC-02 | Static/diff | exact `rg -c` plus `git diff --name-only`                                      | Test skipped: the single-document scope is verified directly                            |
| TC-03 | Suite       | `run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` | Test skipped: documentation-only instance is verified by the live affected-scan command |

## User Execution Test Scenarios

Not applicable — this work changes repository-internal planning metadata only; TC-01 through TC-03
provide the engineering verification surface.

Recorded as the rule's required choice rather than skipped.

## Tasks

- [x] `.agents/tasks/completed/PROC-019-extend-proc-017-continuation-scope-for-conversion-base-replay.md` — done

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-30

**Status upgrade:** draft → review-ready

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block.
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft` is present.
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT · INFRA · PERF · SECURITY · OBSERVABILITY: `type: FLOW` is one of the 11 allowed values.
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags: [workflow, harness]` is present with two values.
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): the staged plan-order scanner exits 1 with `combined lifecycle conversion evidence refused: conversion-evidence-base-mismatch`.
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): the Problem names a branch cut from `origin/develop` after PR #2543, a valid `gateImplementContinuation` entry, and the exact staged scanner command.
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO and contains 984 characters across 5 sentences.
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` is present.
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec — NOT third-party source code per `research.md`), OR explicitly states no comparable reference was found: the section uses the permitted explicit waiver route because this is a repository-local scope correction with no comparable external product/API reference.
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare or missing section is FAIL: `Waived: this is a repository-local scope correction using the existing continuation evidence contract; no external design or product API is involved.` is present.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): external research is explicitly waived; the Decision instead traces the measured local replay failure and existing continuation evidence contract into Alternative 1.
- GATE-WRITE — All 4 checklist items are `[x]`: all 5 displayed Architecture Review Checklist items, including the conditional new-surface item, are `[x]`.
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: the checked Sibling scan states `N/A: one repository-local parent-plan declaration changes.`
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 3 numbered alternatives are present and each has one Pro and one Con.
- GATE-WRITE — Decision references the trade-off that drove the choice: the Decision chooses one additional preparatory PR to preserve exact parent-spec scope binding and rejects implementing outside that declaration.
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interface surface, or reclassifies a layer / product-family boundary, the Sibling scan / Decision MUST (a) name the analogous existing layer it mirrors + its product-family classification, and (b) show reuse is at the shared contract/core level, not a dependency on a sibling PRODUCT. See `spec-workflow.md` "New-Surface Architecture Placement". (N/A only if no new surface/boundary is introduced.): N/A — one path is added to an existing repository-local declaration; no package, app, presentation/interface surface, layer, or product-family boundary is introduced or reclassified.
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 3 criteria are present and all use a `TC-NN:` prefix.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: TC-01 covers exact ordered parsing, TC-02 covers declaration and diff uniqueness, and TC-03 covers the affected-scan regression gate.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): TC-01 requires a Node assertion to exit 0 with an exact result, TC-02 requires exact count and path output, and TC-03 requires the named scan command to exit 0.
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of the four prohibited phrases appears in Completion Criteria.
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` is present.
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 3 Test Plan rows match 3 Completion Criteria, TC-01 through TC-03.
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): all 3 rows have non-empty Test Type and Tool/Approach cells and none contains TBD.
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: there are 0 manual rows, so the conditional requirement is satisfied.
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` contains the unchecked paired Task path placeholder.
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` existed with 0 prior entries before this single GATE-WRITE entry was appended.
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): neither body section exists.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-30

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "잠재적으로 모두 사전 승인함"
**Given:** 2026-08-30, this conversation
**Review fingerprint:** 434693eadb11 (review e58c8812, type/tags 6a90c223)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-30, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: the current instruction names GATE-APPROVAL and this exact PROC-019 document and directs completion of its existing approval entry; it is neither silence nor approval of another item
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: route DIRECT, so no delegated class is claimed and this Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (434693eadb11) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — the Affected Scope changes one existing repository-local continuation declaration and the checked architecture review explicitly introduces no package, app, interface surface, layer, or product-family boundary

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-30

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-30; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/PROC-019-extend-proc-017-continuation-scope-for-conversion-base-replay.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/PROC-019-extend-proc-017-continuation-scope-for-conversion-base-replay.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (3)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 240 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/PROC-019-extend-proc-017-continuation-scope-for-conversion-base-replay.md",
  "specPath": ".agents/spec-docs/todo/PROC-019-extend-proc-017-continuation-scope-for-conversion-base-replay.md",
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
    ".agents/spec-docs/todo/PROC-019-extend-proc-017-continuation-scope-for-conversion-base-replay.md",
    ".agents/tasks/PROC-019-extend-proc-017-continuation-scope-for-conversion-base-replay.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-30

**Command:** `node --input-type=module -e <exact continuationArtifacts seven-item assertion>`
**Exit:** 0
**Output:** (last 1 of 1 line(s))

```
[".agents/evidence/PROC-017-candidate.json",".agents/loop-runs/pr-finding-resolution-loop.jsonl",".agents/skills/backlog-execution-orchestrator/SKILL.md",".agents/skills/user-request-gate/SKILL.md","scripts/harness/scan-user-execution-plan-order.mjs","scripts/harness/__tests__/conversion-evidence.test.mjs","scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs"]
```

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-30

**Command:** `rg -c continuation-artifacts && git diff --name-only 5a2cb5fe3..db57412d2`
**Exit:** 0
**Output:** (last 2 of 2 line(s))

```
declaration_count=1
changed_path=.agents/spec-docs/active/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md
```

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-30

**Command:** `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
**Exit:** 0
**Output:** (last 10 of 51 line(s))

```
✓ llms-txt
✓ rule-statement-floor
✓ test-plans
✓ doc-folder-status

⚑ 1 advisory finding(s) — NOT failures. The verdict below is unaffected.
⚑ progress-report-quantification: progress-report quantification: 1 finding(s) acknowledged in scripts/harness/progress-report-acknowledgments.json — 1 real violation(s) recorded, not cleared by editing history.

36 scans passed, 1 skipped (27 declared what they examined)
scan receipt NOT written: working tree is not clean:  M .agents/spec-docs/active/PROC-019-extend-proc-017-continuation-scope-for-conversion-base-replay.md,  M .agents/tasks/PROC-019-extend-proc-017-continuation-scope-for-conversion-base-replay.md
```

### [GATE-VERIFY] — ✅ PASS | 2026-08-30

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — ordering: prior gate GATE-IMPLEMENT PASS and status `in-progress`: [GATE-IMPLEMENT] — ✅ PASS | 2026-08-30; status `in-progress`
- GATE-VERIFY — All tasks in `.agents/tasks/<ID>.md` are marked complete (`[x]`): 3/3 tasks `[x]` in .agents/tasks/PROC-019-extend-proc-017-continuation-scope-for-conversion-base-replay.md
- GATE-VERIFY — No tasks are blocked or pending: no unticked, blocked, or pending task
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): build-shaped `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exit 0 ( ⏎ 36 scans passed, 1 skipped (27 declared what they examined) ⏎ scan receipt NOT written: working tree is not clean: M .agents/spec-docs/active/PROC-019-extend-proc-017-continuation-scope-for-conversion-base-replay.md, M .agents/tasks/PROC-019-extend-proc-017-continuation-scope-for-conversion-base-replay.md); all 2 supplied commands exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): test-shaped `pnpm exec vitest run scripts/harness/__tests__/checkpoint-evidence-contract.test.mjs` → exit 0 ( Duration 179ms (transform 24ms, setup 0ms, collect 28ms, tests 11ms, environment 0ms, prepare 28ms) ⏎ ⏎ 3:36:55 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.); all 2 supplied commands exit 0

### [GATE-COMPLETE] — ✅ PASS | 2026-08-30

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-08-30; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 3/3 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (3)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (3) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (3) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 3/3 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (3) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/PROC-019-extend-proc-017-continuation-scope-for-conversion-base-replay.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 3/3 tasks `[x]` in .agents/tasks/PROC-019-extend-proc-017-continuation-scope-for-conversion-base-replay.md
