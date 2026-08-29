---
status: in-progress
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

### [GATE-WRITE] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → review-ready
**Judged by:** self-assessment against `.agents/specs/gate-catalogue.md` § GATE-WRITE.

- GATE-WRITE — File begins with frontmatter: `---` block present
- GATE-WRITE — Draft status: `status: draft`
- GATE-WRITE — Allowed type: `type: INFRA`
- GATE-WRITE — Tags present: `[docs, migration]`
- GATE-WRITE — Concrete symptom: three resolved implementation Tasks remain `todo` at the root
- GATE-WRITE — Reproduction condition: root Task scan lists INFRA-138, HARNESS-058, and HARNESS-118 after their merged fixes
- GATE-WRITE — No vague problem statement: two concrete sentences and command reproduction
- GATE-WRITE — Prior Art Research section: present
- GATE-WRITE — Research substantiation: explicit BACKLOG-ZERO-MIGRATION waiver recorded
- GATE-WRITE — Waiver explicit: internal lifecycle ownership is named
- GATE-WRITE — Research feeds decision: prior delegated batches and current evidence select archival
- GATE-WRITE — Architecture checklist: all items checked
- GATE-WRITE — Sibling scan: explicit no-contract-change scope
- GATE-WRITE — Alternatives: three entries with Pro and Con
- GATE-WRITE — Decision trade-off: evidence-preserving archival versus stale queue retention
- GATE-WRITE — New-surface placement: N/A, no package/app/interface/layer added
- GATE-WRITE — Criteria prefixes: TC-01 through TC-03
- GATE-WRITE — Feature coverage: each terminalization and verification outcome is covered
- GATE-WRITE — Observable form: archive paths, statuses, and command exits are directly observable
- GATE-WRITE — Prohibited vague wording: absent
- GATE-WRITE — Test Plan: present
- GATE-WRITE — Test row count: three rows match TC-01 through TC-03
- GATE-WRITE — Test row fields: type and approach populated
- GATE-WRITE — Manual notes: no manual rows
- GATE-WRITE — Tasks section: paired Task path recorded
- GATE-WRITE — Evidence Log: first gate entry
- GATE-WRITE — Body status/classification sections: absent

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** review-ready → approved
**Approval route:** `CLASS`
**Class:** `BACKLOG-ZERO-MIGRATION`
**Instruction (verbatim):** "DOCS-029 승인함. BACKLOG-ZERO-MIGRATION 클래스를 등록하고, 2026-08-28 기준 기존 backlog를 GitHub issue로 이관하거나 이미 전달된 기록을 종결하는 문서 전용 배치를 자동 승인하도록 위임함. 패키지 소스/API/정책 변경은 제외."
**Given:** 2026-08-29, this conversation
**Evidence condition met:** Independent audits confirmed INFRA-138, HARNESS-058, and HARNESS-118 are already resolved by merged implementation PRs and canonical issue records; no source/API/policy changes are included.
**Review fingerprint:** 9572366fc294 (review 435c742d, type/tags a0d6c0d0)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (Independent audits confirmed INFRA-138, HARNESS-058, and HAR)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (9572366fc294) equals the document's current fingerprint

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-29; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/DOCS-041-terminalize-stale-resolved-backlog-batch-12.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/DOCS-041-terminalize-stale-resolved-backlog-batch-12.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task carries 3 checkbox tasks for 3 criteria
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 223 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 0 path(s), all within the paired spec/Task and .agents/loop-runs/
- GATE-IMPLEMENT — checkpoint binding: `.agents/spec-docs/todo/DOCS-041-terminalize-stale-resolved-backlog-batch-12.md`
- GATE-IMPLEMENT — checkpoint PLAN outcome: `SCENARIO DRAFTED: not-applicable | 0`
