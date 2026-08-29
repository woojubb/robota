---
status: done
type: RULE
tags: [workflow, harness]
lane: L2
---

# PROC-021: Support squash-merged continuation ancestry

Paired with `.agents/tasks/completed/PROC-021-support-squash-merged-continuation-ancestry.md`. Arising from
[issue #2514](https://github.com/woojubb/robota/issues/2514).

## Problem

A valid PROC-017 `gateImplementContinuation` checkpoint exits 1 with
`gateImplementContinuation.ancestorSha has no preceding merge commit that introduced the sequenced checkpoint`.
The predecessor checkpoint was delivered by squash-merged PR #2542 as commit
`026d7ac799706d9cd0c2d71b951304bdf8810727`, but `precedingSequencedMerge` invokes
`git rev-list --first-parent --merges`. Squash commits have one parent, so that command excludes the
real integration commit before content-transition checks run.

Reproduction: squash-merge a first PR that introduces a canonical GATE-IMPLEMENT PASS, cut a later
branch from the advanced integration branch, append a valid continuation payload whose `ancestorSha`
names the squash commit, stage only the active spec, and run
`node scripts/harness/scan-user-execution-plan-order.mjs --staged`.

## Prior Art Research

Waived: this is a repository-local Git-history enforcement defect; the existing first-parent walk,
raw PASS byte comparison, continuation payload, and current squash-merge policy are its complete
authoritative comparison set.

## Architecture Review

### Affected Scope

- `scripts/harness/scan-user-execution-plan-order.mjs` — discover the first-parent integration commit
  whose tree first contains the latest predecessor PASS.
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` — add real squash history and
  retain no-ff and unrelated-integration controls.

### Alternatives Considered

1. Walk every first-parent commit and select the exact transition where the predecessor PASS count
   increases over that commit's first parent.
   - Pro: models both squash commits and no-ff merge commits by their observable integration-tree transition.
   - Con: the helper and diagnostics must use the broader term integration commit.
2. Keep `--merges` and require no-ff merges for sequenced work.
   - Pro: preserves the current implementation.
   - Con: contradicts the repository's actual squash-merge delivery path and makes valid continuations impossible.
3. Accept any ancestor named by the payload.
   - Pro: avoids predecessor discovery.
   - Con: permits an unrelated later commit and breaks the checkpoint introduction binding; rejected.

### Decision

**Alternative 1.** Traverse all commits on the integration branch's first-parent chain. For each
commit, compare the exact raw predecessor PASS occurrence count in that commit with its first parent;
return the first commit where the count increases. This retains byte identity, refuses unrelated
later commits, supports both squash and no-ff integration, and leaves the payload field
`ancestorSha` unchanged for contract compatibility.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — existing no-ff, unrelated-merge, and three-PR fixtures remain controls.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, interface, layer, or product family.

## Fallback & Degradation Declaration

Missing predecessor bytes, no first-parent introduction transition, a mismatched payload SHA, or a
later unrelated integration commit remains a hard refusal.

## Solution

1. Extend the sequenced fixture with a squash-first-PR mode that records the resulting integration SHA.
2. Prove a continuation bound to that squash commit passes.
3. Replace the merge-only revision list with a first-parent commit walk while preserving exact raw-entry
   count transition checks.
4. Keep the existing unrelated-later-commit refusal and no-ff fixtures green.

## Affected Files

- `scripts/harness/scan-user-execution-plan-order.mjs`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`

## Completion Criteria

- [x] TC-01: a real temporary Git fixture squash-merges the first checkpoint PR and its later
      continuation returns `findHistoryFindings(...) === []`.
- [x] TC-02: predecessor discovery selects the exact first-parent commit where the latest raw PASS
      count increases over its first parent, for both squash and no-ff histories.
- [x] TC-03: a continuation whose `ancestorSha` names an unrelated later integration commit returns
      an ancestry-binding finding.
- [x] TC-04: focused Vitest, `run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`,
      and `pnpm harness:test:contracts` all exit 0.

## Test Plan

| TC-ID | Test Type        | Tool / Approach                                                    | Notes                                                          |
| ----- | ---------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| TC-01 | Integration      | `scan-user-execution-plan-order.test.mjs` temporary squash history | Test written: named squash-continuation fixture                |
| TC-02 | Regression       | squash and existing no-ff temporary Git histories                  | Test written: plan-order branch-history describe               |
| TC-03 | Mutation/control | existing unrelated-later-integration fixture                       | Test written: `binds ancestorSha` control                      |
| TC-04 | Regression suite | focused Vitest, affected scans, contract tier                      | Test written: plan-order test file; repository gates also pass |

## User Execution Test Scenarios

Not applicable — this is repository-internal Git ancestry enforcement only. TC-01 through TC-04 are
the engineering verification surface.

Recorded as the rule's required choice rather than skipped.

## Tasks

- [x] `.agents/tasks/completed/PROC-021-support-squash-merged-continuation-ancestry.md` — done

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-30

**Status upgrade:** draft → review-ready

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block.
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft` is present.
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT · INFRA · PERF · SECURITY · OBSERVABILITY: `type: RULE` is one of the 11 allowed values.
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags: [workflow, harness]` is present with two values.
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): the exact staged continuation command exits 1 with `ancestorSha has no preceding merge commit`, because the merge-only first-parent walk excludes squash commit `026d7ac799706d9cd0c2d71b951304bdf8810727`.
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): the Problem specifies a squash first PR, later continuation branch, exact payload, staged active spec, and scanner command.
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO and gives a concrete multi-sentence failure account.
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` is present.
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec — NOT third-party source code per `research.md`), OR explicitly states no comparable reference was found: the section uses the permitted explicit waiver route for a repository-local Git-history contract.
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare or missing section is FAIL: the Waived line names first-parent traversal, byte binding, continuation payload, and squash policy as the authoritative local comparison set.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): the alternatives compare the exact local owners and the Decision selects observable first-parent content transition over merge-only or any-ancestor matching.
- GATE-WRITE — All 4 checklist items are `[x]`: all 5 displayed Architecture Review Checklist items, including the conditional new-surface item, are `[x]`.
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: the checked sibling scan names existing no-ff, unrelated-merge, and three-PR fixtures as controls.
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 3 numbered alternatives are present and each has one Pro and one Con.
- GATE-WRITE — Decision references the trade-off that drove the choice: the Decision broadens from merge-only to integration commits while retaining exact byte transition and rejecting any-ancestor matching.
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interface surface, or reclassifies a layer / product-family boundary, the Sibling scan / Decision MUST (a) name the analogous existing layer it mirrors + its product-family classification, and (b) show reuse is at the shared contract/core level, not a dependency on a sibling PRODUCT. See `spec-workflow.md` "New-Surface Architecture Placement". (N/A only if no new surface/boundary is introduced.): N/A — only an existing repository-internal scanner and its existing test owner change; no package, app, interface, layer, or product-family boundary is introduced or reclassified.
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 4 criteria are present and all use a `TC-NN:` prefix.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: TC-01 covers squash acceptance, TC-02 exact first-parent transition and no-ff preservation, TC-03 unrelated-later refusal, and TC-04 repository regression gates.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): every TC names an exact temporary Git history, `findHistoryFindings` result, ancestry finding, or command exit result.
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of the four prohibited phrases appears in Completion Criteria.
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` is present.
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 4 Test Plan rows match 4 Completion Criteria, TC-01 through TC-04.
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): all 4 rows have non-empty Test Type and Tool/Approach cells and none contains TBD.
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: there are 0 manual rows, so the conditional requirement is satisfied.
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` contains the unchecked paired Task path placeholder.
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` was empty before this first structured GATE-WRITE entry was appended.
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): neither body section exists.

**Independent guardian verdict:** `GATE-WRITE: PASS` — all 20 mechanical criteria passed and all
7 semantic criteria below are satisfied.

- Concrete symptom: the exact staged command and `ancestorSha has no preceding merge commit` output
  are named, together with the excluding `--merges` invocation and real PR #2542 SHA.
- Reproduction: a squash first PR, later continuation branch, exact payload binding, staged inventory,
  and scanner command are all specified.
- Research-to-decision: the repository-local waiver identifies first-parent traversal, byte binding,
  payload identity, and squash policy; the alternatives compare those exact owners.
- Decision trade-off: first-parent content transition supports squash/no-ff at the cost of broader
  integration-commit terminology while rejecting the unsafe any-ancestor alternative.
- New-surface placement: N/A is justified because only an existing scanner and its existing test owner
  change; no package, app, interface, layer, or product family is introduced or reclassified.
- Feature coverage: TC-01 covers squash acceptance, TC-02 exact transition and no-ff preservation,
  TC-03 unrelated-later-commit refusal, and TC-04 repository regressions.
- Observable criteria: every TC names an exact Git history, return value, finding, or command exit result.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-30

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "잠재적으로 모두 사전 승인함"
**Given:** 2026-08-30, this conversation
**Review fingerprint:** eba3b68f9f38 (review 2ce64cb1, type/tags 42a75dd9)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-30, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (eba3b68f9f38) equals the document's current fingerprint

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-30

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-30; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/PROC-021-support-squash-merged-continuation-ancestry.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/PROC-021-support-squash-merged-continuation-ancestry.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (4)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 248 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/PROC-021-support-squash-merged-continuation-ancestry.md",
  "specPath": ".agents/spec-docs/todo/PROC-021-support-squash-merged-continuation-ancestry.md",
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
    ".agents/spec-docs/todo/PROC-021-support-squash-merged-continuation-ancestry.md",
    ".agents/tasks/PROC-021-support-squash-merged-continuation-ancestry.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-30

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs -t 'binds ancestorSha'`
**Exit:** 0
**Output:** (last 10 of 14 line(s))

```
Switched to a new branch 'feature'
Switched to a new branch 'feature'
 ✓ scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs (135 tests | 133 skipped) 1480ms
   ✓ user-execution PLAN order — branch history > binds ancestorSha to the merge that introduced the prior sequenced checkpoint  789ms
   ✓ user-execution PLAN order — branch history > binds ancestorSha to the squash commit that introduced the prior sequenced checkpoint  677ms

 Test Files  1 passed (1)
      Tests  2 passed | 133 skipped (135)
   Start at  05:33:06
   Duration  1.72s (transform 68ms, setup 0ms, collect 95ms, tests 1.48s, environment 0ms, prepare 28ms)
```

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-30

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs -t 'binds ancestorSha'`
**Exit:** 0
**Output:** (last 10 of 14 line(s))

```
Switched to a new branch 'feature'
Switched to a new branch 'feature'
 ✓ scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs (135 tests | 133 skipped) 1480ms
   ✓ user-execution PLAN order — branch history > binds ancestorSha to the merge that introduced the prior sequenced checkpoint  789ms
   ✓ user-execution PLAN order — branch history > binds ancestorSha to the squash commit that introduced the prior sequenced checkpoint  677ms

 Test Files  1 passed (1)
      Tests  2 passed | 133 skipped (135)
   Start at  05:33:06
   Duration  1.72s (transform 68ms, setup 0ms, collect 95ms, tests 1.48s, environment 0ms, prepare 28ms)
```

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-30

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs -t 'binds ancestorSha'`
**Exit:** 0
**Output:** (last 10 of 14 line(s))

```
Switched to a new branch 'feature'
Switched to a new branch 'feature'
 ✓ scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs (135 tests | 133 skipped) 1480ms
   ✓ user-execution PLAN order — branch history > binds ancestorSha to the merge that introduced the prior sequenced checkpoint  789ms
   ✓ user-execution PLAN order — branch history > binds ancestorSha to the squash commit that introduced the prior sequenced checkpoint  677ms

 Test Files  1 passed (1)
      Tests  2 passed | 133 skipped (135)
   Start at  05:33:06
   Duration  1.72s (transform 68ms, setup 0ms, collect 95ms, tests 1.48s, environment 0ms, prepare 28ms)
```

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-30

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs && node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts && pnpm harness:test:contracts`
**Exit:** 0
**Output:** (last 3 of 3 line(s))

```
focused: Test Files  1 passed (1) |       Tests  135 passed (135)
affected: 55 scans passed, 1 skipped (39 declared what they examined)
contracts: Test Files  195 passed (195) |       Tests  4297 passed (4297)
```

### [GATE-VERIFY] — ✅ PASS | 2026-08-30

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — ordering: prior gate GATE-IMPLEMENT PASS and status `in-progress`: [GATE-IMPLEMENT] — ✅ PASS | 2026-08-30; status `in-progress`
- GATE-VERIFY — All tasks in `.agents/tasks/<ID>.md` are marked complete (`[x]`): 4/4 tasks `[x]` in .agents/tasks/PROC-021-support-squash-merged-continuation-ancestry.md
- GATE-VERIFY — No tasks are blocked or pending: no unticked, blocked, or pending task
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): build-shaped `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exit 0 ( ⏎ 55 scans passed, 1 skipped (39 declared what they examined) ⏎ scan receipt NOT written: working tree is not clean: M .agents/spec-docs/active/PROC-021-support-squash-merged-continuation-ancestry.md, M .agents/tasks/PROC-021-support-squash-merged-continuation-ancestry.md); all 2 supplied commands exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): test-shaped `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs -t 'binds ancestorSha'` → exit 0 (5:54:26 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead. ⏎ Switched to a new branch 'feature' ⏎ Switched to a new branch 'feature'); all 2 supplied commands exit 0

### [GATE-COMPLETE] — ✅ PASS | 2026-08-30

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-08-30; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 4/4 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (4)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (4) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (4) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 4/4 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (4) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/PROC-021-support-squash-merged-continuation-ancestry.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 4/4 tasks `[x]` in .agents/tasks/PROC-021-support-squash-merged-continuation-ancestry.md
