---
status: in-progress
type: INFRA
tags: [backlog-zero-migration]
lane: L2
---

# DOCS-053: terminalize stale completed backlog records

Paired with `.agents/tasks/DOCS-053-terminalize-stale-completed-backlog.md`.

## Problem

TOOL-006 remains actionable although its implementation is merged in PR #2040. HARNESS-130 remains
actionable while its exact scope is already tracked by canonical open issue #2410.

## Decision

Archive TOOL-006 as done with PR #2040 evidence and archive HARNESS-130 as skipped with a handoff to
issue #2410. Do not close the broader issue as part of this document-only batch.

## Approval and scope

This is document-only `BACKLOG-ZERO-MIGRATION` work under DOCS-029. No source, API, policy, CI, or
runtime changes are included.

## Completion Criteria

- [ ] TC-01: both records are terminal, with exact delivery/issue evidence and no root todo copy.

## Test Plan

Inspect PR #2040, issue #2410, and archived metadata; run repository scans and CI-like document
verification. Confirm no package or runtime path changes.

## User Execution Test Scenarios

Reason: not applicable because this batch only archives backlog documents and records existing delivery or
issue ownership; it changes no user-facing execution surface.
**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

## Tasks

- [ ] `.agents/tasks/DOCS-053-terminalize-stale-completed-backlog.md`
- [ ] TC-01: archive the two stale records with their evidence.

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Approval route:** `CLASS`
**Class:** `BACKLOG-ZERO-MIGRATION`
**Given:** 2026-08-29, this conversation
**Evidence condition met:** current PR/issue state was revalidated before selecting this batch.
**Instruction (verbatim):** "DOCS-029 승인함. BACKLOG-ZERO-MIGRATION 클래스를 등록하고, 2026-08-28 기준 기존 backlog를 GitHub issue로 이관하거나 이미 전달된 기록을 종결하는 문서 전용 배치를 자동 승인하도록 위임함. 패키지 소스/API/정책 변경은 제외."

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29

**Status upgrade:** approved → in-progress

- Task record: `.agents/tasks/DOCS-053-terminalize-stale-completed-backlog.md`.
- Subject-bound PLAN: `SCENARIO DRAFTED: not-applicable | 0` because this is document-only lifecycle work.
- Whole-worktree precondition: only the paired spec and Task changed at this checkpoint.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/DOCS-053-terminalize-stale-completed-backlog.md",
  "specPath": ".agents/spec-docs/todo/DOCS-053-terminalize-stale-completed-backlog.md",
  "taskItems": [{ "kind": "tc-id", "value": "TC-01" }],
  "plan": { "outcome": "not-applicable", "count": 0 },
  "worktreePaths": [
    ".agents/spec-docs/todo/DOCS-053-terminalize-stale-completed-backlog.md",
    ".agents/tasks/DOCS-053-terminalize-stale-completed-backlog.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->
