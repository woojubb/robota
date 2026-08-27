---
status: verifying
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

- [x] TC-01: all six delivered Tasks are archived with truthful `done` status and completion dates.
- [x] TC-02: all six historically invalid specs are rejected with their original evidence preserved
      and a concrete disposition recorded.
- [x] TC-03: the current interface-family owner graph, package manifests, and migrated imports prove
      that each of the six Task outcomes remains delivered.
- [x] TC-04: all moved-record citations, reference-kind baselines, and existing standing-delegation
      exemption keys resolve to canonical paths without adding an exemption.
- [x] TC-05: lifecycle scans, `pnpm harness:scan`, and `pnpm harness:verify-like-ci` pass on the final
      tree.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                   | Notes                                                                                                                 |
| ----- | --------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| TC-01 | RULE      | Task placement, lifecycle, archival scans                         | PASS. New test skipped: record-only move is directly covered by existing lifecycle scans.                             |
| TC-02 | RULE      | Spec status/folder and gate-history scans                         | PASS. New test skipped: record-only disposition is directly covered by existing spec scans and independent review.    |
| TC-03 | RULE      | Interface-owner scan, manifest comparison, current-tree search    | PASS: 22 modules, four manifest edges; focused Vitest 15 files/58 tests. No new runtime test for a historical audit.  |
| TC-04 | RULE      | Citation, reference-kind, and standing-delegation scans           | PASS; six keys rekeyed, zero exemptions added, zero affected reference-kind entries. No new test for baseline data.   |
| TC-05 | RULE      | Focused tests, `pnpm harness:scan`, `pnpm harness:verify-like-ci` | PASS: 145-scan implementation run and all 13 CI-equivalent stages. No new test because the existing gates are direct. |

## User Execution Test Scenarios

**Not applicable.** This reconciliation changes only repository-internal Task/spec lifecycle records
and the baseline keys that name those records. It changes no product command, UI flow, public SDK
behavior, config contract, or runtime output. The observable evidence is therefore the engineering
verification in the Test Plan, not an invented product scenario.

## Tasks

- `.agents/tasks/DOCS-029-reconcile-stale-and-terminal-backlog-records.md` — active paired work-unit
  record.

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

### [GATE-WRITE] — ✅ PASS | 2026-08-28

**Status upgrade:** draft → review-ready

- Frontmatter and input-state pass: the document was coherently `status: draft` in
  `.agents/spec-docs/draft/`, begins with valid YAML frontmatter, uses allowed type `RULE`, and has
  tags.
- Problem pass: the document names the six-record `ARCH-103` through `ARCH-108` lifecycle mismatch,
  the failing `user-execution-plan-order` condition, and the exact evidence channels used to reproduce
  it; no TBD, TODO, or vague single-sentence description remains.
- Prior Art Research pass: the explicit repository-local waiver is concrete, and its distinction
  between Task delivery truth and spec gate truth feeds the alternatives and Decision.
- Architecture review pass: all four checklist items are checked; the sibling scan names its evidence
  channels; three alternatives contain pro/con trade-offs; and the Decision chooses independent
  Task/spec dispositions to avoid fabricated gate history. New-surface placement is N/A because no
  package, app, interface/presentation surface, or layer/product-family boundary is introduced.
- Scope pass: the work is fixed to `ARCH-103` through `ARCH-108`; affected files include both reference
  and standing-delegation baselines, with existing exemption keys rekeyed rather than expanded.
- Completion/Test Plan pass: TC-01 through TC-05 are observable or command-verifiable, contain no
  forbidden vague phrases, cover all five distinct sub-items, and match exactly five substantive,
  non-manual Test Plan rows.
- Structure pass: the concrete user-execution N/A is recorded, the exact uncreated-Task placeholder is
  present, prior GATE-WRITE history is retained for this rerun, and no body Status or Classification
  section exists.

**Independent guardian verdict:** `GATE VERDICT: PASS`

### [RECOMMENDATION REVIEW] — ✅ ENDORSE | 2026-08-28

- The recommendation to archive the delivered Tasks while rejecting their invalid historical specs
  preserves delivery truth and gate truth independently.
- The standing-delegation baseline is rekeyed without expansion, and governance-only user execution is
  correctly declared not applicable.
- `ACTIONABLE FINDINGS: 0`

**Independent reviewer verdict:** `REVIEW VERDICT: ENDORSE`

### [GATE-APPROVAL] — ✅ PASS | 2026-08-28

**Status upgrade:** review-ready → approved

**Approval route:** `DIRECT`
**Instruction (verbatim):** "DOCS-029 승인함. BACKLOG-ZERO-MIGRATION 클래스를 등록하고, 2026-08-28 기준 기존 backlog를 GitHub issue로 이관하거나 이미 전달된 기록을 종결하는 문서 전용 배치를 자동 승인하도록 위임함. 패키지 소스/API/정책 변경은 제외."
**Given:** 2026-08-28, this conversation

- The approval names `DOCS-029` directly and authorizes this document before implementation.
- No Architecture Review content, type, or tags changed after approval.
- Independent new-surface placement validation is not applicable because this batch introduces no
  package, app, public surface, or layer/product-family boundary.
- The separately authorized `BACKLOG-ZERO-MIGRATION` class will be registered in its owning policy
  work unit after this batch; this DIRECT pass does not depend on that future registry entry.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-28

**Status upgrade:** approved → in-progress

- Task record: `.agents/tasks/DOCS-029-reconcile-stale-and-terminal-backlog-records.md` exists and is
  bound in the `## Tasks` section.
- Spec record: `.agents/spec-docs/active/DOCS-029-reconcile-stale-and-terminal-backlog-records.md`.
- The Task Plan contains one item for each TC-01 through TC-05, and its Test Plan names the focused,
  lifecycle, harness, typecheck, and CI-equivalent verification.
- Subject-bound user-execution PLAN: `SCENARIO DRAFTED: not-applicable | 0`, with the concrete reason
  recorded in the Task: lifecycle records and baseline keys change, while every product surface and
  runtime output remains identical.
- **whole-worktree** check: only the exact Task/spec pair is present; no implementation, baseline,
  source, unrelated staged, unstaged, untracked, renamed, or deleted path exists.

### [GATE-COMPLETE: TC-01] — EVIDENCE | 2026-08-28

- Verification: inspected PR delivery commits `bd50f8b28`, `0c9c9fd59`, `c621e4d49`, `22152ef9d`,
  `4ed80522b`, and `c1dd93768`; then ran `check-backlog-placement.mjs` and
  `check-task-archival.mjs`.
- Result: all six Tasks are `done` under `.agents/tasks/completed/`; ARCH-103 through ARCH-107 use
  their 2026-08-23 delivery date and ARCH-108 uses its verified 2026-08-24 delivery date. Both scans
  exited 0.
- Test disposition: new test skipped because this is a record-only move; the existing lifecycle
  scans are the direct executable assertions.

### [GATE-COMPLETE: TC-02] — EVIDENCE | 2026-08-28

- Verification: compared every rejected spec against its pre-move blob, ran
  `scan-doc-folder-status-agreement.mjs`, and obtained an independent evidence-preservation review.
- Result: the six original gate headings and verdicts remain historical evidence; each spec adds a
  2026-08-28 rejection explaining why the old chain cannot be promoted. Folder/status exited 0 and
  the independent rerun reported `ACTIONABLE FINDINGS: 0`.
- Test disposition: new test skipped because no mechanism changed; existing spec lifecycle scans and
  an independent content comparison directly cover the disposition.

### [GATE-COMPLETE: TC-03] — EVIDENCE | 2026-08-28

- Verification: `pnpm harness:conformance`,
  `node scripts/harness/scan-interface-family-owner.mjs`, `pnpm typecheck`, and focused Vitest over
  the six interface-owner packages.
- Result: zero dependency violations; 22 contract modules and four manifest edges passed owner
  projection; 109 workspace projects typechecked; 15 test files and 58 tests passed. Every command
  exited 0.
- Test disposition: no new runtime test was authored for this historical audit; the 58 existing
  focused tests are the regression surface of the delivered owners.

### [GATE-COMPLETE: TC-04] — EVIDENCE | 2026-08-28

- Verification: `scan-task-path-citations.mjs`, `scan-reference-kind-qualified.mjs`, and
  `scan-standing-delegation-evidence.mjs`.
- Result: all commands exited 0. Six standing-delegation keys moved from `todo/` to `rejected/`
  without changing the set size; no ARCH-103 through ARCH-108 entry exists in the reference-kind
  baseline, so zero reference-kind entries required modification.
- Test disposition: new test skipped because only frozen data keys and citations changed; their
  existing scanners directly validate resolution and no-growth behavior.

### [GATE-COMPLETE: TC-05] — EVIDENCE | 2026-08-28

- Verification: `pnpm harness:scan` and `pnpm harness:verify-like-ci` on the assembled committed
  implementation.
- Result: the direct scan passed 145 scans with two declared skips. The CI mirror passed all 13
  stages, including 3,928 contract tests, 1,149 hermetic tests, both scan suites, full typecheck, and
  lint ceiling; build and affected-package verification were correctly skipped by the CI plan because
  no package/app source was changed. Both commands exited 0.
- Test disposition: new test skipped because the existing repository and CI-equivalent gates are the
  direct acceptance tests for this document-only batch.

### [GATE-VERIFY] — ✅ PASS | 2026-08-28

**Status upgrade:** in-progress → verifying

- Exact Task `.agents/tasks/DOCS-029-reconcile-stale-and-terminal-backlog-records.md` has every Plan
  and Test Plan item checked, with no blocked or pending item.
- The complete topic diff contains no package or app path, so the CI plan correctly found no affected
  build target. The six interface-owner package suites nevertheless passed 15 files and 58 tests.
- `pnpm harness:scan` passed 145 scans, and the clean committed-tree
  `pnpm harness:verify-like-ci` run passed all 13 stages.

**Independent guardian verdict:** `GATE VERDICT: PASS`
