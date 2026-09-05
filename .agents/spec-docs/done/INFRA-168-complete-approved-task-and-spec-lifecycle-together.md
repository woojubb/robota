---
status: done
type: INFRA
lane: L2
tags: [harness, governance]
---

# INFRA-168: Complete approved Task and spec lifecycle together

## Problem

After a real completion PASS, agents separately advance the spec, edit Task status and completion date, archive the Task, and repair current pointers. INFRA-165 was pushed before this metadata was settled; subsequent archival used an invalid terminal status and needed further verification. The current `runAdvance` also replaces every old spec path in the Task, including historical evidence. The reproduction is a judged pair with an active Task: advance alone leaves the Task open and historical path text is rewritten.

## Prior Art Research

Waived: This is a measured repository-local lifecycle composition defect with existing canonical gate and Task lifecycle owners. External product research cannot determine this repository's authoritative status, projection, and evidence contracts; those existing owners are reused without changing gate criteria.

## Architecture Review

### Affected Scope

Repository harness lifecycle orchestration only. No package runtime, CI checks, receipt identity, approval threshold, or gate judging criteria change.

The existing `.agents/rules/operational.md` waiting guidance is narrowed in this same completion-management batch: only already-authorized independent work may interleave without delaying current delivery; idle workers need actual dispatch, not a notification. This is guidance, not a claimed runtime guarantee over external agent providers.

### Alternatives Considered

1. Keep manual advancement and archival.
   - Pro: No new command.
   - Con: Retains the observed late partial metadata and repeated final verification failure.
2. Compose canonical advancement and Task lifecycle validation in one preflighted command.
   - Pro: One consistent operation validates all known refusal conditions before writes and preserves historical evidence.
   - Con: Requires a narrow L2 gate-owner seam and explicit handling of partial filesystem errors.

### Decision

**Delivery mode:** `single`

Choose alternative 2. Delivery mode: SINGLE. The command `node scripts/harness/task-complete.mjs --doc <spec> --date YYYY-MM-DD` validates the exact pair and existing terminal PASS, then completes both lifecycle records. Gate judging remains unchanged. Existing `runAdvance` owns status/folder derivation; its preparation is exposed without duplicating judging logic, and pointer updates target only current metadata. This is honestly L2 because `gate.mjs` changes. The independent guardian validates this recommendation before implementation.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — gate advancement, task-lifecycle classifier, Task archival consumer and pipeline instructions inspected.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

1. Factor a read-only advance preparation seam from the existing owner, retaining its PASS/status/destination checks. Current Task spec pointers are updated narrowly, never historical Evidence Log references.
2. Preflight the canonical source/destination paths and ancestors using non-following filesystem checks: missing pair, mismatched IDs/current pointers, nonregular or symlink paths, outside-root targets, collisions, invalid dates, absent terminal PASS, or unchecked required Task Plan/spec completion items refuse before any mutation.
3. Use `classifyTaskLifecycle` and its date contract. Move the spec through existing advancement, set Task `status: done` plus completion date, archive under `completed/`, and update the spec's current Tasks pointer. Never check boxes or synthesize verification evidence.
4. Refuse AGREEMENT Tasks and any Task declared by an initiative before writes; their existing manual projection route remains supported. This initial command must not silently omit parent projections.
5. Validate the final pair and report its paths. A consistent already-completed pair is a safe no-op. Unexpected filesystem failure reports a nonzero error identifying the partial phase and paths; no power-failure atomicity or silent success is promised. Preserve original evidence and allow diagnosis/recovery through the existing manual owner route.
6. Route the Task README and the task-tracking/backlog-pipeline completion instructions to this command, removing duplicated manual steps for supported pairs. Preserve non-done terminal and initiative manual routes.
7. Prune the operational waiting instruction that requires starting another item merely to fill a wait. Require current delivery to remain the priority and distinguish notification from actual worker dispatch. The parent owns this narrow document edit.

## Affected Files

- `scripts/harness/gate.mjs`
- `scripts/harness/task-complete.mjs`
- `scripts/harness/__tests__/task-complete.test.mjs`
- `scripts/harness/gate-advance-contract.mjs` — existing advancement destination/pointer owner.
- `scripts/harness/__tests__/gate.test.mjs`, `scripts/harness/__tests__/gate-advance-contract.test.mjs`, `scripts/harness/__tests__/task-lifecycle.test.mjs` — unchanged regression coverage.
- `.agents/tasks/README.md`
- `.agents/skills/task-tracking/SKILL.md`
- `.agents/skills/backlog-pipeline/SKILL.md`
- `.agents/rules/operational.md` — parent-owned waiting/dispatch guidance only.
- This spec and its paired Task; subject-bound planning ledger only.

## Completion Criteria

- [x] TC-01: A real temporary-repository terminal-PASS pair completes with spec done, Task done/date/archived, and both current links resolving; existing manual advance regression is demonstrated before implementation.
- [x] TC-02: Missing or non-PASS evidence, mismatched pair, unchecked completion/Task Plan, invalid date, collision, outside-root and symlink inputs exit nonzero with source bytes and index unchanged.
- [x] TC-03: Historical Evidence Log path bytes remain unchanged; a fully consistent repeat is a no-op, and unexpected write failure exits nonzero with explicit partial-state diagnostics.
- [x] TC-04: Initiative/projection cases refuse before writes; supported completion documentation routes to one command while non-done/manual projection routes remain explicit; operational guidance forbids starting work merely to fill waits and requires actual dispatch for idle workers, without claiming runtime enforcement.
- [x] TC-05: Focused lifecycle/advance regression tests and native ESM syntax checks exit zero; no gate judging semantics or receipt/CI checks change.

## Test Plan

INFRA governance change: temporary-repository process/integration regression tests, not product scenarios.

| TC-ID | Test Type            | Tool / Approach                                           | Notes                                                                                                     |
| ----- | -------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| TC-01 | integration          | Vitest `scripts/harness/__tests__/task-complete.test.mjs` | Actual fixture files and canonical advance owner                                                          |
| TC-02 | negative integration | Vitest `scripts/harness/__tests__/task-complete.test.mjs` | Compare bytes and index before/after refusal                                                              |
| TC-03 | integration          | Vitest `scripts/harness/__tests__/task-complete.test.mjs` | Historical sentinel, repeat and injected filesystem failure                                               |
| TC-04 | contract             | Vitest `scripts/harness/__tests__/task-complete.test.mjs` | Initiative declarations and routing assertions                                                            |
| TC-05 | regression           | Focused Vitest and `node --check`                         | Final integrated gate after all completion artifacts and receipt closure, before push/merge; parent-owned |

## User Execution Test Scenarios

Not applicable.

**Reason:** This work changes only the repository's governance lifecycle machinery, not a shipped runtime capability, public SDK or end-user interaction. Maintenance-command fixtures are engineering verification, not product scenarios.

## Tasks

- [x] `.agents/tasks/completed/INFRA-168-complete-approved-task-and-spec-lifecycle-together.md` — implement the single completion-consistency batch.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → review-ready

- GATE-WRITE — File begins with `---` YAML frontmatter block: present
- GATE-WRITE — `status: draft` present in frontmatter: draft
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: INFRA
- GATE-WRITE — `tags:` field present in frontmatter: harness and governance
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): runAdvance leaves Task lifecycle unfinished and rewrites historical spec paths; source confirms global split/join
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): judged terminal-PASS pair with an active Task; historical old-path reference in Task
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: concrete multi-sentence Problem
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: present
- GATE-WRITE — Section is substantiated: explicit repository-local waiver states why canonical lifecycle owners, not external products, determine this contract
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present: reasoned waiver present; not a waiver of gate or lifecycle requirements
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision`: measured partial completion and historical rewrite support composition of existing owners instead of retaining manual steps
- GATE-WRITE — All 4 checklist items are `[x]`: four checked
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: names advancement, lifecycle classifier, archival consumer and instructions
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: two alternatives with explicit trade-offs
- GATE-WRITE — Decision references the trade-off that drove the choice: narrow L2 seam and partial-failure diagnostics accepted to remove inconsistent manual lifecycle handling
- GATE-WRITE — New-surface placement (conditional): internal harness maintenance command alongside existing gate and Task lifecycle owners; no new product/package/interface-family boundary; reuses shared owner semantics
- GATE-WRITE — Every item has a `TC-N` prefix: five TC-01 through TC-05
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: success, refusal, history/idempotence/failure, projection/routing and regression coverage each mapped
- GATE-WRITE — Each criterion uses Command form or Observable behavior form: observable final files/status/links, nonzero refusals with unchanged bytes/index, diagnostic and test results
- GATE-WRITE — No criterion uses vague completion language: none of the prohibited claims
- GATE-WRITE — `## Test Plan` section present: present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): five rows for five criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): all five specify fixture/integration or regression approach
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry: N/A: no manual test rows
- GATE-WRITE — Tasks section present with placeholder: exact active INFRA-168 Task path exists
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): empty before this first entry
- GATE-WRITE — No `## Status` or `## Classification` sections in the body: neither exists

**Independent semantic recommendation:** ENDORSE this bounded owner-based design. The existing global Task path replacement at runAdvance is an actual historical-evidence defect, so a read-only preparation seam is justified instead of wrapping it unchanged. Preconditions must complete before writes; terminal evidence is consumed, never manufactured; unsupported parent projections refuse explicitly. No judging criterion, approval threshold or receipt contract is relaxed. This is the initial plan judgement, not implementation verification.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-05

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "그 개선 작업 끝나면 또 개선해서 지금보다 빠른 작업 속도를 만들기 위해 3시간동안 작업한 세션로그를 확인해서 불필요한 진행이나 잘못된 하네스를 찾아서 개선해줘. 획기적으로 개발시간을 개선해줘"
**Given:** 2026-09-05, this conversation
**Review fingerprint:** d9e0c71d1c3a (review 614b51f5, type/tags 3024bc05)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-05, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (d9e0c71d1c3a) equals the document's current fingerprint

- GATE-APPROVAL — ordering: GATE-WRITE PASS exists and current status is review-ready in backlog; the independently judged initial recommendation is unchanged.
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: the current direct request expressly authorizes correcting the unnecessary or wrong harness found in the specified three-hour session audit, together with the direct immediate-correction/develop instruction recorded in the exact Task. This measured completion-lifecycle defect is that requested correction, not an unrelated feature or future standing class. Its narrow owner seam does not waive gate judgement or completion requirements.
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A, DIRECT route; no CLASS or unregistered delegated authority is asserted.
- GATE-APPROVAL — Independent architecture validation (conditional): the independent WRITE recommendation ENDORSE explicitly covers the internal command's placement beside the canonical gate and Task lifecycle owners. No new package, product surface or layer-family reclassification is introduced; an architecture fanout is not applicable.

**Judged at:** HEAD `1f060208552e` · base `origin/develop@1f060208552e` · document `.agents/spec-docs/backlog/INFRA-168-complete-approved-task-and-spec-lifecycle-together.md` blob `7e1964ffd32a` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-05

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "그 개선 작업 끝나면 또 개선해서 지금보다 빠른 작업 속도를 만들기 위해 3시간동안 작업한 세션로그를 확인해서 불필요한 진행이나 잘못된 하네스를 찾아서 개선해줘. 획기적으로 개발시간을 개선해줘"
**Given:** 2026-09-05, this conversation
**Review fingerprint:** 7e4191540eae (review 79908642, type/tags 3024bc05)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-05, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (7e4191540eae) equals the document's current fingerprint

- GATE-APPROVAL — ordering: original GATE-WRITE PASS retained, current review-ready state preserved; this is the final pre-checkpoint scope binding, not implementation recovery.
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: the same current direct audit-and-correct instruction covers this measured completion-management defect and the newly explicit operational wait/dispatch correction. Scope, Solution 7 and TC-04 identify the parent-owned document change; no extra product or future-item authority is inferred.
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A, DIRECT route; no delegated class is used.
- GATE-APPROVAL — Independent architecture validation (conditional): ENDORSE the final bounded recommendation. Existing lifecycle owners remain authoritative; operational.md remains the single wait-guidance owner. Requiring actual dispatch and forbidding filler work corrects the observed idle-notification failure without claiming external runtime enforcement. No package or product-family boundary is introduced, so new-surface fanout is N/A.

**Judged at:** HEAD `1f060208552e` · base `origin/develop@1f060208552e` · document `.agents/spec-docs/backlog/INFRA-168-complete-approved-task-and-spec-lifecycle-together.md` blob `388babd963fd` (untracked)

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-05

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : 1 path(s) outside the paired spec/Task: .agents/rules/operational.md
  **Required action:** commit, stash, or remove them before this gate

**Judged at:** HEAD `1f060208552e` · base `origin/develop@1f060208552e` · document `.agents/spec-docs/todo/INFRA-168-complete-approved-task-and-spec-lifecycle-together.md` blob `4c9552d8560c` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-05

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-05; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-168-complete-approved-task-and-spec-lifecycle-together.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-168-complete-approved-task-and-spec-lifecycle-together.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (5)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 271 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 3 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/INFRA-168-complete-approved-task-and-spec-lifecycle-together.md",
  "specPath": ".agents/spec-docs/todo/INFRA-168-complete-approved-task-and-spec-lifecycle-together.md",
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
    ".agents/loop-runs/user-execution-scenario.jsonl",
    ".agents/spec-docs/todo/INFRA-168-complete-approved-task-and-spec-lifecycle-together.md",
    ".agents/tasks/INFRA-168-complete-approved-task-and-spec-lifecycle-together.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged at:** HEAD `1f060208552e` · base `origin/develop@1f060208552e` · document `.agents/spec-docs/todo/INFRA-168-complete-approved-task-and-spec-lifecycle-together.md` blob `58cffe482e50` (untracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-05

**Command:** `node --input-type=module -e 'import {vitestInvocation} from "./scripts/harness/harness-vitest-process.mjs"; const r=vitestInvocation(process.cwd(),["scripts/harness/__tests__/task-complete.test.mjs","scripts/harness/__tests__/gate.test.mjs","scripts/harness/__tests__/gate-advance-contract.test.mjs","scripts/harness/__tests__/task-lifecycle.test.mjs"]); process.stdout.write(r.stdout??""); process.stderr.write(r.stderr??""); process.exit(r.status??1)'`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
RUN  v3.2.6 /private/tmp/robota-worktrees/struct012-s2

························································································································

 Test Files  4 passed (4)
      Tests  120 passed (120)
   Start at  20:46:45
   Duration  15.89s (transform 194ms, setup 0ms, collect 396ms, tests 16.70s, environment 0ms, prepare 101ms)

8:46:45 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.
```

**Judged at:** HEAD `c9b9a6b781a3` · base `origin/develop@1f060208552e` · document `.agents/spec-docs/active/INFRA-168-complete-approved-task-and-spec-lifecycle-together.md` blob `c0c7ce06871c` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-05

**Command:** `node --input-type=module -e 'import {vitestInvocation} from "./scripts/harness/harness-vitest-process.mjs"; const r=vitestInvocation(process.cwd(),["scripts/harness/__tests__/task-complete.test.mjs","scripts/harness/__tests__/gate.test.mjs","scripts/harness/__tests__/gate-advance-contract.test.mjs","scripts/harness/__tests__/task-lifecycle.test.mjs"]); process.stdout.write(r.stdout??""); process.stderr.write(r.stderr??""); process.exit(r.status??1)'`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
RUN  v3.2.6 /private/tmp/robota-worktrees/struct012-s2

························································································································

 Test Files  4 passed (4)
      Tests  120 passed (120)
   Start at  20:46:45
   Duration  15.89s (transform 194ms, setup 0ms, collect 396ms, tests 16.70s, environment 0ms, prepare 101ms)

8:46:45 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.
```

**Judged at:** HEAD `c9b9a6b781a3` · base `origin/develop@1f060208552e` · document `.agents/spec-docs/active/INFRA-168-complete-approved-task-and-spec-lifecycle-together.md` blob `a6b7fffa76bb` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-05

**Command:** `node --input-type=module -e 'import {vitestInvocation} from "./scripts/harness/harness-vitest-process.mjs"; const r=vitestInvocation(process.cwd(),["scripts/harness/__tests__/task-complete.test.mjs","scripts/harness/__tests__/gate.test.mjs","scripts/harness/__tests__/gate-advance-contract.test.mjs","scripts/harness/__tests__/task-lifecycle.test.mjs"]); process.stdout.write(r.stdout??""); process.stderr.write(r.stderr??""); process.exit(r.status??1)'`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
RUN  v3.2.6 /private/tmp/robota-worktrees/struct012-s2

························································································································

 Test Files  4 passed (4)
      Tests  120 passed (120)
   Start at  20:46:45
   Duration  15.89s (transform 194ms, setup 0ms, collect 396ms, tests 16.70s, environment 0ms, prepare 101ms)

8:46:45 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.
```

**Judged at:** HEAD `c9b9a6b781a3` · base `origin/develop@1f060208552e` · document `.agents/spec-docs/active/INFRA-168-complete-approved-task-and-spec-lifecycle-together.md` blob `3a81d24679dd` (modified)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-05

**Command:** `node --input-type=module -e 'import {vitestInvocation} from "./scripts/harness/harness-vitest-process.mjs"; const r=vitestInvocation(process.cwd(),["scripts/harness/__tests__/task-complete.test.mjs","scripts/harness/__tests__/gate.test.mjs","scripts/harness/__tests__/gate-advance-contract.test.mjs","scripts/harness/__tests__/task-lifecycle.test.mjs"]); process.stdout.write(r.stdout??""); process.stderr.write(r.stderr??""); process.exit(r.status??1)'`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
RUN  v3.2.6 /private/tmp/robota-worktrees/struct012-s2

························································································································

 Test Files  4 passed (4)
      Tests  120 passed (120)
   Start at  20:46:45
   Duration  15.89s (transform 194ms, setup 0ms, collect 396ms, tests 16.70s, environment 0ms, prepare 101ms)

8:46:45 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.
```

**Judged at:** HEAD `c9b9a6b781a3` · base `origin/develop@1f060208552e` · document `.agents/spec-docs/active/INFRA-168-complete-approved-task-and-spec-lifecycle-together.md` blob `55f57c87f9c2` (modified)

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-09-05

**Command:** `node --input-type=module -e 'import {vitestInvocation} from "./scripts/harness/harness-vitest-process.mjs"; const r=vitestInvocation(process.cwd(),["scripts/harness/__tests__/task-complete.test.mjs","scripts/harness/__tests__/gate.test.mjs","scripts/harness/__tests__/gate-advance-contract.test.mjs","scripts/harness/__tests__/task-lifecycle.test.mjs"]); process.stdout.write(r.stdout??""); process.stderr.write(r.stderr??""); process.exit(r.status??1)'`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
RUN  v3.2.6 /private/tmp/robota-worktrees/struct012-s2

························································································································

 Test Files  4 passed (4)
      Tests  120 passed (120)
   Start at  20:46:45
   Duration  15.89s (transform 194ms, setup 0ms, collect 396ms, tests 16.70s, environment 0ms, prepare 101ms)

8:46:45 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.
```

**Judged at:** HEAD `c9b9a6b781a3` · base `origin/develop@1f060208552e` · document `.agents/spec-docs/active/INFRA-168-complete-approved-task-and-spec-lifecycle-together.md` blob `05e3810bbee5` (modified)

### [GATE-VERIFY] — ❌ FAIL | 2026-09-05

**Status remains:** in-progress

- GATE-VERIFY — ordering: existing GATE-IMPLEMENT PASS and current in-progress state verified.
- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`): mechanically all three checked, but TC-04 routing completion is not substantively met; see INFRA-168-REVIEW-01 below.
- GATE-VERIFY — No Plan item is blocked or pending: FAIL, TC-04 has an unresolved existing-route omission. README Process line 113 directs done Tasks to a paired-spec-only command while spec-workflow.md lines 238–239 explicitly define L0 as having no spec. The removed manual done status/date/archive instructions were not retained for L0/no-spec Tasks; the initiative manual-route reference also points below to projection updates without the removed lifecycle steps.
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): N/A to product compilation, native repository ESM only; the affected modules successfully loaded in the actual focused test run, and author reports three native syntax checks passed. No full-gate result inferred.
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): `/tmp/infra168-final-focused.log` confirms four affected suites and 120 tests PASS in 15.89 seconds. Existing routing assertions only check command presence and partial-path wording and therefore do not cover the missing manual done route.

**INFRA-168-REVIEW-01 — SHOULD, correctness/documentation routing:** `.agents/tasks/README.md:113`. Preserve the existing successful manual done lifecycle for L0/no-paired-spec Tasks and unsupported initiative/projection cases in this owner document: set done and completion date, archive, update applicable parent projections in the same delivery commit. Keep the automatic command bounded to supported L1/L2 pairs. Add a routing assertion for that preserved path. This does not require expanding the command's API or adding another Task. Depth awaits the independent depth owner; no source changes were made by this guardian.

**Snapshot:** HEAD `c9b9a6b781a33712750678ff0292aa136e283f52` plus frozen implementation diff. Source SHA256: task-complete `73870d9f0eb454a4d516b8cad1f4b3859c3e53c34dd5b898df557f4bc9f3c3c8`; gate `112c64bbf180cd712d93a303850fd3238e6df635bd5199e2f4b2edee735a3445`; gate-advance-contract `825a2465b67f0475b7c9938056bed4c1210b769035422a6d37d56ce9d19123b7`. Remaining reviewed preflight, history, terminal-evidence and partial-failure implementation has no additional actionable finding in this review. Original prior evidence remains below unchanged.

### [GATE-VERIFY] — ✅ PASS | 2026-09-05

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — ordering: `[GATE-IMPLEMENT] — ✅ PASS | 2026-09-05` present (`approved → in-progress`); frontmatter `status: in-progress`; document lives in `.agents/spec-docs/active/` as spec-workflow.md maps `in-progress`. The five `[GATE-COMPLETE: TC-0N]` entries above are `gate.mjs record` evidence, carry no Status upgrade line, and changed no status; no GATE-COMPLETE verdict exists, so nothing this gate authorizes has already happened.
- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`): three Plan items (TC-01; TC-02, TC-03; TC-04, TC-05) all `[x]` in `.agents/tasks/INFRA-168-complete-approved-task-and-spec-lifecycle-together.md`; `task-plan-items` scan ✓ in the affected run.
- GATE-VERIFY — No Plan item is blocked or pending: no blocked/pending marker in `## Plan`. The prior FAIL's INFRA-168-REVIEW-01 (TC-04 dropped the manual done route) is resolved on the current tree: `.agents/tasks/README.md` § Process step 3 bounds `task-complete.mjs` to a "supported Task/spec pair" and sends initiative/projection cases to the manual route; the new "Manual done completion:" paragraph retains, for L0/no-spec work and initiative/projection cases, `gate.mjs advance` if a spec exists, Task `status: done` and `completed: YYYY-MM-DD`, `git mv` into `completed/`, and pointer/parent-projection updates in the same delivery commit. The command side stays bounded in `scripts/harness/task-complete.mjs` (refuses lane ≠ L1/L2, `type: AGREEMENT`, Tasks with `children`, Tasks declared by any initiative, mismatched pair). The routing assertion `task-complete.test.mjs > routes supported completion through one command and retains explicit manual recovery` now asserts `L0/no-spec`, `Manual done completion:` and `` `status: done` and `completed: YYYY-MM-DD` ``; `/tmp/infra168-manual-route-red.log` shows exactly that assertion failing (1 failed | 18 passed) before the README change and `/tmp/infra168-manual-route-green.log` 19 passed after it. Guardian re-run of that file: 19 passed (19), exit 0. No new actionable finding in the delta: `repointCurrentSpec` bounds re-pointing to `Spec:` / `## Bound spec document` above `## Evidence`; `prepareAdvance` is a read-only split of `runAdvance` with judging unchanged; skill/rule edits route to the README owner without duplicating it.
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): N/A as a package build — `git status --short` shows only `.agents/**` and `scripts/harness/**` paths, no `packages/*` or `apps/*`. Native ESM stand-in run by the guardian: `node --check` on `scripts/harness/task-complete.mjs`, `gate.mjs`, `gate-advance-contract.mjs` exit 0; `git diff --check` clean; `gate.mjs` 2559 lines (ceiling 2560). Build-shaped `node scripts/harness/run-all-scans.mjs --affected --context pr`: 66/68 ✓; the 2 ✗ are not this delta — `task-archival` names this very Task as "all 3 checkbox(es) checked but the spec has not reached spec-docs/done/ — run GATE-VERIFY/GATE-COMPLETE ... then archive" (the post-PASS handoff state, checked against the final state per the catalogue), and `work-run-measurement: invalid-closure-commit` reads receipts at the committed HEAD `c9b9a6b78` (docs-only planning checkpoint, no receipt closure yet), not the working tree — the parent-owned receipt-closure step before push.
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): no affected package; affected suites run by the guardian on the current tree — `pnpm exec vitest run scripts/harness/__tests__/task-complete.test.mjs scripts/harness/__tests__/gate.test.mjs scripts/harness/__tests__/gate-advance-contract.test.mjs scripts/harness/__tests__/task-lifecycle.test.mjs` → 4 files, 120 passed (120), 16.20s; `task-complete.test.mjs` alone → 19 passed (19), exit 0; the only other importer of the changed modules, `scripts/harness/__tests__/new-spec.test.mjs` → 42 passed (42), exit 0. Total 162 tests, 0 failures.

**Snapshot:** HEAD `c9b9a6b781a33712750678ff0292aa136e283f52` plus the uncommitted implementation diff; document blob `51628539116000a239b58ed57445ba8b07bb4ea6` (modified) hashed before this entry. Production SHA256 unchanged since the FAIL entry's Snapshot: task-complete `73870d9f0eb454a4d516b8cad1f4b3859c3e53c34dd5b898df557f4bc9f3c3c8`; gate `112c64bbf180cd712d93a303850fd3238e6df635bd5199e2f4b2edee735a3445`; gate-advance-contract `825a2465b67f0475b7c9938056bed4c1210b769035422a6d37d56ce9d19123b7`. Delta since FAIL is docs+test only: README `563e3bfb2144f193b9f88c35d0fa6a051f7a7922eaa06b3badcdd0ac0388af65`, task-complete.test `8b2e50accc8579aebe76aeb11092b4e5ac407ffbd6a9e6e2cb27373eb5834476`. The prior FAIL entry remains above unchanged. Status transition is the orchestrator's; this guardian changed nothing else.

### [GATE-COMPLETE] — ✅ PASS | 2026-09-05

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-09-05; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 5/5 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (5)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (5) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (5) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 5/5 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (5) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/INFRA-168-complete-approved-task-and-spec-lifecycle-together.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 3/3 tasks `[x]` in .agents/tasks/INFRA-168-complete-approved-task-and-spec-lifecycle-together.md

**Judged at:** HEAD `c9b9a6b781a3` · base `origin/develop@1f060208552e` · document `.agents/spec-docs/active/INFRA-168-complete-approved-task-and-spec-lifecycle-together.md` blob `db02062eb4a5` (modified)
