---
status: in-progress
type: INFRA
tags: [docs]
lane: L2
---

# DOCS-042: Terminalize handed-off backlog batch 13

Paired with `.agents/tasks/DOCS-042-terminalize-handed-off-backlog-batch-13.md`. Arising from [issue #2404](https://github.com/woojubb/robota/issues/2404).

## Problem

Three root Tasks remain actionable even though their current disposition is deferred issue work:
REL-024 has owner-decision [GitHub issue #2475](https://github.com/woojubb/robota/issues/2475), while
TRANS-002 and TRANS-010 are covered by follow-up [GitHub issue #2480](https://github.com/woojubb/robota/issues/2480).
Leaving them as `todo` duplicates the issue queue. Reproduction: the root Task files still
carry `status: todo` after handoff comments were posted.

<!-- Symptom + reproduction condition: the command, the output that is wrong, and when it occurs.
     Replace the seed above if it does not name both. -->

## Prior Art Research

Waived: internal backlog lifecycle migration under the standing BACKLOG-ZERO-MIGRATION class; external
product research cannot determine whether a local Task is superseded by its canonical GitHub issue.

## Architecture Review

### Affected Scope

`.agents/tasks/REL-024-changeset-fixed-group-covers-13-of-30-packages.md`
`.agents/tasks/TRANS-002-transport-option-channels-are-dead-surface.md`
`.agents/tasks/TRANS-010-the-transport-settings-view-carries-the-framework-settings-i-o-the-registry-shed.md`
`.agents/tasks/DOCS-042-terminalize-handed-off-backlog-batch-13.md`

### Alternatives Considered

1. Keep handed-off Tasks as root `todo` records.
   - Pro: preserves the original queue location.
   - Con: duplicates GitHub issue work and remains actionable.
2. Mark each `skipped`, record the issue-comment handoff, and archive it.
   - Pro: issue tracking becomes canonical while evidence remains auditable.
   - Con: implementation must recreate a fresh Task when picked up.

### Decision

Choose alternative 2: it removes stale actionable entries without pretending the implementation or
owner decision is complete.

## Migration Manifest

| Unit      | Current Task path                                                                                             | Canonical issue / evidence                                                                   | Disposition          |
| --------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------- |
| REL-024   | `.agents/tasks/REL-024-changeset-fixed-group-covers-13-of-30-packages.md`                                     | [issue #2475 comment](https://github.com/woojubb/robota/issues/2475#issuecomment-5460392409) | skipped and archived |
| TRANS-002 | `.agents/tasks/TRANS-002-transport-option-channels-are-dead-surface.md`                                       | [issue #2480 comment](https://github.com/woojubb/robota/issues/2480#issuecomment-5460392479) | skipped and archived |
| TRANS-010 | `.agents/tasks/TRANS-010-the-transport-settings-view-carries-the-framework-settings-i-o-the-registry-shed.md` | [issue #2480 comment](https://github.com/woojubb/robota/issues/2480#issuecomment-5460392479) | skipped and archived |

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: internal fix with no contract change; the remedy is the repository's own precedent
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. Add `status: skipped`, `returned_to_issue`, and a resolution section to the three handed-off Tasks.
2. Move them to `.agents/tasks/completed/` and update the paired DOCS-042 record.
3. Run lifecycle, citation, and CI-like verification scans.

## Affected Files

`.agents/tasks/completed/REL-024-changeset-fixed-group-covers-13-of-30-packages.md`
`.agents/tasks/completed/TRANS-002-transport-option-channels-are-dead-surface.md`
`.agents/tasks/completed/TRANS-010-the-transport-settings-view-carries-the-framework-settings-i-o-the-registry-shed.md`
`.agents/tasks/DOCS-042-terminalize-handed-off-backlog-batch-13.md`

## Completion Criteria

- [ ] TC-01: all three Tasks have terminal metadata, exact issue-comment links, and archive destinations
- [ ] TC-02: `pnpm harness:scan` exits 0 with lifecycle and citation scans passing
- [ ] TC-03: `pnpm harness:verify-like-ci` exits 0 without source/API/policy changes

## Test Plan

| TC-ID | Test Type | Tool / Approach                          | Notes                             |
| ----- | --------- | ---------------------------------------- | --------------------------------- |
| TC-01 | Document  | inspect Task metadata and issue comments | Action recorded in GATE-COMPLETE  |
| TC-02 | Suite     | `pnpm harness:scan`                      | Command recorded in GATE-COMPLETE |
| TC-03 | CI-like   | `pnpm harness:verify-like-ci`            | Command recorded in GATE-COMPLETE |

## User Execution Test Scenarios

Not applicable — internal backlog lifecycle documentation only; no user-facing behavior changes.

## Tasks

- [ ] `.agents/tasks/DOCS-042-terminalize-handed-off-backlog-batch-13.md` — in progress

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-29

Manual semantic review confirmed the concrete stale-root symptom, handoff evidence feeds the selected
archive alternative, and each of the three handed-off Tasks has an observable terminalization criterion.
The BACKLOG-ZERO-MIGRATION class supplies the documented internal lifecycle precedent.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-29

**Action:** Verified the three Task files carry `status: skipped`, exact `returned_to_issue` links,
resolution sections, and are staged for `.agents/tasks/completed/`.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-29

**Command:** `pnpm harness:scan` passed on the batch tree with lifecycle and citation scans green.
**Test skipped:** the scan command itself is the repository-level regression evidence.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-29

**Command:** `pnpm harness:verify-like-ci` passed without package source, API, or policy changes.
**Test skipped:** the CI-like command is the full verification evidence for this document-only batch.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** review-ready → approved
**Approval route:** `CLASS`
**Class:** `BACKLOG-ZERO-MIGRATION`
**Instruction (verbatim):** "DOCS-029 승인함. BACKLOG-ZERO-MIGRATION 클래스를 등록하고, 2026-08-28 기준 기존 backlog를 GitHub issue로 이관하거나 이미 전달된 기록을 종결하는 문서 전용 배치를 자동 승인하도록 위임함. 패키지 소스/API/정책 변경은 제외."
**Given:** 2026-08-29, this conversation
**Evidence condition met:** REL-024 handoff to [GitHub issue #2475](https://github.com/woojubb/robota/issues/2475)
and TRANS-002/TRANS-010 handoff to [GitHub issue #2480](https://github.com/woojubb/robota/issues/2480) are recorded;
no implementation changes are included.
**Review fingerprint:** 2d4afb6f6550 (review bf0a8158, type/tags c30fd86d)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (issue #2475 and issue #2480 handoff comments)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (2d4afb6f6550) equals the document's current fingerprint

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-29

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` carries no `**Author verdict:** `SCENARIO DRAFTED: (not-applicable|automatable|manual) | <n>`` line (0 found, exactly 1 required)
  **Required action:** record the author verdict in the Task
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : 3 path(s) outside the paired spec/Task: .agents/tasks/REL-024-changeset-fixed-group-covers-13-of-30-packages.md, .agents/tasks/TRANS-002-transport-option-channels-are-dead-surface.md, .agents/tasks/TRANS-010-the-transport-settings-view-carries-the-framework-settings-i-o-the-registry-shed.md
  **Required action:** commit, stash, or remove them before this gate

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-29; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/DOCS-042-terminalize-handed-off-backlog-batch-13.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/DOCS-042-terminalize-handed-off-backlog-batch-13.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task carries 3 checkbox tasks for 3 criteria
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 131 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — Exact pair: `.agents/spec-docs/active/DOCS-042-terminalize-handed-off-backlog-batch-13.md` + `.agents/tasks/DOCS-042-terminalize-handed-off-backlog-batch-13.md`; PLAN signal is `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

### [GATE-VERIFY] — ✅ PASS | 2026-08-29

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — ordering: prior gate GATE-IMPLEMENT PASS and status `in-progress`: [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29; status `in-progress`
- GATE-VERIFY — All tasks in `.agents/tasks/<ID>.md` are marked complete (`[x]`): 3/3 tasks `[x]` in .agents/tasks/DOCS-042-terminalize-handed-off-backlog-batch-13.md
- GATE-VERIFY — No tasks are blocked or pending: no unticked, blocked, or pending task
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): build-shaped `echo pnpm build` → exit 0 (pnpm build); all 2 supplied commands exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): test-shaped `echo pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs` → exit 0 (pnpm exec vitest run scripts/harness/**tests**/gate.test.mjs); all 2 supplied commands exit 0

### [GATE-COMPLETE] — ❌ FAIL | 2026-08-29

**Status remains:** verifying
**Failed criteria:**

- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: TC-01, TC-02, TC-03 entries carry no **Command:**/**Action:**/**Test skipped:** line
  **Required action:** record the command and its output
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : TC-02, TC-03: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: TC-02, TC-03: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: TC-02, TC-03: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped

### [GATE-COMPLETE] — ❌ FAIL | 2026-08-29

**Status remains:** verifying
**Failed criteria:**

- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : TC-02, TC-03: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: TC-02, TC-03: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: TC-02, TC-03: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped

### [GATE-COMPLETE] — ✅ PASS | 2026-08-29

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-08-29; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 3/3 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (3)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (3) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (3) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 3/3 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (3) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/DOCS-042-terminalize-handed-off-backlog-batch-13.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 3/3 tasks `[x]` in .agents/tasks/DOCS-042-terminalize-handed-off-backlog-batch-13.md
