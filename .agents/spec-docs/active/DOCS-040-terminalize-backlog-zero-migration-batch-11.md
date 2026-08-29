---
status: in-progress
type: INFRA
tags: [docs, migration]
lane: L2
---

# DOCS-040: Terminalize backlog-zero migration batch 11

Paired with `.agents/tasks/DOCS-040-terminalize-backlog-zero-migration-batch-11.md`. Arising from [issue #2404](https://github.com/woojubb/robota/issues/2404).

## Problem

TRANS-003, TRANS-004, and HARNESS-087 are unchanged legacy root Tasks whose implementation ownership is already represented by current OPEN GitHub issues. Keeping both records creates duplicate durable queue entries. Reproduction: `rg -n 'TRANS-003|TRANS-004|HARNESS-087' .agents/tasks packages scripts` still finds the stale root records while issue #2164 owns the two protocol gaps and issue #2325 owns the measurement-ledger gap.

## Prior Art Research

Waived: the registered `BACKLOG-ZERO-MIGRATION` class and completed batches 01–10 define the body-preserving issue handoff and archival mechanism. This batch changes no source, API, policy, workflow, hook, skill, topology, or product documentation path.

## Architecture Review

### Affected Scope

- Three fixed-population Task records: TRANS-003, TRANS-004, HARNESS-087.
- Their paired DOCS-040 spec/Task and one loop-run ledger record.
- No package carrier links; no source/API files.

### Alternatives Considered

1. Leave duplicate root Tasks active.
   - Pro: no document edits.
   - Con: contradicts canonical issue ownership and preserves a duplicate queue.
2. Declare implementation complete locally.
   - Pro: removes queue entries.
   - Con: false because all three premises remain observable and implementation issues are OPEN.
3. Hand off to canonical issues and archive local duplicates.
   - Pro: preserves unfinished ownership and removes only duplicate durable records.
   - Con: requires three append-only issue comments and exact body-preserving archival.

### Decision

Choose alternative 3. Current develop blobs equal the fixed population; issue #2164 is OPEN/unassigned and explicitly covers TRANS-003/004, while issue #2325 is OPEN/unassigned for HARNESS-087. Independent audits found no competing PR, branch, worktree, or assignee. The batch is three units and six final paths, within the delegated class ceiling.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — no contract change or package carrier
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: N/A — documentation-only archival

## Fallback & Degradation Declaration

None.

## Solution

1. Append canonical handoff comments to issue #2164 (twice) and issue #2325.
2. Mark each Task `status: skipped`, add exact `completed: 2026-08-29` and `returned_to_issue` URL, and move it atomically to `.agents/tasks/completed/` without changing its body.
3. Mark criteria complete only after focused scans, `pnpm harness:scan`, and `pnpm harness:verify-like-ci` pass.

## Affected Files

- `.agents/tasks/completed/TRANS-003-usage-report-wire-pair-is-dead-while-selfhost-004-claims-it-proven.md`
- `.agents/tasks/completed/TRANS-004-ws-command-wire-pair-is-server-implemented-and-client-dead.md`
- `.agents/tasks/completed/HARNESS-087-most-declared-sizes-are-checked-by-nothing.md`
- `.agents/tasks/DOCS-040-terminalize-backlog-zero-migration-batch-11.md`
- `.agents/spec-docs/done/DOCS-040-terminalize-backlog-zero-migration-batch-11.md`
- `.agents/loop-runs/backlog-execution-orchestrator.jsonl` (append-only ledger)

## Completion Criteria

- [x] TC-01: fixed manifest has exactly three units, six final paths, current blobs, and exact issue handoff URLs.
- [x] TC-02: all three Tasks are body-preserving `skipped` records archived atomically with exact `returned_to_issue` links.
- [x] TC-03: lifecycle, citation, delegation, reference-kind, and no-growth scans pass with no excluded path changed.
- [x] TC-04: `pnpm harness:scan`, `pnpm test`, and `pnpm harness:verify-like-ci` exit 0.

## Test Plan

| TC-ID | Test Type  | Tool / Approach                                 | Notes                                       |
| ----- | ---------- | ----------------------------------------------- | ------------------------------------------- |
| TC-01 | Manifest   | `git show` and fixed-population blob comparison | Exact three-unit/six-path inventory         |
| TC-02 | Lifecycle  | normalized body diff and archival scans         | Handoff URLs are append-only issue comments |
| TC-03 | Regression | `pnpm harness:scan` and focused harness scans   | No source/API/policy changes                |
| TC-04 | CI mirror  | `pnpm test` and `pnpm harness:verify-like-ci`   | Full test and CI mirror                     |

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable: this is an internal Task lifecycle handoff with no user-facing runtime behavior.

## Tasks

- [ ] `.agents/tasks/DOCS-040-terminalize-backlog-zero-migration-batch-11.md` — todo

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-29

- GATE-WRITE — Problem/reproduction, prior art, alternatives, decision, affected scope, four criteria, and test plan are present; no implementation scope is introduced.

### [RECOMMENDATION REVIEW ROUND 1] — ✅ ENDORSE | 2026-08-29

- TRANS-003 blob `5741e7233e2f154f64ab49acc6b83f6dbc904963`, TRANS-004 blob `9b628fce88dbed13ee1a291b05d147025bd16cc5`, and HARNESS-087 blob `371c77e9d5c53ddedacee401d710d718f029dd6e` equal fixed population and current develop.
- Exact Task paths are `.agents/tasks/completed/TRANS-003-usage-report-wire-pair-is-dead-while-selfhost-004-claims-it-proven.md`, `.agents/tasks/completed/TRANS-004-ws-command-wire-pair-is-server-implemented-and-client-dead.md`, and `.agents/tasks/completed/HARNESS-087-most-declared-sizes-are-checked-by-nothing.md`.
- GitHub issue #2164 and GitHub issue #2325 are OPEN/unassigned; corrected handoff comments are recorded at https://github.com/woojubb/robota/issues/2164#issuecomment-5459592489 and https://github.com/woojubb/robota/issues/2325#issuecomment-5459592574.
- Independent review found no competing PR, branch, worktree, or loop. `ACTIONABLE FINDINGS: 0`; `REVIEW VERDICT: ENDORSE`.

### [GATE-WRITE] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → review-ready

- Semantic guardian PASS: concrete symptom and reproduction are explicit; prior art feeds the decision; the ownership/queue trade-off is stated; new-surface placement is N/A; TC-01 through TC-04 cover every sub-item in observable command/manifest form.
- GATE-WRITE — Problem contains a concrete symptom — PASS: duplicate root queue and exact `rg` observation — `semantic`
- GATE-WRITE — Problem contains a reproduction condition — PASS: simultaneous OPEN issue/root Task retention leaves stale queue — `semantic`
- GATE-WRITE — Prior-art findings feed Alternatives/Decision — PASS: registered migration class and batches 01–10 constrain body-preserving handoff — `semantic`
- GATE-WRITE — Decision references the trade-off driving the choice — PASS: unfinished ownership preservation and queue removal are weighed against append-only comments — `semantic`
- GATE-WRITE — New-surface placement (conditional) — PASS/N/A: no package, app, interface, layer, or product surface is introduced — `semantic`
- GATE-WRITE — At least one criterion covers each distinct feature or sub-item — PASS: TC-01 through TC-04 cover manifest, archival, scans, and verification — `semantic`
- GATE-WRITE — Each criterion uses Command or Observable behavior form — PASS: criteria use manifest, archive, scan, and exit-code observations — `semantic`

GATE VERDICT: PASS

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "앞으로 너가 타당한 근거와 함께 추천안을 제시하면 그게 타당할 경우 자동승인 하겠습니다."
**Given:** 2026-08-29, this conversation
**Review fingerprint:** dd205bdebf17 (review 7ff8a82d, type/tags a0d6c0d0)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-29, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (dd205bdebf17) equals the document's current fingerprint

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-29; status `approved`
- GATE-IMPLEMENT — The active spec path is exact and paired: `.agents/spec-docs/active/DOCS-040-terminalize-backlog-zero-migration-batch-11.md`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/DOCS-040-terminalize-backlog-zero-migration-batch-11.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/DOCS-040-terminalize-backlog-zero-migration-batch-11.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (4)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 283 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 1 path(s), all within the paired spec/Task and .agents/loop-runs/
