---
status: done
type: INFRA
tags: [backlog-zero-migration]
lane: L2
---

# DOCS-047: Terminalize HARNESS-089 and TEST-012 duplicate records

Paired with `.agents/tasks/DOCS-047-terminalize-harness-089-and-test-012.md`.

## Problem

HARNESS-089's guard blind-spot work is explicitly inside the open architecture-contract tracker
#2049, and TEST-012 is the task record for the host-state defect already owned by open issue #2300.
Keeping both local records actionable duplicates ownership while their implementation remains open.

## Prior Art Research

Waived: document-only backlog lifecycle migration under standing `BACKLOG-ZERO-MIGRATION` approval.

## Architecture Review

Not applicable: no package or runtime design is changed; only backlog ownership records move.

## Decision

Return each unresolved scope to its canonical issue, mark the local duplicate `skipped`, and archive it.

## Fallback & Degradation Declaration

None. No source, API, policy, CI, or runtime behavior changes.

## Completion Criteria

- [ ] Both archived records contain terminal metadata and exact handoff links.
- [ ] Canonical issue comments identify the returned implementation scope.
- [ ] Repository scans and CI-like document verification pass.

## Test Plan

- `pnpm harness:scan`
- `pnpm harness:verify-like-ci`
- Inspect the final diff for document-only scope.

## User Execution Test Scenarios

Not applicable — no user-facing behavior changes.

## Tasks

- `.agents/tasks/DOCS-047-terminalize-harness-089-and-test-012.md`

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `BACKLOG-ZERO-MIGRATION`
**Instruction (verbatim):** "DOCS-029 승인함. BACKLOG-ZERO-MIGRATION 클래스를 등록하고, 2026-08-28 기준 기존 backlog를 GitHub issue로 이관하거나 이미 전달된 기록을 종결하는 문서 전용 배치를 자동 승인하도록 위임함. 패키지 소스/API/정책 변경은 제외."
**Given:** 2026-08-29, this conversation
**Evidence condition met:** git diff package/app scope count is 0; canonical handoff comments recorded on issues #2049 and #2300.
**Review fingerprint:** 1293e103e143 (review a55607d9, type/tags e5720b83)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (git diff package/app scope count is 0; canonical handoff com)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (1293e103e143) equals the document's current fingerprint

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-29

**Status remains:** draft
**Failed criteria:**

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: status is `draft`, `approved` expected
  **Required action:** run the prior gate to PASS first

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-29; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/DOCS-047-terminalize-harness-089-and-test-012.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/DOCS-047-terminalize-harness-089-and-test-012.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (0)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 197 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/DOCS-047-terminalize-harness-089-and-test-012.md",
  "specPath": ".agents/spec-docs/todo/DOCS-047-terminalize-harness-089-and-test-012.md",
  "taskItems": [],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/DOCS-047-terminalize-harness-089-and-test-012.md",
    ".agents/tasks/DOCS-047-terminalize-harness-089-and-test-012.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->
