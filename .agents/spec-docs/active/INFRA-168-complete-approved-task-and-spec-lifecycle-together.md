---
status: in-progress
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
- Existing `scripts/harness/__tests__/gate*.test.mjs` advancement regression owner, if needed.
- `.agents/tasks/README.md`
- `.agents/skills/task-tracking/SKILL.md`
- `.agents/skills/backlog-pipeline/SKILL.md`
- `.agents/rules/operational.md` — parent-owned waiting/dispatch guidance only.
- This spec and its paired Task; subject-bound planning ledger only.

## Completion Criteria

- [ ] TC-01: A real temporary-repository terminal-PASS pair completes with spec done, Task done/date/archived, and both current links resolving; existing manual advance regression is demonstrated before implementation.
- [ ] TC-02: Missing or non-PASS evidence, mismatched pair, unchecked completion/Task Plan, invalid date, collision, outside-root and symlink inputs exit nonzero with source bytes and index unchanged.
- [ ] TC-03: Historical Evidence Log path bytes remain unchanged; a fully consistent repeat is a no-op, and unexpected write failure exits nonzero with explicit partial-state diagnostics.
- [ ] TC-04: Initiative/projection cases refuse before writes; supported completion documentation routes to one command while non-done/manual projection routes remain explicit; operational guidance forbids starting work merely to fill waits and requires actual dispatch for idle workers, without claiming runtime enforcement.
- [ ] TC-05: Focused lifecycle/advance regression tests and native ESM syntax checks exit zero; no gate judging semantics or receipt/CI checks change.

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

- [ ] `.agents/tasks/INFRA-168-complete-approved-task-and-spec-lifecycle-together.md` — implement the single completion-consistency batch.

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
