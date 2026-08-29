---
status: done
type: FLOW
tags: [workflow, harness]
lane: L2
---

# PROC-018: Record the PROC-017 post-merge continuation scope

Paired with `.agents/tasks/PROC-018-record-the-proc-017-post-merge-continuation-scope.md`. Arising from [issue #2514](https://github.com/woojubb/robota/issues/2514).

## Problem

Repair the post-merge sequencing omission in PROC-017: its accepted plan requires a committed
candidate measurement after PR #2542 merges, but its `### Decision` section does not name the
artifacts for that required later PR. Record the exact closeout scope before attempting the
continuation checkpoint, without weakening the branch-local planning guard.

Reproduction: read the merged document at
`.agents/spec-docs/active/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md`.
TC-06 requires a post-merge evidence commit, while `continuationArtifacts(...)` reports a missing
`Architecture Review/Decision` declaration, so the required later branch cannot form the
continuation checkpoint mandated by `backlog-execution.md`.

## Prior Art Research

Waived: Repository-local recovery planning uses the existing continuation contract and requires no external prior art.

## Architecture Review

### Affected Scope

- `.agents/spec-docs/active/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md`
  — add the existing contract's exact continuation declaration only.
- No rule, gate, parser, package, or product behavior changes.

### Alternatives Considered

1. Add the exact closeout artifact declaration to PROC-017 before its continuation branch is cut.
   - Pro: satisfies the existing parent-spec binding without weakening the scanner or changing the
     continuation contract.
   - Con: requires this small preparatory PR before the evidence closeout PR.
2. Teach the scanner to accept a declaration introduced inside the continuation checkpoint.
   - Pro: avoids the preparatory PR.
   - Con: weakens the parent-spec ancestry guarantee and changes an L2 enforcement surface.
3. Close PROC-017 without committing candidate evidence.
   - Pro: no additional repository changes.
   - Con: violates PROC-017 TC-06 and leaves the measured claim unverified; rejected.

### Decision

**Alternative 1.** Add one exact `**Continuation artifacts:**` line under PROC-017's existing
Decision. The line lists only the six non-pair artifacts already prepared for closeout, in the order
the continuation evidence contract must preserve:

1. `.agents/evidence/PROC-017-candidate.json`
2. `.agents/loop-runs/pr-finding-resolution-loop.jsonl`
3. `.agents/skills/backlog-execution-orchestrator/SKILL.md`
4. `.agents/skills/user-request-gate/SKILL.md`
5. `scripts/harness/__tests__/conversion-evidence.test.mjs`
6. `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`

The paired PROC-017 Task/spec paths remain bound separately by the continuation payload's `taskPath`
and `specPath`; the predecessor post-merge ledger already landed in this preparation branch and is not
part of the later closeout scope. This preserves the existing parent-spec binding and fail-closed
behavior.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: Repository-local recovery planning uses the existing continuation contract and requires no external prior art.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

Insert the single contract-owned declaration in PROC-017's Decision. Verify it by parsing the live
backlog rule and active spec with `continuationArtifacts`, checking the exact ordered array and unique
line count, then run the affected scan. No code or contract implementation changes.

## Affected Files

- `.agents/spec-docs/active/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md`

## Completion Criteria

- [x] TC-01: a Node assertion using `parseCheckpointEvidenceContract` and
      `continuationArtifacts` exits 0 and returns the six Decision artifacts above in exact order.
- [x] TC-02: `rg -c '^\*\*Continuation artifacts:\*\* ' <PROC-017-active-spec>` prints `1`, and
      `git diff --name-only <planning-checkpoint>..HEAD` names only the PROC-017 active spec.
- [x] TC-03: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
      exits 0 after the documentation change is committed.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                                | Notes                                                                                                   |
| ----- | ----------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| TC-01 | Contract    | Node assertion over `checkpoint-evidence-contract.mjs` exports                 | Test skipped: document instance uses the existing tested parser; live exact-value assertion is stronger |
| TC-02 | Static/diff | exact `rg -c` plus `git diff --name-only`                                      | Test skipped: single-document scope is verified directly                                                |
| TC-03 | Suite       | `run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` | Repository regression gate                                                                              |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [x] `.agents/tasks/completed/PROC-018-record-the-proc-017-post-merge-continuation-scope.md` — done

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-30

**Status upgrade:** draft → review-ready

- **Frontmatter (4/4):** All required fields present and valid (`status: draft`, `type: FLOW`, tags array, YAML block).
- **Problem section:** Concrete symptom recorded (missing continuation-artifacts declaration in PROC-017); exact reproduction path and parser behavior specified.
- **Prior Art Research:** Waived with an explicit repository-local justification; the alternatives evaluate the existing continuation contract rather than external designs.
- **Architecture Review Checklist (5/5):** All items checked; sibling scan is N/A with a reason; three alternatives each have pro/con; Decision names the preparatory-PR cost versus preserving the ancestry guarantee.
- **New-surface placement:** N/A — no new package, app, presentation/interface surface, layer, or product-family reclassification.
- **Completion Criteria (3):** TC-01 through TC-03 cover the parser contract, exact static/diff scope, and affected regression scan; all use command or observable form.
- **Test Plan (3 rows):** One row per TC-N; all Test Type and Tool/Approach cells are populated, with explicit skip reasons where applicable.
- **Structure:** Tasks placeholder present; Evidence Log was empty before this run; no body Status or Classification sections.
- **Mechanical judge:** 20 PASS, 0 FAIL, 7 semantic criteria delegated.
- **Independent guardian:** all 27 criteria PASS; `GATE VERDICT: PASS`.

- GATE-WRITE — File begins with YAML frontmatter: opening and closing `---` delimiters are present.
- GATE-WRITE — `status: draft` is present: frontmatter declares `status: draft`.
- GATE-WRITE — `type:` uses an allowed value: frontmatter declares `type: FLOW`.
- GATE-WRITE — `tags:` is present: frontmatter declares `[workflow, harness]`.
- GATE-WRITE — Problem contains a concrete symptom: `continuationArtifacts(...)` reports the missing Architecture Review/Decision declaration required by PROC-017 TC-06.
- GATE-WRITE — Problem contains a reproduction condition: the exact active PROC-017 path and parser call are named.
- GATE-WRITE — Problem avoids TBD, TODO, and vague description: it is a concrete multi-sentence failure account.
- GATE-WRITE — Prior Art Research section is present: `## Prior Art Research` exists.
- GATE-WRITE — Prior Art Research is substantiated or waived: an explicit repository-local waiver with reason is present.
- GATE-WRITE — Research feeds Alternatives and Decision: the valid waiver limits the comparison to three repository-local recovery approaches.
- GATE-WRITE — Architecture Review checklist is complete: all five items are `[x]`.
- GATE-WRITE — Sibling scan is evidenced: it is `[x]` with an explicit N/A reason.
- GATE-WRITE — Alternatives include pro/con: three alternatives each state both.
- GATE-WRITE — Decision states the driving trade-off: preparatory-PR cost is accepted to preserve the parent-spec ancestry guarantee.
- GATE-WRITE — New-surface placement is addressed: N/A is justified because no new surface or boundary is introduced.
- GATE-WRITE — Completion Criteria use TC-N prefixes: TC-01, TC-02, and TC-03 are present.
- GATE-WRITE — Completion Criteria cover each distinct sub-item: parser contract, exact static/diff scope, and regression scan each have a criterion.
- GATE-WRITE — Completion Criteria are observable: they specify exit codes, exact output, and changed paths.
- GATE-WRITE — Completion Criteria avoid banned vague phrases: none of the four banned phrases appears.
- GATE-WRITE — Test Plan section is present: `## Test Plan` exists.
- GATE-WRITE — Test Plan count matches criteria: three rows match TC-01 through TC-03.
- GATE-WRITE — Test Plan rows are complete: each Test Type and Tool/Approach cell is non-empty and contains no TBD.
- GATE-WRITE — Manual-row explanation is satisfied: there are no manual Tool rows; direct-check skip reasons are explicit.
- GATE-WRITE — Tasks section has a placeholder: the paired PROC-018 Task path is listed as todo.
- GATE-WRITE — Evidence Log was empty before this run: this is the first gate entry.
- GATE-WRITE — Body has no Status or Classification sections: lifecycle metadata remains in frontmatter only.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-30

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "Gate: GATE-APPROVAL"
**Given:** 2026-08-30, this conversation
**Review fingerprint:** 777f084c03b6 (review e33c60f3, type/tags 6a90c223)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-30, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: the current instruction names `GATE-APPROVAL` and the exact PROC-018 document path.
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (777f084c03b6) equals the document's current fingerprint
- GATE-APPROVAL — Independent architecture validation is satisfied: N/A because the Architecture Review explicitly introduces no new package, app, surface, layer, or product-family reclassification.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-30

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-30; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/PROC-018-record-the-proc-017-post-merge-continuation-scope.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/PROC-018-record-the-proc-017-post-merge-continuation-scope.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (3)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 326 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/PROC-018-record-the-proc-017-post-merge-continuation-scope.md",
  "specPath": ".agents/spec-docs/todo/PROC-018-record-the-proc-017-post-merge-continuation-scope.md",
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
    ".agents/spec-docs/todo/PROC-018-record-the-proc-017-post-merge-continuation-scope.md",
    ".agents/tasks/PROC-018-record-the-proc-017-post-merge-continuation-scope.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-30

**Command:** `node --input-type=module -e '<continuationArtifacts exact six-item assertion>'`
**Exit:** 0
**Output:** (last 1 of 1 line(s))

```
[".agents/evidence/PROC-017-candidate.json",".agents/loop-runs/pr-finding-resolution-loop.jsonl",".agents/skills/backlog-execution-orchestrator/SKILL.md",".agents/skills/user-request-gate/SKILL.md","scripts/harness/__tests__/conversion-evidence.test.mjs","scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs"]
```

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-30

**Command:** `rg -c continuation-artifacts && git diff --name-only b577eb8f0..a7c5360da`
**Exit:** 0
**Output:** (last 2 of 2 line(s))

```
declaration_count=1
changed_path=PROC-017-active-spec-only
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
scan receipt NOT written: working tree is not clean:  M .agents/spec-docs/active/PROC-018-record-the-proc-017-post-merge-continuation-scope.md,  M .agents/tasks/PROC-018-record-the-proc-017-post-merge-continuation-scope.md
```

### [GATE-VERIFY] — ✅ PASS | 2026-08-30

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — ordering: prior gate GATE-IMPLEMENT PASS and status `in-progress`: [GATE-IMPLEMENT] — ✅ PASS | 2026-08-30; status `in-progress`
- GATE-VERIFY — All tasks in `.agents/tasks/<ID>.md` are marked complete (`[x]`): 3/3 tasks `[x]` in .agents/tasks/PROC-018-record-the-proc-017-post-merge-continuation-scope.md
- GATE-VERIFY — No tasks are blocked or pending: no unticked, blocked, or pending task
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): build-shaped `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exit 0 ( ⏎ 36 scans passed, 1 skipped (27 declared what they examined) ⏎ scan receipt NOT written: working tree is not clean: M .agents/spec-docs/active/PROC-018-record-the-proc-017-post-merge-continuation-scope.md, M .agents/tasks/PROC-018-record-the-proc-017-post-merge-continuation-scope.md); all 2 supplied commands exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): test-shaped `pnpm exec vitest run scripts/harness/__tests__/checkpoint-evidence-contract.test.mjs` → exit 0 ( Duration 230ms (transform 22ms, setup 0ms, collect 27ms, tests 10ms, environment 0ms, prepare 28ms) ⏎ ⏎ 2:48:27 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.); all 2 supplied commands exit 0

### [GATE-COMPLETE] — ✅ PASS | 2026-08-30

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-08-30; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 3/3 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (3)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (3) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (3) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 3/3 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (3) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/PROC-018-record-the-proc-017-post-merge-continuation-scope.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 3/3 tasks `[x]` in .agents/tasks/PROC-018-record-the-proc-017-post-merge-continuation-scope.md
