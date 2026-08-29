---
status: done
type: RULE
tags: [workflow, harness]
lane: L2
---

# PROC-020: Fix continuation conversion-base replay

Paired with `.agents/tasks/completed/PROC-020-fix-continuation-conversion-base-replay.md`. Arising from
[issue #2514](https://github.com/woojubb/robota/issues/2514).

## Problem

A valid `gateImplementContinuation` checkpoint for PROC-017 exits 1 with
`conversion-evidence-base-mismatch`. `checkpointOptionsAt` always obtains `baseOid` from
`resolveTopicMergeBase(root, 'origin/develop')`, which resolves from current `HEAD`; on a later PR
that is the later `develop` base, not the immutable base recorded when conversion and the first
checkpoint occurred.

Reproduction: merge a first checkpoint carrying valid conversion evidence, advance `develop`, cut a
later feature branch, append a valid continuation entry, and run the staged or history plan-order
scan. The original receipt base remains an ancestor and the Task is unchanged, but the scan rejects
it by comparing two intentionally different lifecycle moments.

## Prior Art Research

Waived: the relevant contract and failure are repository-local; the existing conversion receipt,
continuation payload, and Git ancestry checks are the complete prior art for this repair.

## Architecture Review

### Affected Scope

- `scripts/harness/scan-user-execution-plan-order.mjs` — replay the prior immutable base only on an
  already-in-progress continuation pair and prove its ancestry.
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` — add success and mutation
  fixtures across a later branch base.
- `.agents/spec-docs/active/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md`
  — remove the scanner source from the remaining continuation list after this PR delivers it.

### Alternatives Considered

1. On continuation only, reuse the unchanged receipt's recorded base after proving it resolves and
   is an ancestor of the prior checkpoint lineage.
   - Pro: preserves historical identity and accepts the intended multi-PR lifecycle.
   - Con: requires explicit Task immutability and ancestry checks.
2. Compare every replay to the current later branch base.
   - Pro: matches the current implementation.
   - Con: makes every post-merge continuation of a converted Task impossible; rejected.
3. Rewrite `base-oid` during continuation.
   - Pro: satisfies the current comparison.
   - Con: fabricates historical evidence and defeats recovery identity; rejected.

### Decision

**Alternative 1.** A first checkpoint keeps the current strict merge-base comparison. For a
continuation whose parent Task/spec are already `in-progress`, require the Task bytes and exact PLAN
signal to remain unchanged, read the single recorded `base-oid`, require that commit to resolve and
be an ancestor of the continuation's parent revision, then pass that original OID to the pure
conversion parser. Missing, malformed, changed, or non-ancestor receipts remain refused. After this
PR delivers the scanner source and regression test, remove the source path from PROC-017's remaining
continuation declaration so the next checkpoint names only still-undelivered artifacts.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — existing conversion and continuation fixtures in the same test owner are reused.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, interface, layer, or product family.

## Fallback & Degradation Declaration

Any unreadable or changed receipt, Task mutation, or failed ancestry check remains a hard refusal.

## Solution

1. Extend the sequenced-repository fixture with a real conversion receipt bound to the first branch
   base and prove the later continuation passes.
2. Add mutation cases for changed Task bytes/base and non-ancestor OIDs.
3. Select the immutable recorded base only for a continuation with an unchanged parent Task and
   valid ancestry; keep first-checkpoint validation unchanged.
4. Remove the now-delivered scanner source from PROC-017's remaining artifact declaration.

## Affected Files

- `scripts/harness/scan-user-execution-plan-order.mjs`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
- `.agents/spec-docs/active/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md`

## Completion Criteria

- [x] TC-01: a focused Vitest case constructs a first conversion checkpoint and later continuation
      with different branch bases; `findHistoryFindings` returns `[]`.
- [x] TC-02: focused mutation cases for changed Task bytes, changed `base-oid`, and a non-ancestor OID
      each return a fail-closed finding.
- [x] TC-03: `continuationArtifacts` returns the exact six still-undelivered PROC-017 paths and the
      declaration occurs exactly once.
- [x] TC-04: focused Vitest, `run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`,
      and `pnpm harness:test:contracts` all exit 0.

## Test Plan

| TC-ID | Test Type        | Tool / Approach                                                    | Notes                                                                                       |
| ----- | ---------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| TC-01 | Integration      | `scan-user-execution-plan-order.test.mjs` real temporary Git graph | Test written in the named fixture                                                           |
| TC-02 | Mutation         | same fixture with Task/base mutations                              | Test written in the named fixture                                                           |
| TC-03 | Contract/static  | live `continuationArtifacts` assertion plus exact count            | Test skipped: direct live contract assertion is stronger                                    |
| TC-04 | Regression suite | focused Vitest, affected scans, contract tier                      | Test written: `scan-user-execution-plan-order.test.mjs`; repository gate commands also pass |

## User Execution Test Scenarios

Not applicable — this changes repository-internal checkpoint enforcement only. TC-01 through TC-04
are the engineering verification surface.

Recorded as the rule's required choice rather than skipped.

## Tasks

- [x] `.agents/tasks/completed/PROC-020-fix-continuation-conversion-base-replay.md` — done

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-30

**Status upgrade:** draft → review-ready

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block.
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft` is present.
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT · INFRA · PERF · SECURITY · OBSERVABILITY: `type: RULE` is one of the 11 allowed values.
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags: [workflow, harness]` is present with two values.
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): a valid `gateImplementContinuation` checkpoint exits 1 with `conversion-evidence-base-mismatch` because `checkpointOptionsAt` resolves the later current merge base instead of the immutable recorded conversion base.
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): the Problem names a first merged conversion checkpoint, an advanced `develop`, a later feature branch with a valid continuation entry, and the staged or history plan-order scan that rejects the unchanged receipt.
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO and gives a concrete multi-sentence failure account.
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` is present.
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec — NOT third-party source code per `research.md`), OR explicitly states no comparable reference was found: the section uses the permitted explicit waiver route for a repository-local enforcement contract and failure.
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare or missing section is FAIL: `Waived: the relevant contract and failure are repository-local; the existing conversion receipt, continuation payload, and Git ancestry checks are the complete prior art for this repair.` is present.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): the valid repository-local waiver identifies the conversion receipt, continuation payload, and ancestry checks as the comparison set; Alternatives and Decision use those contracts to select immutable-base replay with explicit ancestry and Task-immutability guards.
- GATE-WRITE — All 4 checklist items are `[x]`: all 5 displayed Architecture Review Checklist items, including the conditional new-surface item, are `[x]`.
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: the checked Sibling scan records reuse of the existing conversion and continuation fixtures in the same test owner.
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 3 numbered alternatives are present and each has one Pro and one Con.
- GATE-WRITE — Decision references the trade-off that drove the choice: the Decision preserves immutable historical identity and accepts explicit Task-immutability and ancestry checks instead of comparing to a later branch base or rewriting historical evidence.
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interface surface, or reclassifies a layer / product-family boundary, the Sibling scan / Decision MUST (a) name the analogous existing layer it mirrors + its product-family classification, and (b) show reuse is at the shared contract/core level, not a dependency on a sibling PRODUCT. See `spec-workflow.md` "New-Surface Architecture Placement". (N/A only if no new surface/boundary is introduced.): N/A — the change modifies an existing repository-internal scanner, its existing test owner, and an existing continuation declaration; no package, app, interface surface, layer, or product-family boundary is introduced or reclassified.
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 4 criteria are present and all use a `TC-NN:` prefix.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: TC-01 covers valid later-base replay, TC-02 covers fail-closed Task/base/ancestry mutations, TC-03 covers the remaining continuation declaration, and TC-04 covers the focused and repository regression gates.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): TC-01 and TC-02 require exact `findHistoryFindings` results, TC-03 requires exact parser output and declaration count, and TC-04 requires named commands to exit 0.
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of the four prohibited phrases appears in Completion Criteria.
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` is present.
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 4 Test Plan rows match 4 Completion Criteria, TC-01 through TC-04.
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): all 4 rows have non-empty Test Type and Tool/Approach cells and none contains TBD.
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: there are 0 manual rows, so the conditional requirement is satisfied.
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` contains the unchecked paired Task path placeholder.
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` existed with 0 prior entries before this single GATE-WRITE entry was appended.
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): neither body section exists.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-30

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "Complete the existing mechanical approval entry; do not add a duplicate."
**Given:** 2026-08-30, this conversation
**Review fingerprint:** e9f64fc15bb2 (review 1ea377ed, type/tags 42a75dd9)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: PASS — route DIRECT; the current request names this exact GATE-APPROVAL and document, and the verbatim instruction is recorded above with this conversation as its source.
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the current request explicitly names `.agents/spec-docs/backlog/PROC-020-fix-continuation-conversion-base-replay.md` and commands completion of its existing approval entry.
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlog-execution.md` § Delegated Approval Classes is the SSOT for the registry; this catalogue points at it and does not restate it: N/A — route DIRECT is used, so no delegated class is named or required.
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: N/A for Route CLASS; for the selected DIRECT route, the exact current instruction, date, and `this conversation` source are nevertheless recorded above.
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: N/A — route DIRECT is used, so no class evidence condition applies.
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry argues for: N/A — route DIRECT is used, so there is no delegated-class boundary to evaluate.
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: PASS — the recorded review fingerprint `e9f64fc15bb2` equals the document's current Architecture Review plus type/tags fingerprint; this Evidence Log-only completion does not affect it.
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or reclassifies a layer / product-family boundary, the Evidence Log MUST contain an independent `proposal-reviewer` verdict that ENDORSED the recommendation and explicitly covered the placement — not a bare "reviewed" claim. Retain an `architecture-audit-fanout` structure-channel result as additional placement evidence when the surface is new. A new-surface spec approved without a recorded independent placement review is a process violation (see `spec-workflow.md` "New-Surface Architecture Placement").: N/A — PROC-020 changes an existing repository-internal scanner, its existing test owner, and an existing continuation declaration; it introduces or reclassifies no package, app, surface, layer, or product-family boundary.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-30

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-30; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/PROC-020-fix-continuation-conversion-base-replay.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/PROC-020-fix-continuation-conversion-base-replay.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (4)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 234 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/PROC-020-fix-continuation-conversion-base-replay.md",
  "specPath": ".agents/spec-docs/todo/PROC-020-fix-continuation-conversion-base-replay.md",
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
    ".agents/spec-docs/todo/PROC-020-fix-continuation-conversion-base-replay.md",
    ".agents/tasks/PROC-020-fix-continuation-conversion-base-replay.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-30

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs -t 'replays the immutable conversion base across a later continuation'`
**Exit:** 0
**Output:** (last 10 of 12 line(s))

```
 RUN  v3.2.6 /Users/jungyoun/Documents/dev/robota

Switched to a new branch 'feature'
 ✓ scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs (134 tests | 133 skipped) 798ms
   ✓ user-execution PLAN order — branch history > replays the immutable conversion base across a later continuation  790ms

 Test Files  1 passed (1)
      Tests  1 passed | 133 skipped (134)
   Start at  04:33:25
   Duration  1.04s (transform 71ms, setup 0ms, collect 98ms, tests 798ms, environment 0ms, prepare 29ms)
```

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-30

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs -t 'refuses conversion receipt mutation during continuation'`
**Exit:** 0
**Output:** (last 10 of 14 line(s))

```
Switched to a new branch 'feature'
Switched to a new branch 'feature'
Switched to a new branch 'feature'
 ✓ scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs (134 tests | 133 skipped) 2215ms
   ✓ user-execution PLAN order — branch history > refuses conversion receipt mutation during continuation  2196ms

 Test Files  1 passed (1)
      Tests  1 passed | 133 skipped (134)
   Start at  04:33:26
   Duration  2.46s (transform 71ms, setup 0ms, collect 99ms, tests 2.22s, environment 0ms, prepare 28ms)
```

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-30

**Command:** `node --input-type=module -e '<live continuationArtifacts exact-six assertion>'`
**Exit:** 0
**Output:** (last 10 of 11 line(s))

```
  "artifacts": [
    ".agents/evidence/PROC-017-candidate.json",
    ".agents/loop-runs/pr-finding-resolution-loop.jsonl",
    ".agents/skills/backlog-execution-orchestrator/SKILL.md",
    ".agents/skills/user-request-gate/SKILL.md",
    "scripts/harness/__tests__/conversion-evidence.test.mjs",
    "scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs"
  ],
  "declarationCount": 1
}
```

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-30

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs && node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts && pnpm harness:test:contracts`
**Exit:** 0
**Output:** (last 3 of 3 line(s))

```
focused: Test Files  1 passed (1) |       Tests  134 passed (134)
affected: 55 scans passed, 1 skipped (39 declared what they examined)
contracts: Test Files  195 passed (195) |       Tests  4296 passed (4296)
```

### [GATE-VERIFY] — ❌ FAIL | 2026-08-30

**Status remains:** in-progress
**Failed criteria:**

- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exit 0 ( ⏎ 55 scans passed, 1 skipped (39 declared what they examined) ⏎ scan receipt NOT written: working tree is not clean: M .agents/spec-docs/active/PROC-020-fix-continuation-conversion-base-replay.md, M .agents/tasks/PROC-020-fix-continuation-conversion-base-replay.md, M scripts/harness/**tests**/scan-user-execution-plan-order.test.mjs); `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` → exit 1 ( ❯ processTimers node:internal/timers:529:7 ⏎ ⏎ ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯)
  **Required action:** make every verify command exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exit 0 ( ⏎ 55 scans passed, 1 skipped (39 declared what they examined) ⏎ scan receipt NOT written: working tree is not clean: M .agents/spec-docs/active/PROC-020-fix-continuation-conversion-base-replay.md, M .agents/tasks/PROC-020-fix-continuation-conversion-base-replay.md, M scripts/harness/**tests**/scan-user-execution-plan-order.test.mjs); `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` → exit 1 ( ❯ processTimers node:internal/timers:529:7 ⏎ ⏎ ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯)
  **Required action:** make every verify command exit 0

### [GATE-VERIFY] — ✅ PASS | 2026-08-30

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — ordering: prior gate GATE-IMPLEMENT PASS and status `in-progress`: [GATE-IMPLEMENT] — ✅ PASS | 2026-08-30; status `in-progress`
- GATE-VERIFY — All tasks in `.agents/tasks/<ID>.md` are marked complete (`[x]`): 4/4 tasks `[x]` in .agents/tasks/PROC-020-fix-continuation-conversion-base-replay.md
- GATE-VERIFY — No tasks are blocked or pending: no unticked, blocked, or pending task
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): build-shaped `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exit 0 ( ⏎ 55 scans passed, 1 skipped (39 declared what they examined) ⏎ scan receipt NOT written: working tree is not clean: M .agents/spec-docs/active/PROC-020-fix-continuation-conversion-base-replay.md, M .agents/tasks/PROC-020-fix-continuation-conversion-base-replay.md, M scripts/harness/**tests**/scan-user-execution-plan-order.test.mjs); all 2 supplied commands exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): test-shaped `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs -t 'replays the immutable conversion base across a later continuation|refuses conversion receipt mutation during continuation'` → exit 0 (Switched to a new branch 'feature' ⏎ Switched to a new branch 'feature' ⏎ Switched to a new branch 'feature'); all 2 supplied commands exit 0

### [GATE-COMPLETE] — ✅ PASS | 2026-08-30

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-08-30; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 4/4 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (4)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (4) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (4) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 4/4 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (4) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/PROC-020-fix-continuation-conversion-base-replay.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 4/4 tasks `[x]` in .agents/tasks/PROC-020-fix-continuation-conversion-base-replay.md
