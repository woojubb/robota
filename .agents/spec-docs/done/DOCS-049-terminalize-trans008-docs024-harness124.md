---
status: done
type: INFRA
tags: [backlog-zero-migration]
lane: L2
---

# DOCS-049: Terminalize completed and duplicate backlog records

Paired with `.agents/tasks/DOCS-049-terminalize-trans008-docs024-harness124.md`.

## Problem

TRANS-008 is a root `todo` record whose ingress fix landed in commit `05c4f99c5` (#2307). DOCS-024
is explicitly tracked by canonical issue #2049, and HARNESS-124 is tracked by canonical issue #2237.
Leaving these records actionable duplicates ownership or misstates completed work.

## Decision

Archive TRANS-008 as `completed` with implementation evidence. Archive DOCS-024 and HARNESS-124 as
`skipped` with exact canonical issue handoffs. Do not change package source, API, policy, CI, or runtime.

## Approval and scope

This is document-only `BACKLOG-ZERO-MIGRATION` work under DOCS-029.

## Completion Criteria

- [x] TRANS-008 has terminal completion metadata and commit evidence.
- [x] DOCS-024 and HARNESS-124 have exact handoff URLs and skipped status.
- [x] Scans verify archive placement and document-only scope.

## Test Plan

Inspect the three archived records and issue comments. Run `pnpm harness:scan` and
`pnpm harness:verify-like-ci` from the integration branch; no package or app path may change.

## User Execution Test Scenarios

Not applicable — backlog lifecycle only, with no new user-facing behavior.
**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`
Plan is not applicable because this batch changes only backlog lifecycle documents and introduces no user-facing behavior or scenario.

## Tasks

Paired Task: `.agents/tasks/DOCS-049-terminalize-trans008-docs024-harness124.md`

- [x] Archive TRANS-008 as completed with commit `05c4f99c5` evidence.
- [x] Archive DOCS-024 as skipped to issue #2049.
- [x] Archive HARNESS-124 as skipped to issue #2237.

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Approval route:** `CLASS`

**Class:** `BACKLOG-ZERO-MIGRATION`

**Given:** 2026-08-29, this conversation; standing DOCS-029 delegation.

**Instruction (verbatim):** "DOCS-029 승인함. BACKLOG-ZERO-MIGRATION 클래스를 등록하고, 2026-08-28 기준 기존 backlog를 GitHub issue로 이관하거나 이미 전달된 기록을 종결하는 문서 전용 배치를 자동 승인하도록 위임함. 패키지 소스/API/정책 변경은 제외."

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29

**Status upgrade:** approved → in-progress

Checkpoint spec: `.agents/spec-docs/active/DOCS-049-terminalize-trans008-docs024-harness124.md`

- GATE-IMPLEMENT — the paired Task exists at `.agents/tasks/DOCS-049-terminalize-trans008-docs024-harness124.md` and records `SCENARIO DRAFTED: not-applicable | 0`.
- GATE-IMPLEMENT — the worktree inventory is limited to this exact spec/Task pair; this is a whole-worktree document-only change.

<!-- checkpoint-evidence:v1:start -->
```json
{"version":1,"form":"gateImplementFirst","taskPath":".agents/tasks/DOCS-049-terminalize-trans008-docs024-harness124.md","specPath":".agents/spec-docs/todo/DOCS-049-terminalize-trans008-docs024-harness124.md","taskItems":[],"plan":{"outcome":"not-applicable","count":0},"worktreePaths":[".agents/spec-docs/todo/DOCS-049-terminalize-trans008-docs024-harness124.md",".agents/tasks/DOCS-049-terminalize-trans008-docs024-harness124.md"]}
```
<!-- checkpoint-evidence:v1:end -->

### [GATE-VERIFY] — ✅ PASS | 2026-08-29

The three records carry terminal metadata and exact evidence links; the final diff is document-only.
