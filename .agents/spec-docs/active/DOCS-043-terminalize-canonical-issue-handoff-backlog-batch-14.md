---
status: in-progress
type: INFRA
tags: [docs]
lane: L2
---

# DOCS-043: Terminalize canonical issue handoff backlog batch 14

Paired with `.agents/tasks/DOCS-043-terminalize-canonical-issue-handoff-backlog-batch-14.md`. Arising from [issue #2404](https://github.com/woojubb/robota/issues/2404).

## Problem

RULE-015 and CLI-083 remain actionable local records while their unresolved residuals are tracked by
canonical open issues #2391 and #2295. Keeping them in the root queue duplicates issue ownership.
Reproduction: both root Task records still have non-terminal statuses although handoff comments now
record the issue as the source of truth.

<!-- Symptom + reproduction condition recorded above. -->

## Prior Art Research

Waived: internal backlog lifecycle migration under the standing BACKLOG-ZERO-MIGRATION class; external
product research cannot determine whether a local Task duplicates its canonical GitHub issue.

## Architecture Review

### Affected Scope

.agents/tasks/RULE-015-grounds-are-recorded-where-the-work-is.md
.agents/tasks/CLI-083-the-org-policy-loader-has-no-caller-so-four-enforcement-sites-are-unreachable-in-the-shipped-product.md
.agents/tasks/completed/DOCS-043-terminalize-canonical-issue-handoff-backlog-batch-14.md

### Alternatives Considered

1. Keep both Tasks as root records.
   - Pro: preserves original queue locations.
   - Con: duplicates canonical issue work and leaves stale actionable entries.
2. Mark both skipped, record exact issue handoff links, and archive them.
   - Pro: issue queue becomes canonical while evidence remains auditable.
   - Con: implementation must recreate a fresh Task when an issue is selected.

### Decision

Choose alternative 2: it removes duplicate actionable records without claiming that either issue is
implemented or resolved.

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

1. Add `status: skipped`, `returned_to_issue`, and a resolution section to RULE-015 and CLI-083.
2. Move both records to `.agents/tasks/completed/` and preserve their issue-comment evidence.
3. Run lifecycle, citation, and CI-like verification scans.

## Affected Files

.agents/tasks/completed/RULE-015-grounds-are-recorded-where-the-work-is.md
.agents/tasks/completed/CLI-083-the-org-policy-loader-has-no-caller-so-four-enforcement-sites-are-unreachable-in-the-shipped-product.md
.agents/tasks/completed/DOCS-043-terminalize-canonical-issue-handoff-backlog-batch-14.md

## Completion Criteria

- [ ] TC-01: both archived Tasks have terminal metadata and exact issue-comment links.
- [ ] TC-02: `pnpm harness:scan` exits 0 with lifecycle and citation scans passing.
- [ ] TC-03: `pnpm harness:verify-like-ci` exits 0 without source/API/policy changes.

## Test Plan

| TC-ID | Test Type | Tool / Approach                             | Notes                             |
| ----- | --------- | ------------------------------------------- | --------------------------------- |
| TC-01 | Document  | inspect archived Task metadata and comments | terminalization evidence          |
| TC-02 | Suite     | `pnpm harness:scan`                         | lifecycle and citation regression |
| TC-03 | CI-like   | `pnpm harness:verify-like-ci`               | document-only verification        |

## User Execution Test Scenarios

Not applicable — internal backlog lifecycle documentation only; no user-facing behavior changes.

## Tasks

- [ ] `.agents/tasks/DOCS-043-terminalize-canonical-issue-handoff-backlog-batch-14.md` — todo

## Migration Manifest

| Unit     | Current Task                                                                                                                    | Canonical issue / evidence                                                                   | Disposition          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------- |
| RULE-015 | `.agents/tasks/RULE-015-grounds-are-recorded-where-the-work-is.md`                                                              | [issue #2391 comment](https://github.com/woojubb/robota/issues/2391#issuecomment-5460534894) | skipped and archived |
| CLI-083  | `.agents/tasks/CLI-083-the-org-policy-loader-has-no-caller-so-four-enforcement-sites-are-unreachable-in-the-shipped-product.md` | [issue #2295 comment](https://github.com/woojubb/robota/issues/2295#issuecomment-5460534959) | skipped and archived |

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-29

The duplicate-root symptom, canonical issue handoffs, migration manifest, alternatives, and document-only scope are recorded.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** review-ready → approved
**Approval route:** `CLASS`
**Class:** `BACKLOG-ZERO-MIGRATION`
**Instruction (verbatim):** "DOCS-029 승인함. BACKLOG-ZERO-MIGRATION 클래스를 등록하고, 2026-08-28 기준 기존 backlog를 GitHub issue로 이관하거나 이미 전달된 기록을 종결하는 문서 전용 배치를 자동 승인하도록 위임함. 패키지 소스/API/정책 변경은 제외."
**Evidence condition:** RULE-015 → issue #2391 and CLI-083 → issue #2295 handoff comments are recorded; no source/API/policy changes are included.

### [GATE-WRITE] — ✅ PASS | 2026-08-29

The concrete duplicate-root symptom, canonical open issue links, and archive alternative are recorded.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** review-ready → approved
**Approval route:** `CLASS`
**Class:** `BACKLOG-ZERO-MIGRATION`
**Instruction (verbatim):** "DOCS-029 승인함. BACKLOG-ZERO-MIGRATION 클래스를 등록하고, 2026-08-28 기준 기존 backlog를 GitHub issue로 이관하거나 이미 전달된 기록을 종결하는 문서 전용 배치를 자동 승인하도록 위임함. 패키지 소스/API/정책 변경은 제외."
**Evidence condition:** RULE-015 and CLI-083 handoff comments are recorded above; no implementation changes are included.

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-29

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : 1 path(s) outside the paired spec/Task: .agents/spec-docs/active/DOCS-043-terminalize-canonical-issue-handoff-backlog-batch-14.md
  **Required action:** commit, stash, or remove them before this gate

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-29; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/DOCS-043-terminalize-canonical-issue-handoff-backlog-batch-14.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/DOCS-043-terminalize-canonical-issue-handoff-backlog-batch-14.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task carries 3 checkbox tasks for 3 criteria
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 200 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/DOCS-043-terminalize-canonical-issue-handoff-backlog-batch-14.md",
  "specPath": ".agents/spec-docs/todo/DOCS-043-terminalize-canonical-issue-handoff-backlog-batch-14.md",
  "taskItems": [
    {
      "kind": "checkbox",
      "value": "Mark both Tasks skipped with exact returned-to-issue links."
    },
    {
      "kind": "checkbox",
      "value": "Move both records to completed archive and record resolutions."
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
    ".agents/spec-docs/todo/DOCS-043-terminalize-canonical-issue-handoff-backlog-batch-14.md",
    ".agents/tasks/DOCS-043-terminalize-canonical-issue-handoff-backlog-batch-14.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->
