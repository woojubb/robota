---
status: draft
type: INFRA
tags: [docs, migration]
lane: L2
---

# DOCS-041: Terminalize stale resolved backlog batch 12

Paired with `.agents/tasks/DOCS-041-terminalize-stale-resolved-backlog-batch-12.md`. Arising from [issue #2404](https://github.com/woojubb/robota/issues/2404).

## Problem

Three root Tasks remain actionable in the durable queue even though their premises are already resolved:
INFRA-138 was implemented by merged PR #2474 under INFRA-139; HARNESS-058 was implemented by merged
PR #1577 and returned on issue #1571; and HARNESS-118 was implemented by merged PR #2274 and returned
on issue #2248. Reproduction: `rg -l '^status: todo$' .agents/tasks -g '*.md'` still lists these
records at the root after their implementation owners are complete.

<!-- Symptom + reproduction condition: the command, the output that is wrong, and when it occurs.
     Replace the seed above if it does not name both. -->

## Prior Art Research

Waived: this is an internal backlog lifecycle migration governed by the registered
`BACKLOG-ZERO-MIGRATION` class; external product research cannot determine whether these repository
records are stale duplicates of their canonical implementation evidence.

## Architecture Review

### Affected Scope

Three root Task records and their completed archive destinations; this paired spec/Task; no package,
source, API, policy, workflow, skill, or product documentation files.

### Alternatives Considered

1. Leave all three root Tasks active.
   - Pro: preserves stale records.
   - Con: violates current issue/implementation ownership and keeps the queue non-zero falsely.
2. Mark them locally done without retaining canonical evidence.
   - Pro: removes the queue entries quickly.
   - Con: loses the reason and can falsely claim implementation ownership.
3. Archive with evidence-preserving terminal dispositions.
   - Pro: removes stale entries while preserving supersession/merged-PR provenance.
   - Con: requires exact status, date, and path updates.

### Decision

Choose alternative 3. The delegated class permits document-only archival when current evidence proves
the implementation is already delivered; preserving the exact evidence avoids converting stale queue
cleanup into an unearned completion claim.

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

1. Add resolution evidence and terminal metadata to INFRA-138, HARNESS-058, and HARNESS-118.
2. Move all three atomically to `.agents/tasks/completed/`.
3. Run lifecycle/citation/delegation scans and full harness verification.

## Affected Files

`.agents/tasks/completed/INFRA-138-gate-judges-accept-archived-tasks-as-active.md`
`.agents/tasks/completed/HARNESS-058-verify-like-ci-cannot-go-green-in-a-worktree.md`
`.agents/tasks/completed/HARNESS-118-citations-of-a-task-record-path-are-not-re-derived-when-the-record-moves-is-rena.md`
`.agents/tasks/completed/DOCS-041-terminalize-stale-resolved-backlog-batch-12.md`
`.agents/spec-docs/done/DOCS-041-terminalize-stale-resolved-backlog-batch-12.md`

## Completion Criteria

- [ ] TC-01: all three Tasks are archived with terminal metadata and resolution evidence.
- [ ] TC-02: `pnpm harness:scan` exits 0 with lifecycle and citation scans passing.
- [ ] TC-03: `pnpm harness:verify-like-ci` exits 0 without source/API/policy changes.

## Test Plan

| TC-ID | Test Type | Tool / Approach                            | Notes                                       |
| ----- | --------- | ------------------------------------------ | ------------------------------------------- |
| TC-01 | Document  | Task metadata and merged-PR/issue evidence | Exact three-unit manifest and archive paths |
| TC-02 | Suite     | `pnpm harness:scan`                        | Lifecycle/citation/delegation regression    |
| TC-03 | CI-like   | `pnpm harness:verify-like-ci`              | Full repository verification                |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/DOCS-041-terminalize-stale-resolved-backlog-batch-12.md` — todo

## Evidence Log
