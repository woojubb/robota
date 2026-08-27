---
status: draft
type: RULE
tags: [harness, backlog]
---

# DOCS-029: Reconcile stale and terminal backlog records

## Problem

The repository's open backlog inventory contains six adjacent architecture records whose lifecycle
no longer agrees with the current tree. `ARCH-103` through `ARCH-108` delivered the interface-family
ownership migration, but their Tasks remain open and their approved specs never acquired valid
implementation gates. Running a lifecycle-only commit over those records currently fails
`user-execution-plan-order` because no exact Task/spec pair owns the reconciliation.

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
- `scripts/harness/standing-delegation-baseline.json` — existing exemptions whose spec path keys move
  from `todo/` to `rejected/`; the exemptions are rekeyed, not expanded.
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

Apply one evidence-first reconciliation procedure to the six-record architecture migration. Archive
each Task because current-tree and merged-delivery evidence proves its outcome. Reject rather than
promote each paired spec because its historical gate chain is invalid. Preserve the original evidence
and record why Task delivery truth and spec gate truth legitimately differ.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — Task delivery, spec gate validity, source references, and GitHub issue state
      were compared as separate evidence channels.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

1. Verify the six interface-family moves against current source, package manifests, merged delivery
   evidence, and the existing architecture scans.
2. Archive `ARCH-103` through `ARCH-108` with canonical `done` metadata.
3. Move their approved-but-never-validly-implemented specs to `rejected/`, retaining the evidence log
   and adding a concrete disposition instead of synthesizing missing gate passes.
4. Update live citations and frozen reference baselines, then run focused and repository-wide gates.

## Affected Files

- `.agents/tasks/**`
- `.agents/spec-docs/**`
- `scripts/harness/reference-kind-baseline.json`
- `scripts/harness/standing-delegation-baseline.json`

The audited snapshot is fixed to six IDs: `ARCH-103`, `ARCH-104`, `ARCH-105`, `ARCH-106`, `ARCH-107`,
and `ARCH-108`. The broader 138-record inventory is intentionally split into later work units so this
PR remains within the repository's review-size ceiling.

## Completion Criteria

- [ ] TC-01: all six delivered Tasks are archived with truthful `done` status and completion dates.
- [ ] TC-02: all six historically invalid specs are rejected with their original evidence preserved
      and a concrete disposition recorded.
- [ ] TC-03: the current interface-family owner graph, package manifests, and migrated imports prove
      that each of the six Task outcomes remains delivered.
- [ ] TC-04: all moved-record citations, reference-kind baselines, and existing standing-delegation
      exemption keys resolve to canonical paths without adding an exemption.
- [ ] TC-05: lifecycle scans, `pnpm harness:scan`, and `pnpm harness:verify-like-ci` pass on the final
      tree.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                   | Notes                                                    |
| ----- | --------- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| TC-01 | RULE      | Task placement, lifecycle, archival scans                         | Cross-check source/merge evidence before terminal state. |
| TC-02 | RULE      | Spec status/folder and gate-history scans                         | A rejection must not synthesize a PASS.                  |
| TC-03 | RULE      | Interface-owner scan, manifest comparison, current-tree search    | Revalidate all six delivered migrations.                 |
| TC-04 | RULE      | Citation, reference-kind, and standing-delegation scans           | Rekey existing exemptions; add none.                     |
| TC-05 | RULE      | Focused tests, `pnpm harness:scan`, `pnpm harness:verify-like-ci` | Final assembled verification.                            |

## User Execution Test Scenarios

**Not applicable.** This reconciliation changes only repository-internal Task/spec lifecycle records
and the baseline keys that name those records. It changes no product command, UI flow, public SDK
behavior, config contract, or runtime output. The observable evidence is therefore the engineering
verification in the Test Plan, not an invented product scenario.

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
- Scope pass at the time of the first verdict: the audited snapshot was fixed to named IDs, so the
  completion criteria did not depend on an implementation-time inventory. The scope was subsequently
  narrowed before approval and requires a fresh GATE-WRITE revalidation below.

**Independent guardian verdict:** `GATE VERDICT: PASS`

### [GATE-WRITE] — ❌ FAIL | 2026-08-28

**Status remains:** review-ready

**Failed criterion:**

- Frontmatter `status: draft`: after the scope was narrowed, the document still contained
  `status: review-ready` and resided in `.agents/spec-docs/backlog/`, while GATE-WRITE is defined only
  as the `draft → review-ready` transition.

**Required action:** move the document atomically to `.agents/spec-docs/draft/` and set
`status: draft`, retaining the earlier PASS as historical evidence, then run a fresh GATE-WRITE
against the narrowed six-record scope.

**Independent guardian verdict:** `GATE VERDICT: FAIL`
