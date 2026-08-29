---
status: in-progress
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
.agents/tasks/completed/DOCS-045-terminalize-stale-sec-011-and-split-plg-021-residual.md

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

- [ ] TC-01: both archived Tasks contain terminal metadata, exact issue links, and resolution sections.
- [ ] TC-02: lifecycle, collision, citation, and reference scans pass.
- [ ] TC-03: CI-like document verification passes without source/API/policy changes.

## Test Plan

| TC-ID | Test Type | Tool / Approach                           | Notes                         |
| ----- | --------- | ----------------------------------------- | ----------------------------- |
| TC-01 | Document  | inspect archived Tasks and issue comments | disposition evidence          |
| TC-02 | Suite     | `pnpm harness:scan`                       | lifecycle/citation regression |
| TC-03 | CI-like   | `pnpm harness:verify-like-ci`             | document-only verification    |

## User Execution Test Scenarios

Not applicable — internal backlog lifecycle documentation only; no user-facing behavior changes.
**Reason:** no user-facing command, flag, output, configuration, or runtime behavior changes.

## Tasks

- [ ] `.agents/tasks/DOCS-045-terminalize-stale-sec-011-and-split-plg-021-residual.md` — todo

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-29

Current code and issue history were rechecked. SEC-011's remaining carrier is HANDOFF-001; PLG-021's project-scope residual is issue #2487.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

Approval route: standing `BACKLOG-ZERO-MIGRATION` delegation in DOCS-029. Scope is document-only.

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
