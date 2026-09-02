---
status: done
type: INFRA
tags: [github, harness]
lane: L1
---

# INFRA-151: support multi-issue AGREEMENT migration batches

Paired with `.agents/tasks/completed/INFRA-151-support-multi-issue-agreement-migration-batches.md`. Arising from
[issue #2061](https://github.com/woojubb/robota/issues/2061).

## Problem

The repository cannot represent one existing parent Issue and its existing child Issues as one atomic
AGREEMENT Task graph without lying about source ownership. With a parent Task citing issue 2061 and child
Tasks citing issues 2088, 2092, 2100, and 2129, running
`node scripts/harness/scan-user-execution-plan-order.mjs --staged --base origin/develop` reports that
every child “must cite the parent source issue.” Changing those four fields to the parent makes the staged
scan pass, but `github-issue-triage.mjs convert --issue <leaf> --task <child>` then refuses each handoff
with `Task source issue does not match #<leaf>`. The contradiction occurs for every RULE-023 migration
that absorbs a pre-existing Issue hierarchy into an AGREEMENT parent plus leaf-owning child Tasks.

## Prior Art Research

Waived: this is a repository-specific lifecycle composition defect. INFRA-141 is the direct local prior
art: it made one-Issue-to-many-Tasks AGREEMENT creation atomic, but generalized its same-source fixture
into a requirement that excludes RULE-023's existing-hierarchy migration. The current exact-identity
guard in `github-issue-triage.mjs` is the safety boundary to preserve.

## Architecture Review

### Affected Scope

- `.agents/skills/issue-to-backlog/SKILL.md`
- `scripts/harness/scan-user-execution-plan-order.mjs`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
- `scripts/harness/__tests__/github-issue-triage.test.mjs`

### Alternatives Considered

1. Rewrite every child Task to cite only the parent Issue.
   - Pro: the existing atomic prelude passes unchanged.
   - Con: records false provenance and makes the exact leaf conversion finalizer correctly refuse.
2. Relax or bypass the finalizer's exact Task-to-Issue check.
   - Pro: distinct leaf Issues could be mutated with no planning-order change.
   - Con: permits a Task for one Issue to remove priority from another, weakening the irreversible-write guard.
3. Let the atomic prelude accept any concrete child Issue URL while retaining the exact finalizer check.
   - Pro: supports both one-Issue decomposition and existing-hierarchy absorption without weakening
     atomic shape or mutation identity.
   - Con: planning-order proves structural atomicity, while live parent/leaf identity remains a separate
     manifest and conversion-time responsibility.

### Decision

**Alternative 3.** Preserve each Task's truthful source and the finalizer's fail-closed identity check,
accepting the explicit separation between repository-local atomicity and live GitHub hierarchy evidence.
The additional distinct-source fixtures are cheaper and safer than either false provenance or a mutation
guard bypass.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — INFRA-141, RULE-023, `issue-to-backlog`, planning-order staged/history paths,
      triage audit/finalizer, and the five-record command proposal were checked.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. Keep the existing strict atomic AGREEMENT shape: one new exact-basename parent Task/spec, every exact
   declared new non-AGREEMENT `todo` child, exact projections, and no unrelated path.
2. In the shared staged/history validator, require every child `issue` field to be one syntactically
   concrete GitHub Issue URL instead of requiring equality with the parent URL. Same-source internal
   decomposition and distinct-source hierarchy absorption are both valid.
3. Document in `issue-to-backlog` that every Task cites the Issue whose outcome it owns: records may
   repeat one Issue for internal decomposition, while an absorbed existing hierarchy uses the tracker on
   the AGREEMENT and each exact leaf on its owning child Task.
4. Leave `github-issue-triage.mjs` unchanged. Add a finalizer test matrix proving exact leaf/Task pairs
   succeed and every cross-pairing refuses before a marker or label mutation.

## Affected Files

- `.agents/skills/issue-to-backlog/SKILL.md`
- `scripts/harness/scan-user-execution-plan-order.mjs`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
- `scripts/harness/__tests__/github-issue-triage.test.mjs`

## Completion Criteria

- [x] TC-01: `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
      exits 0 with same-source and distinct-source atomic AGREEMENT fixtures in staged and committed
      history modes; reverting the child-source predicate makes the distinct-source case fail.
- [x] TC-02: the same planning-order suite rejects missing/malformed child Issue URLs and preserves every
      existing unrelated-path, pre-existing-child, nested-AGREEMENT, non-todo, duplicate, and projection
      mismatch negative case.
- [x] TC-03: `pnpm exec vitest run scripts/harness/__tests__/github-issue-triage.test.mjs` exits 0 and
      proves each distinct leaf succeeds only with its exact Task while cross-pairing performs no write.
- [x] TC-04: repository text and focused tests prove `issue-to-backlog` describes both source topologies,
      and `github-issue-triage.mjs` retains its exact `Task source issue does not match` guard unchanged.
- [x] TC-05: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
      exits 0 after the complete implementation batch.

## Test Plan

| TC-ID | Test Type            | Tool / Approach                                      | Notes                                                    |
| ----- | -------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| TC-01 | Unit/Git integration | `scan-user-execution-plan-order.test.mjs`            | Staged/history same-source and distinct-source RED/GREEN |
| TC-02 | Negative regression  | Existing and new planning-order invalid-shape table  | Every strict atomic invariant remains fail-closed        |
| TC-03 | Unit                 | `github-issue-triage.test.mjs`                       | Exact pairs succeed; cross-pairs write nothing           |
| TC-04 | Contract             | Skill text assertions plus unchanged guard assertion | Procedure and mutation owner stay aligned                |
| TC-05 | Suite                | `run-all-scans.mjs --affected --context pr`          | One post-batch affected verification                     |

## User Execution Test Scenarios

Not applicable.

**Reason:** No runnable user-facing behaviour changes; verification evidence is recorded in the
engineering test plan (TC-01 to TC-05).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [x] `.agents/tasks/completed/INFRA-151-support-multi-issue-agreement-migration-batches.md` — completed

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-03

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-08-28, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <2 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 2 changed path(s) — committed and working-tree changes vs origin/develop (merge base eb25171678cf) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/INFRA-151-support-multi-issue-agreement-migration-batches.md) is at or above the floor L0)
**Review fingerprint:** aaf20efe901e (review 3192368f, type/tags 7839d832)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <2)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (aaf20efe901e) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

### [GATE-PLAN] — ✅ PASS | 2026-09-03

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (2 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 779 chars, 3 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with completion evidence
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 3 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 5 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 5 Test Plan rows = 5 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 5 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s), each with Notes
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 1 prior entry (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <2)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (aaf20efe901e) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-151-support-multi-issue-agreement-migration-batches.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-151-support-multi-issue-agreement-migration-batches.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-03

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs scripts/harness/__tests__/github-issue-triage.test.mjs --pool=threads --maxWorkers=1 --testTimeout=120000`
**Exit:** 0
**Output:** (last 8 of 8 line(s))

```
Command: pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs scripts/harness/__tests__/github-issue-triage.test.mjs --pool=threads --maxWorkers=1 --testTimeout=120000
Observed: 2026-09-03 Asia/Seoul
Test Files  2 passed (2)
Tests  273 passed (273)
scan-user-execution-plan-order.test.mjs  154 passed
github-issue-triage.test.mjs  119 passed
Duration  89.98s
Exit  0
```

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-03

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs scripts/harness/__tests__/github-issue-triage.test.mjs --pool=threads --maxWorkers=1 --testTimeout=120000`
**Exit:** 0
**Output:** (last 8 of 8 line(s))

```
Command: pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs scripts/harness/__tests__/github-issue-triage.test.mjs --pool=threads --maxWorkers=1 --testTimeout=120000
Observed: 2026-09-03 Asia/Seoul
Test Files  2 passed (2)
Tests  273 passed (273)
scan-user-execution-plan-order.test.mjs  154 passed
github-issue-triage.test.mjs  119 passed
Duration  89.98s
Exit  0
```

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-03

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs scripts/harness/__tests__/github-issue-triage.test.mjs --pool=threads --maxWorkers=1 --testTimeout=120000`
**Exit:** 0
**Output:** (last 8 of 8 line(s))

```
Command: pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs scripts/harness/__tests__/github-issue-triage.test.mjs --pool=threads --maxWorkers=1 --testTimeout=120000
Observed: 2026-09-03 Asia/Seoul
Test Files  2 passed (2)
Tests  273 passed (273)
scan-user-execution-plan-order.test.mjs  154 passed
github-issue-triage.test.mjs  119 passed
Duration  89.98s
Exit  0
```

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-03

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs scripts/harness/__tests__/github-issue-triage.test.mjs --pool=threads --maxWorkers=1 --testTimeout=120000`
**Exit:** 0
**Output:** (last 8 of 8 line(s))

```
Command: pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs scripts/harness/__tests__/github-issue-triage.test.mjs --pool=threads --maxWorkers=1 --testTimeout=120000
Observed: 2026-09-03 Asia/Seoul
Test Files  2 passed (2)
Tests  273 passed (273)
scan-user-execution-plan-order.test.mjs  154 passed
github-issue-triage.test.mjs  119 passed
Duration  89.98s
Exit  0
```

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-09-03

**Command:** `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
**Exit:** 0
**Output:** (last 9 of 9 line(s))

```
Command: node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts
Observed: 2026-09-03 Asia/Seoul
Affected paths  7
Scans  60 passed, 2 skipped
work-run-measurement  passed
reference-kind-qualified  passed
user-execution-plan-order  passed
file-size contract  passed
Exit  0
```

### [GATE-DONE] — ✅ PASS | 2026-09-03

**Status upgrade:** approved → done

- GATE-DONE — ordering: prior gate GATE-PLAN PASS and status `approved`: [GATE-PLAN] — ✅ PASS | 2026-09-03; status `approved`
- GATE-VERIFY — All tasks in `.agents/tasks/<ID>.md` are marked complete (`[x]`): 5/5 tasks `[x]` in .agents/tasks/INFRA-151-support-multi-issue-agreement-migration-batches.md
- GATE-VERIFY — No tasks are blocked or pending: no unticked, blocked, or pending task
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): build-shaped `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exit 0 ( ⏎ 60 scans passed, 2 skipped (44 declared what they examined) ⏎ scan receipt written: an unchanged tree will not be re-scanned.); all 2 supplied commands exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): test-shaped `pnpm exec vitest run scripts/harness/__tests__/github-issue-triage.test.mjs --pool=threads --maxWorkers=1` → exit 0 (   Duration  164ms (transform 35ms, setup 0ms, collect 40ms, tests 36ms, environment 0ms, prepare 25ms) ⏎  ⏎ 1:28:41 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.); all 2 supplied commands exit 0
- GATE-COMPLETE — The checkbox is checked (`[x]`): 5/5 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (5)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (5) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (5) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 5/5 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (5) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/INFRA-151-support-multi-issue-agreement-migration-batches.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 5/5 tasks `[x]` in .agents/tasks/INFRA-151-support-multi-issue-agreement-migration-batches.md
