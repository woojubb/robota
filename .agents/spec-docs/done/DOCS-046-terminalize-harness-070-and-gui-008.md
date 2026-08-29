---
status: done
type: INFRA
tags: [backlog-zero-migration]
lane: L2
---

# DOCS-046: Terminalize superseded HARNESS-070 and GUI-008

Paired with `.agents/tasks/DOCS-046-terminalize-harness-070-and-gui-008.md`.

## Problem

HARNESS-070 is partially superseded by canonical warning and ratchet issues [#2251](https://github.com/woojubb/robota/issues/2251) and [#2255](https://github.com/woojubb/robota/issues/2255), while
GUI-008 is an explicitly named repeated instance under ARCH-059 / issue [#2164](https://github.com/woojubb/robota/issues/2164). Keeping both root
records actionable duplicates ownership and obscures that implementation remains outstanding.

## Prior Art Research

Waived: document-only backlog lifecycle migration under standing `BACKLOG-ZERO-MIGRATION` approval.

## Decision

Archive both local records as `skipped` with exact issue-comment links. Do not mark either behavior
complete; the canonical issues remain responsible for implementation.

## Architecture Review

Not applicable to package architecture: this batch only changes backlog lifecycle ownership.

## Fallback & Degradation Declaration

None. No runtime, API, policy, or CI behavior is changed.

## Scope

Only `.agents/tasks/` lifecycle records and issue comments. No package source, API, policy, CI, or
runtime behavior changes.

## Completion Criteria

- [ ] Archived records contain terminal metadata and resolution rationale.
- [ ] Canonical issue comments identify the returned scope.
- [ ] Repository scans and CI-like document verification pass.

## Test Plan

- `pnpm harness:scan`
- `pnpm harness:verify-like-ci`
- Inspect diff for document-only scope.

## User Execution Test Scenarios

Not applicable — no user-facing behavior changes.

## Tasks

- `.agents/tasks/DOCS-046-terminalize-harness-070-and-gui-008.md`

## Evidence Log

### [GATE-APPROVAL] — ❌ FAIL | 2026-08-29

**Status remains:** draft
**Approval route:** `CLASS`
**Class:** `BACKLOG-ZERO-MIGRATION`
**Instruction (verbatim):** "DOCS-029 승인함. BACKLOG-ZERO-MIGRATION 클래스를 등록하고, 2026-08-28 기준 기존 backlog를 GitHub issue로 이관하거나 이미 전달된 기록을 종결하는 문서 전용 배치를 자동 승인하도록 위임함. 패키지 소스/API/정책 변경은 제외."
**Given:** 2026-08-29, this conversation
**Evidence condition met:** `git diff --name-only origin/develop...HEAD | rg '^(packages|apps)/' | wc -l` = `0`; three handoff comments were recorded at [#2251](https://github.com/woojubb/robota/issues/2251), [#2255](https://github.com/woojubb/robota/issues/2255), and [#2164](https://github.com/woojubb/robota/issues/2164).
**Review fingerprint:** f7deccebbb2d (review 1a633ef2, type/tags e5720b83)
**Failed criteria:**

- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: `**Evidence condition met:**` carries no command or number — an assertion, not a measurement: "Both dispositions are document-only and have exact canonical"
  **Required action:** record the command and its output

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `BACKLOG-ZERO-MIGRATION`
**Instruction (verbatim):** "DOCS-029 승인함. BACKLOG-ZERO-MIGRATION 클래스를 등록하고, 2026-08-28 기준 기존 backlog를 GitHub issue로 이관하거나 이미 전달된 기록을 종결하는 문서 전용 배치를 자동 승인하도록 위임함. 패키지 소스/API/정책 변경은 제외."
**Given:** 2026-08-29, this conversation
**Evidence condition met:** git diff package/app scope count is 0; three canonical issue handoff comments recorded.
**Review fingerprint:** f7deccebbb2d (review 1a633ef2, type/tags e5720b83)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (git diff package/app scope count is 0; three canonical issue)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (f7deccebbb2d) equals the document's current fingerprint

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-29

**Status remains:** draft
**Failed criteria:**

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: status is `draft`, `approved` expected
  **Required action:** run the prior gate to PASS first

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-29

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : 1 path(s) outside the paired spec/Task: .agents/spec-docs/active/DOCS-046-terminalize-harness-070-and-gui-008.md
  **Required action:** commit, stash, or remove them before this gate

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-29; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/DOCS-046-terminalize-harness-070-and-gui-008.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/DOCS-046-terminalize-harness-070-and-gui-008.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (0)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 198 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/DOCS-046-terminalize-harness-070-and-gui-008.md",
  "specPath": ".agents/spec-docs/todo/DOCS-046-terminalize-harness-070-and-gui-008.md",
  "taskItems": [],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/DOCS-046-terminalize-harness-070-and-gui-008.md",
    ".agents/tasks/DOCS-046-terminalize-harness-070-and-gui-008.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->
