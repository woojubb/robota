---
status: approved
type: INFRA
tags: [backlog-zero-migration]
lane: L2
---

# DOCS-048: Terminalize duplicate architecture-document backlog records

Paired with `.agents/tasks/DOCS-048-terminalize-docs-022-and-023.md`.

## Problem

DOCS-022 and DOCS-023 remain root `todo` records even though their still-valid architecture-map and
project-structure drift is explicitly tracked by canonical GitHub [issue #2049](https://github.com/woojubb/robota/issues/2049),
which names DOCS-022/023/024 in its scope. Keeping the local records actionable creates duplicate
ownership in the durable queue.

## Decision

Skip and archive both legacy records with the exact canonical issue-comment handoff. Do not claim the
underlying documentation work complete; recreate fresh Tasks from [issue #2049](https://github.com/woojubb/robota/issues/2049) when implementation begins.

## Approval and scope

This is a document-only `BACKLOG-ZERO-MIGRATION` disposition under the standing DOCS-029 delegation.
It changes only backlog lifecycle records and records an issue handoff. Package source, API, policy,
CI, and runtime files are out of scope.

## Completion Criteria

- [x] DOCS-022 and DOCS-023 carry terminal metadata, rationale, and exact handoff URL.
- [x] Canonical issue #2049 records returned ownership for both legacy records.
- [x] Archived paths and document-only scope are verified by repository checks.

## Test Plan

- Inspect the two archived records and exact issue comment.
- Run `pnpm harness:scan` and `pnpm harness:verify-like-ci` from the integration branch.
- Confirm the diff contains only `.agents/tasks/` and `.agents/spec-docs/` lifecycle documents.

## User Execution Test Scenarios

Not applicable — this is an internal backlog lifecycle migration with no user-facing behavior change.
**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

## Tasks

- [x] Archive `.agents/tasks/DOCS-022-architecture-map-refresh-sweep.md`.
- [x] Archive `.agents/tasks/DOCS-023-project-structure-correction-batch.md`.
- [x] Record the canonical handoff on issue #2049.

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Approval route:** `CLASS`

**Instruction (verbatim):** "DOCS-029 승인함. BACKLOG-ZERO-MIGRATION 클래스를 등록하고, 2026-08-28 기준 기존 backlog를 GitHub issue로 이관하거나 이미 전달된 기록을 종결하는 문서 전용 배치를 자동 승인하도록 위임함. 패키지 소스/API/정책 변경은 제외."
**Instruction (verbatim):** "레포 속 규칙대로 모두 너가 판단하고 레포 속 규칙을 기반으로 선택하기 어려운 것만 나에게 요청하며 모든 작업을 진행하며 마지막까지 완료해줘"

Standing `BACKLOG-ZERO-MIGRATION` approval in DOCS-029 applies: the disposition is document-only,
and the package/app diff is empty.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29

The paired spec and Task were created; the worktree inventory is limited to these records and the
two archived legacy Tasks. No source, API, policy, CI, or runtime path was changed.

### [GATE-VERIFY] — ✅ PASS | 2026-08-29

The archived records contain `status: skipped`, `completed: 2026-08-29`, and the exact canonical
handoff URL. Full repository verification is the integration-branch completion gate.
