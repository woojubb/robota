---
status: review-ready
type: RULE
tags: [harness, backlog]
---

# DOCS-029: Reconcile stale and terminal backlog records

## Problem

The repository's open backlog inventory contains records whose lifecycle no longer agrees with the
current tree. The measured set includes delivered Tasks that remain open, historical specs in `done`
or pre-implementation folders without a valid gate chain, and records whose promised implementation
is absent or obsolete today. Running a lifecycle-only commit over those records currently fails
`user-execution-plan-order` because no exact Task/spec pair owns the change.

Reproduce the symptom by comparing each candidate's Task frontmatter, spec folder and evidence log,
current source references, focused tests, merged pull requests, and the live GitHub issue list. The
same comparison yields different answers for Task delivery and spec validity, so copying one status
onto the other produces false history.

## Prior Art Research

Waived: this is a repository-local reconciliation of Robota's own Task/spec artefacts under rules
that have no external product analogue. The governing prior art is the checked-in lifecycle contract
in `.agents/tasks/README.md`, `.agents/rules/spec-workflow.md`, and
`.agents/rules/backlog-execution.md`; external product documentation would not define these paths or
gate meanings.

## Architecture Review

### Affected Scope

- `.agents/tasks/` and `.agents/tasks/completed/` — canonical work-unit lifecycle records.
- `.agents/spec-docs/{draft,todo,active,done,rejected}/` — plan lifecycle and historical gate truth.
- `scripts/harness/reference-kind-baseline.json` — mechanically frozen citations affected by Task
  moves.
- GitHub issue disposition — read-only duplicate/current-state checks, except correcting an issue
  whose local record falsely claimed completion.

No package source, public API, dependency direction, CI workflow, git hook, or repository-wide policy
file changes.

### Alternatives Considered

1. **Report-only inventory.** Pro: zero file churn. Con: every subsequent backlog reader still sees
   stale authoritative records and repeats the audit.
2. **Promote every delivered record to done.** Pro: visually simple. Con: fabricates gate history
   where the plan never earned approval or implementation status.
3. **Independent Task/spec dispositions.** Pro: preserves delivery truth and gate truth separately.
   Con: some delivered Tasks pair with rejected specs and require an explanatory note. Chosen.

### Decision

Apply one evidence-first reconciliation procedure to the audited snapshot. Archive a Task only when
current-tree or merged-delivery evidence proves its outcome. Reject rather than promote a spec whose
historical gate chain is invalid. Keep still-needed work open and rewrite its premise against the
current architecture. When a live GitHub issue duplicates the remaining intent, retain the issue as
the external tracker and make the local Task non-authoritative or terminal as the lifecycle rules
allow. Preserve live work owned by other sessions.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — Task delivery, spec gate validity, source references, and GitHub issue state
      were compared as separate evidence channels.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

1. Freeze the active-session exclusion list and inventory open Tasks plus non-terminal specs.
2. For each candidate, verify current source behavior, focused tests, merged PRs, and related open
   issues before changing lifecycle state.
3. Archive delivered Tasks with canonical `completed` metadata.
4. Move invalid or obsolete plans to `rejected/`, retaining their evidence log and adding a concrete
   disposition instead of synthesizing missing gate passes.
5. Reopen falsely completed work with a current-tree statement; keep its GitHub issue open when that
   issue is the correct tracker.
6. Update live citations and frozen reference baselines, then run focused and repository-wide gates.

## Affected Files

- `.agents/tasks/**`
- `.agents/spec-docs/**`
- `scripts/harness/reference-kind-baseline.json`

The audited snapshot is fixed to these sixteen IDs: `ARCH-103`, `ARCH-104`, `ARCH-105`, `ARCH-106`,
`ARCH-107`, `ARCH-108`, `ARCH-111`, `CLI-032`, `CLI-034`, `DOCS-028`, `HARNESS-018`, `HARNESS-122`,
`PM-026`, `SEC-009`, `STRUCT-011`, and `TRANS-008`. `RUNTIME-007`, `TEST-012`, `PROC-016`, and
`ARCH-112` are explicitly excluded because other sessions own them.

## Completion Criteria

- [ ] TC-01: every delivered Task in the audited set is archived with a truthful terminal status and
      completion date.
- [ ] TC-02: every invalid or obsolete spec in the audited set is rejected with its original evidence
      preserved and a concrete disposition recorded.
- [ ] TC-03: every still-valid open item retains a current-tree problem statement and correct external
      issue relationship; duplicate intent is not tracked as two competing authorities.
- [ ] TC-04: all moved-record citations and reference-kind baselines resolve to the canonical paths.
- [ ] TC-05: focused evidence, lifecycle scans, `pnpm harness:scan`, and
      `pnpm harness:verify-like-ci` pass on the final tree without touching the excluded live items.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                   | Notes                                                    |
| ----- | --------- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| TC-01 | RULE      | Task placement, lifecycle, archival scans                         | Cross-check source/merge evidence before terminal state. |
| TC-02 | RULE      | Spec status/folder and gate-history scans                         | A rejection must not synthesize a PASS.                  |
| TC-03 | RULE      | Current-tree search plus GitHub issue read                        | Preserve GitHub as external intent tracker.              |
| TC-04 | RULE      | Citation and reference-kind scans                                 | Re-freeze only measured path changes.                    |
| TC-05 | RULE      | Focused tests, `pnpm harness:scan`, `pnpm harness:verify-like-ci` | Final assembled verification.                            |

## Tasks

- [ ] `.agents/tasks/<ID>.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-28

**Status upgrade:** draft → review-ready

- Frontmatter and structure pass: valid `RULE` type, tags, concrete problem and reproduction, five
  observable completion criteria, five matching non-manual test rows, exact uncreated-Task
  placeholder, and an initially empty Evidence Log.
- Prior Art Research pass: the explicit waiver is concrete and feeds the alternatives and decision.
- Architecture review pass: all checklist items are complete; the sibling evidence channels,
  alternatives, trade-offs, and no-new-surface conclusion are recorded.
- Scope pass: the audited snapshot is fixed to sixteen named IDs, so the completion criteria do not
  depend on an implementation-time inventory.

**Independent guardian verdict:** `GATE VERDICT: PASS`
