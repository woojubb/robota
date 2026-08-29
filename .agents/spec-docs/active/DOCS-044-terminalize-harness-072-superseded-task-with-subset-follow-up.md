---
status: in-progress
type: INFRA
tags: [docs]
lane: L2
---

# DOCS-044: Terminalize HARNESS-072 superseded task with subset follow-up

Paired with `.agents/tasks/DOCS-044-terminalize-harness-072-superseded-task-with-subset-follow-up.md`. Arising from [issue #2404](https://github.com/woojubb/robota/issues/2404).

## Problem

HARNESS-072 remains a root `todo` record although issue #1617 is closed and subsets 1–2 shipped.
Its explicitly documented subset 3 residual is now tracked by new canonical issue #2485. Leaving the
old record actionable would conflate the shipped work with the new unresolved scope.

<!-- Symptom and reproduction condition are recorded above. -->

## Prior Art Research

Waived: internal backlog lifecycle migration under the standing BACKLOG-ZERO-MIGRATION class.

## Architecture Review

### Affected Scope

.agents/tasks/HARNESS-072-nothing-detects-a-contradiction-between-two-rules.md
.agents/tasks/completed/DOCS-044-terminalize-harness-072-superseded-task-with-subset-follow-up.md

### Alternatives Considered

1. Keep HARNESS-072 as root todo. Pro: preserves history. Con: leaves a stale actionable duplicate.
2. Mark it skipped, link subset 3 to issue #2485, and archive it. Pro: canonicalizes ownership. Con:
   implementation must recreate a fresh Task from #2485.

### Decision

Choose alternative 2: it preserves the historical record while separating shipped subsets from the
unresolved subset 3 implementation.

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

1. Mark HARNESS-072 `skipped` with the exact issue #2485 handoff comment.
2. Move the record to `.agents/tasks/completed/` and update the paired DOCS-044 record.
3. Run lifecycle and citation scans plus CI-like verification.

## Affected Files

.agents/tasks/completed/HARNESS-072-nothing-detects-a-contradiction-between-two-rules.md
.agents/tasks/completed/DOCS-044-terminalize-harness-072-superseded-task-with-subset-follow-up.md

## Completion Criteria

- [ ] TC-01: HARNESS-072 has terminal metadata, exact issue-comment link, and archive destination.
- [ ] TC-02: `pnpm harness:scan` exits 0 with lifecycle and citation scans passing.
- [ ] TC-03: `pnpm harness:verify-like-ci` exits 0 without source/API/policy changes.

## Test Plan

| TC-ID | Test Type | Tool / Approach                         | Notes                         |
| ----- | --------- | --------------------------------------- | ----------------------------- |
| TC-01 | Document  | inspect archived Task and issue comment | terminalization evidence      |
| TC-02 | Suite     | `pnpm harness:scan`                     | lifecycle/citation regression |
| TC-03 | CI-like   | `pnpm harness:verify-like-ci`           | document-only verification    |

## User Execution Test Scenarios

Not applicable — internal backlog lifecycle documentation only; no user-facing behavior changes.

## Tasks

- [ ] `.agents/tasks/DOCS-044-terminalize-harness-072-superseded-task-with-subset-follow-up.md` — todo

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-29

The superseded original issue, shipped subset evidence, new subset 3 issue, and document-only scope are recorded.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** review-ready → approved
**Approval route:** `CLASS`
**Class:** `BACKLOG-ZERO-MIGRATION`
**Given:** 2026-08-29, this conversation; standing approval recorded in DOCS-029.
**Instruction (verbatim):** "DOCS-029 승인함. BACKLOG-ZERO-MIGRATION 클래스를 등록하고, 2026-08-28 기준 기존 backlog를 GitHub issue로 이관하거나 이미 전달된 기록을 종결하는 문서 전용 배치를 자동 승인하도록 위임함. 패키지 소스/API/정책 변경은 제외."
**Evidence condition met:** HARNESS-072 subset 3 handoff to issue #2485 is recorded; no source/API/policy changes are included.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-29; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/DOCS-044-terminalize-harness-072-superseded-task-with-subset-follow-up.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/DOCS-044-terminalize-harness-072-superseded-task-with-subset-follow-up.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task carries 3 checkbox tasks for 3 criteria
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 164 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/DOCS-044-terminalize-harness-072-superseded-task-with-subset-follow-up.md",
  "specPath": ".agents/spec-docs/todo/DOCS-044-terminalize-harness-072-superseded-task-with-subset-follow-up.md",
  "taskItems": [
    {
      "kind": "checkbox",
      "value": "Mark HARNESS-072 skipped with the exact issue-comment handoff."
    },
    {
      "kind": "checkbox",
      "value": "Move the record to completed archive and record the resolution."
    },
    {
      "kind": "checkbox",
      "value": "Run lifecycle, citation, and CI-like verification scans."
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/DOCS-044-terminalize-harness-072-superseded-task-with-subset-follow-up.md",
    ".agents/tasks/DOCS-044-terminalize-harness-072-superseded-task-with-subset-follow-up.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->
