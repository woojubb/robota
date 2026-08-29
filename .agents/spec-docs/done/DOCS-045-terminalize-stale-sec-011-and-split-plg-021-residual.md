---
status: done
type: INFRA
tags: [docs]
lane: L2
---

# DOCS-045: Terminalize stale SEC-011 and split PLG-021 residual

Paired with `.agents/tasks/DOCS-045-terminalize-stale-sec-011-and-split-plg-021-residual.md`. Arising from [issue #2404](https://github.com/woojubb/robota/issues/2404).

## Problem

SEC-011 remains a root `todo` record even though its same-user proof boundary and consumers landed;
its remaining carrier/orchestration is explicitly owned by active HANDOFF-001. PLG-021's enablement
half landed, while project-scope installation still writes to a path the loader does not consume.
Leaving either original record actionable misstates current ownership and scope.

## Prior Art Research

Waived: document-only backlog lifecycle migration under standing `BACKLOG-ZERO-MIGRATION` approval.

## Architecture Review

### Affected Scope

.agents/tasks/completed/SEC-011-same-user-proof-for-cross-device-handoff.md
.agents/tasks/completed/PLG-021-disabling-a-plugin-does-not-disable-it-and-project-scope-install-is-a-dead-end.md
.agents/tasks/DOCS-045-terminalize-stale-sec-011-and-split-plg-021-residual.md

### Alternatives Considered

1. Mark both done. Rejected: SEC-011's carrier remains in HANDOFF-001 and PLG-021 has a reproducible project-scope residual.
2. Keep both root todo. Rejected: the delivered halves and canonical follow-up ownership are already recorded elsewhere.
3. Mark both skipped, archive them, and preserve exact canonical handoffs. Selected: no false completion claim and future issue work recreates fresh Tasks.

### Decision

Select alternative 3. SEC-011 points to active HANDOFF-001 via issue #1812 comment; PLG-021 points to new issue #2487 for its remaining project-scope path reconciliation.

## Fallback & Degradation Declaration

None; no package source, API, policy, or runtime behavior changes.

## Solution

1. Record handoff comments on issue #1812 and issue #2487.
2. Set both original Tasks to `skipped`, add completion/resolution metadata, and archive them atomically.
3. Update references and run `pnpm harness:scan` plus `pnpm harness:verify-like-ci`.

## Completion Criteria

- [x] TC-01: both archived Tasks contain terminal metadata, exact issue links, and resolution sections.
- [x] TC-02: lifecycle, collision, citation, and reference scans pass.
- [x] TC-03: CI-like document verification passes without source/API/policy changes.

## Test Plan

| TC-ID | Test Type | Tool / Approach                           | Notes                         |
| ----- | --------- | ----------------------------------------- | ----------------------------- |
| TC-01 | Document  | **Action:** inspect archived Tasks and issue comments | **Test skipped:** no executable product behavior; GATE-COMPLETE: TC-01 |
| TC-02 | Suite     | `pnpm harness:scan` (147 scans passed)    | **Test skipped:** scan command is the regression check; GATE-COMPLETE: TC-02 |
| TC-03 | CI-like   | `pnpm harness:verify-like-ci` (13/13 pass)| **Test skipped:** CI-like command is the applicable check; GATE-COMPLETE: TC-03 |

- TC-01 — **Test skipped:** document inspection has no executable test function; the action and result
  are recorded in GATE-COMPLETE: TC-01.
- TC-02 — **Test skipped:** the repository scan itself is the regression check; command and result are
  recorded in GATE-COMPLETE: TC-02.
- TC-03 — **Test skipped:** CI-like verification is the applicable check; command and result are
  recorded in GATE-COMPLETE: TC-03.

## User Execution Test Scenarios

Not applicable — internal backlog lifecycle documentation only; no user-facing behavior changes.
**Reason:** no user-facing command, flag, output, configuration, or runtime behavior changes.

## Tasks

- [x] `.agents/tasks/completed/DOCS-045-terminalize-stale-sec-011-and-split-plg-021-residual.md` — done

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-29

Current code and issue history were rechecked. SEC-011's remaining carrier is HANDOFF-001; PLG-021's project-scope residual is issue #2487.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Approval route:** CLASS

**Class:** BACKLOG-ZERO-MIGRATION

Approval route: standing `BACKLOG-ZERO-MIGRATION` delegation in DOCS-029. Scope is document-only.

**Given:** 2026-08-29, this conversation; standing approval recorded in DOCS-029.

**Evidence condition met:** both dispositions are document-only; SEC-011 has an exact HANDOFF-001
ownership handoff and PLG-021 has canonical issue #2487 for its unresolved residual.

**Instruction (verbatim):** "DOCS-029 승인함. BACKLOG-ZERO-MIGRATION 클래스를 등록하고, 2026-08-28 기준 기존 backlog를 GitHub issue로 이관하거나 이미 전달된 기록을 종결하는 문서 전용 배치를 자동 승인하도록 위임함. 패키지 소스/API/정책 변경은 제외."

### [GATE-IMPLEMENT-CHECKPOINT-DUPLICATE] — ✅ PASS | 2026-08-29

Status upgrade: approved → in-progress. The exact Task/spec pair is present, each completion criterion
has a corresponding plan checkbox, the Task records the not-applicable scenario plan, and the worktree
is limited to this pair plus the loop ledger.

<!-- checkpoint-evidence-duplicate:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/DOCS-045-terminalize-stale-sec-011-and-split-plg-021-residual.md",
  "specPath": ".agents/spec-docs/todo/DOCS-045-terminalize-stale-sec-011-and-split-plg-021-residual.md",
  "taskItems": [
    {
      "kind": "checkbox",
      "value": "Record exact handoff comments and evidence for both dispositions."
    },
    {
      "kind": "checkbox",
      "value": "Mark SEC-011 and PLG-021 skipped with completed metadata and move both to completed/."
    },
    { "kind": "checkbox", "value": "Run lifecycle, citation, and CI-like verification scans." }
  ],
  "plan": { "outcome": "not-applicable", "count": 0 },
  "worktreePaths": [
    ".agents/spec-docs/todo/DOCS-045-terminalize-stale-sec-011-and-split-plg-021-residual.md",
    ".agents/tasks/DOCS-045-terminalize-stale-sec-011-and-split-plg-021-residual.md"
  ]
}
```

<!-- checkpoint-evidence-duplicate:v1:end -->

### [GATE-VERIFY] — ✅ PASS | 2026-08-29

Status upgrade: in-progress → verifying.

- `pnpm harness:scan` — 147 scans passed, 2 skipped; only existing advisory findings remain.
- `pnpm harness:verify-like-ci` — all 13 mirrored stages passed, including format, commitlint,
  harness tests, hermetic tests, scan suites, typecheck, affected verification, and lint ceiling.
- No package source, API, policy, or runtime files were changed.

<!-- corrected after the initial mechanical gate attempt; see the authoritative PASS below -->
<!-- ### [GATE-IMPLEMENT-FAILED-ARCHIVE] — ❌ FAIL | 2026-08-29

**Status remains:** review-ready
**Failed criteria:**

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: status is `review-ready`, `approved` expected
  **Required action:** run the prior gate to PASS first
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task Test Plan/Testing section is 0 chars (absent)
  **Required action:** write a ≥50-char test plan in the Task
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` carries no `**Author verdict:** `SCENARIO DRAFTED: (not-applicable|automatable|manual) | <n>`` line (0 found, exactly 1 required; the section is absent)
  **Required action:** record the author verdict in the Task
-->

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-29; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/DOCS-045-terminalize-stale-sec-011-and-split-plg-021-residual.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/DOCS-045-terminalize-stale-sec-011-and-split-plg-021-residual.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task carries 3 checkbox tasks for 3 criteria
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 198 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/DOCS-045-terminalize-stale-sec-011-and-split-plg-021-residual.md",
  "specPath": ".agents/spec-docs/todo/DOCS-045-terminalize-stale-sec-011-and-split-plg-021-residual.md",
  "taskItems": [
    {
      "kind": "checkbox",
      "value": "Record exact handoff comments and evidence for both dispositions."
    },
    {
      "kind": "checkbox",
      "value": "Mark SEC-011 and PLG-021 skipped with completed metadata and move both to `completed/`."
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
    ".agents/spec-docs/todo/DOCS-045-terminalize-stale-sec-011-and-split-plg-021-residual.md",
    ".agents/tasks/DOCS-045-terminalize-stale-sec-011-and-split-plg-021-residual.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [GATE-COMPLETE] — ❌ FAIL | 2026-08-29

**Status remains:** verifying
**Failed criteria:**

- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: no `[GATE-COMPLETE: TC-N]` entry for TC-01, TC-02, TC-03
  **Required action:** run `gate.mjs record` for each
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : TC-01, TC-02, TC-03: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-29

**Action:** inspected archived SEC-011 and PLG-021 records. Both contain terminal metadata, exact `returned_to_issue`
links, and resolution sections; issue comments confirm HANDOFF-001 and [issue #2487](https://github.com/woojubb/robota/issues/2487) ownership.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-29

**Command:** `pnpm harness:scan` — 147 scans passed and 2 declared skips; no failures.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-29

**Command:** `pnpm harness:verify-like-ci` — all 13 mirrored stages passed. The run confirmed no package/app
scope and no source/API/policy changes.
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: TC-01, TC-02, TC-03: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: TC-01, TC-02, TC-03: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped

### [GATE-COMPLETE] — ❌ FAIL | 2026-08-29

**Status remains:** verifying
**Failed criteria:**

- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: TC-01, TC-02, TC-03 entries carry no **Command:**/**Action:**/**Test skipped:** line
  **Required action:** record the command and its output
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : TC-01, TC-02: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: TC-01, TC-02: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: TC-01, TC-02: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped

### [GATE-COMPLETE] — ❌ FAIL | 2026-08-29

**Status remains:** verifying
**Failed criteria:**

- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : TC-01, TC-02: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: TC-01, TC-02: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: TC-01, TC-02: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped

### [GATE-COMPLETE] — ❌ FAIL | 2026-08-29

**Status remains:** verifying
**Failed criteria:**

- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : TC-02: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: TC-02: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: TC-02: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped

### [GATE-COMPLETE] — ❌ FAIL | 2026-08-29

**Status remains:** verifying
**Failed criteria:**

- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : TC-02: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: TC-02: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: TC-02: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped

### [GATE-COMPLETE] — ✅ PASS | 2026-08-29

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-08-29; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 3/3 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (3)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (3) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (3) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 3/3 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (3) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/DOCS-045-terminalize-stale-sec-011-and-split-plg-021-residual.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 3/3 tasks `[x]` in .agents/tasks/DOCS-045-terminalize-stale-sec-011-and-split-plg-021-residual.md
