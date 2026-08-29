---
status: done
type: RULE
tags: [github, governance, harness]
lane: L2
---

# RULE-018: GitHub Issues need one deterministic triage and conversion queue

## Problem

On 2026-08-29 the repository had 257 open GitHub Issues: 92 had no label, 140 lacked a primary work-kind
label, and only three had an assignee. Ninety-eight titles contained P0/P1/P2 text, which is not a
filterable or governed priority field. The repository has structured Task `priority` and `urgency`, but
its GitHub label namespace has no registry, no intake marker, and no rule that transfers priority
authority when an Issue becomes a Task.

The original proposal reproduced the deeper defect: making Issue P0/P1/P2 an executable queue would
duplicate the Task authority declared by `.agents/tasks/README.md` and the existing Issue↔Task boundary.
This is observable whenever an Issue-linked Task changes priority independently of its Issue. It is also
incomplete across the real work population: only 20 of 104 open Tasks cite a GitHub Issue, while many
Issues have no Task. A deterministic system therefore needs an explicit handoff, not two synchronized
priority copies.

The label namespace also carries exact-name PR protocol labels consumed by workflow and harness code.
Without a machine-readable registry and a guard, an Issue-form label can silently fail to apply when the
label is absent, while a renamed or deleted PR-gate label can break automation.

Source issue: https://github.com/woojubb/robota/issues/2468.

## Prior Art Research

Research was refreshed on 2026-08-29 against primary product documentation.

- [GitHub labels](https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/managing-labels)
  classify Issues and pull requests in one repository namespace, and deletion removes the label from
  existing items. Robota must reuse familiar work-kind names, distinguish Issue workflow labels from PR
  protocol labels in its registry, and never silently delete historical labels.
- [GitHub Issue Forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms)
  support required inputs and default labels, but a configured label that does not exist is not applied.
  Forms can improve intake but cannot enforce later lifecycle edits, so registry synchronization must
  precede enabling them and a guard must check their label references.
- [GitHub issue dependencies](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies)
  natively represent blocked-by and blocking relations. Native edges remain the blocking SSOT; a required
  blocked label would duplicate them.
- [GitHub Projects guidance](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/best-practices-for-projects)
  recommends one source of truth. RULE-018 introduces no Project and no duplicate Project priority field.
- [Kubernetes label synchronization guidance](https://github.com/kubernetes/test-infra/blob/master/label_sync/labels.md)
  derives label documentation from machine-readable configuration and expects a label to have a real
  producer or consumer. Robota admits only the minimal core with named producers and consumers.

The resulting constraint is a seven-label Issue intake model backed by a registry, with a one-way
authority handoff to Tasks rather than continuous mirroring.

## Architecture Review

### Affected Scope

- `.github/labels.json` — exact-name label registry and ownership metadata.
- `.github/ISSUE_TEMPLATE/**` — Bug, Enhancement, and Documentation Issue Forms.
- `.agents/rules/backlog-execution.md` — thin Issue↔Task authority and queue invariants.
- `.agents/skills/github-issue-triage/SKILL.md` — operational triage and live reconciliation procedure.
- `.agents/skills/index.md`, `.agents/skills/find-to-issue/SKILL.md`, and
  `.agents/skills/issue-to-backlog/SKILL.md` — routing only.
- `scripts/harness/scan-github-label-registry.mjs` and focused tests — static registry enforcement.
- `scripts/harness/github-issue-triage.mjs` and focused tests — read-only Issue audit, ordered conversion
  finalization, and report-first live label reconciliation.
- `scripts/harness/run-all-scans.mjs` — register the static scan in the full harness.
- The paired Task/spec and required loop-run records.

No package/app source, public API, product behavior, Project configuration, workflow behavior, git hook,
workspace topology, historical label deletion, or bulk historical Issue classification is in scope.
The declared lane is `L2` because the intended diff edits `.agents/rules/backlog-execution.md` and the
full-scan registry.

### Alternatives Considered

1. **Make GitHub Issues the executable priority SSOT.** Pro: all work selection is visible on GitHub.
   Con: contradicts the settled optional-front-stage boundary, excludes Task-only work, requires online
   synchronization for offline/forked Tasks, and expands into Task schema and enforcement redesign.
2. **Use Issue P labels only before Task conversion, then transfer authority.** Pro: gives Issue intake a
   deterministic queue while preserving one execution SSOT; no continuous synchronization or Project is
   required. Con: the priority label is intentionally removed from the Issue after conversion. Chosen.
3. **Keep manual labels and prose-only guidance.** Pro: smallest initial edit. Con: Issue Forms can refer
   to absent labels silently, exact-name automation can drift, and the queue remains non-deterministic.
4. **Adopt a broad taxonomy and GitHub Project immediately.** Pro: more reporting dimensions. Con: adds
   triage cost and duplicate metadata without evidence that those dimensions change work selection.

### Decision

Choose alternative 2. GitHub Issues remain the optional front stage. Their P labels answer only “which
unconverted Issue should become a Task next?”: P0 is an interrupt candidate, P1 is the committed next
conversion queue, and P2 is valid uncommitted intake. Selection is P0, then P1 Issues that unblock other
Issues using native dependency edges, then the oldest unassigned P1. P2 must be deliberately promoted to
P1 before conversion.

At Issue→Task conversion, P0 initializes Task `urgency: now` and P1 initializes `urgency: soon`; Task
`priority` is judged independently as impact. Finalization first posts an idempotent canonical Issue
comment containing the Task ID and repository path, reads it back, and only then removes every
`priority:P*` label from the Issue. If comment write/read-back or label removal fails, conversion remains
incomplete and implementation must not start. A retry may observe the existing exact marker and continue
without duplicating it. From successful finalization onward Task `priority` and `urgency` are the sole
execution authority, while the Issue retains an auditable forward link. Assignee plus a linked branch or
pull request remains an activity signal, not a second lifecycle axis. Task-only work remains valid and
unaffected.

The exact core is work kinds `bug`, `enhancement`, `documentation`; intake
`status:needs-triage`; and conversion priorities `priority:P0`, `priority:P1`, `priority:P2`. There is no
P3. A triaged unconverted Issue has exactly one work kind, exactly one P label, and no intake marker. A
new Issue Form applies one work kind plus the intake marker. Manual/API-created Issues must add the
marker explicitly or appear in reconciliation output.

One JSON registry declares every live label, its category, Issue/PR applicability, lifecycle, and named
producer/consumer. The exact PR-gate labels `disposition-containment`, `disposition-re-plan`, and
`review-findings-acknowledged` are protected system labels. A code-owned baseline, independent of
registry entries, requires both disposition labels in `.github/workflows/review-gate.yml`,
`.claude/hooks/merge-gate.sh`, and `scripts/harness/record-local-review.mjs`, and requires
`review-findings-acknowledged` in `scripts/harness/check-review-gate.mjs`. Registry metadata may add
consumers but cannot remove those baseline relations. Existing non-core labels remain declared for safe
reconciliation but are not promoted into the required model. Live reconciliation is report-first and
additive/update-only: it may create or update declared labels after dry-run but never deletes an
unexpected live label.

The live administrative tool also has a read-only open-Issue audit. It reports four disjoint categories:
valid intake awaiting triage, valid unconverted priority candidates, converted Issues linked from an open
Task, and malformed/unclassified Issues. It never guesses a work kind or priority and never mutates an
Issue in audit mode. This closes the manual/API creation path that Issue Forms cannot cover.

The static scan's stated scope is the registry schema, the three Issue Forms' top-level label arrays,
the code-owned protected-consumer baseline, and any additive consumer relations declared by the
registry. It does not claim to discover every arbitrary label-shaped string in the repository. It
reports a non-zero examined count so an empty scope cannot pass quietly.

This design was validated against the live Issue/Task populations, all current label names, current
Issue templates, exact-name PR label consumers, the settled Issue↔Task boundary, manual/API creation,
missing live labels, unexpected legacy labels, comment-success/label-failure retry, unexpected consumer
removal, offline Tasks, and destructive reconciliation failure modes. The owner approved the revised
boundary with the verbatim instruction “권장 수정안이 타당한
이유를 가지고 있다면 수정안대로 승인한다.” The factual condition is met by the observed distinct
Issue/Task populations and the removal-at-conversion invariant.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — GitHub metadata, rule/skill governance, and harness only.
- [x] Sibling scan 완료 — Issue↔Task rule, Task schema, existing templates, all live labels, protected
      PR-label consumers, and the prior GitHub-tracker decision were checked.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

1. Declare the full current label namespace and seven-label core in `.github/labels.json`, including
   exact protected consumer metadata for PR-gate labels.
2. Replace the Bug and Enhancement Markdown templates and add a Documentation Issue Form. Each applies
   exactly one kind plus `status:needs-triage` and requires evidence needed for triage.
3. Add thin authority/queue invariants to the existing Issue↔Task rule and one operational triage skill.
   Link capture and conversion skills to it without duplicating policy.
4. Implement a static scan and focused tests for registry shape, exact core groups, absence of P3, Issue
   Form references, the independent protected-consumer baseline plus additive registry relations, and
   non-empty examination reporting. Register it in the full harness.
5. Implement a live administrative tool using `gh`. Audit mode classifies every open Issue without
   mutation or guessed metadata. Conversion mode validates the Task mapping, posts and reads back an
   idempotent Task marker, then removes P labels; any incomplete step fails closed before implementation.
6. In the same live tool, make label reconciliation report-first: dry-run shows missing, drifted, and
   unexpected labels; apply creates/updates declared labels only; final check reports no declared drift.
   Preserve unexpected historical labels and do not bulk-classify existing Issues.

## Affected Files

- `.github/labels.json`
- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `.github/ISSUE_TEMPLATE/documentation.yml`
- `.github/ISSUE_TEMPLATE/bug_report.md` (removed)
- `.github/ISSUE_TEMPLATE/feature_request.md` (removed)
- `.agents/rules/backlog-execution.md`
- `.agents/skills/github-issue-triage/SKILL.md`
- `.agents/skills/index.md`
- `.agents/skills/find-to-issue/SKILL.md`
- `.agents/skills/issue-to-backlog/SKILL.md`
- `scripts/harness/scan-github-label-registry.mjs`
- `scripts/harness/__tests__/scan-github-label-registry.test.mjs`
- `scripts/harness/github-issue-triage.mjs`
- `scripts/harness/__tests__/github-issue-triage.test.mjs`
- `scripts/harness/run-all-scans.mjs`
- Paired Task/spec documents and required loop-run records

## Completion Criteria

- [x] TC-01: the registry declares every current live label exactly once, contains exactly the seven
      required core labels and three protected PR-gate labels, contains no `priority:P3`, and the static
      scan rejects malformed, duplicate, or incomplete entries.
- [x] TC-02: each of the three Issue Forms applies exactly one declared work kind plus
      `status:needs-triage`, and required inputs capture reproduction or outcome evidence sufficient for
      triage; the static scan rejects undeclared or wrong-cardinality form labels.
- [x] TC-03: the rule, triage skill, and conversion tool define the pre-Task selection order, P0/P1
      mapping, P2 promotion, canonical Task-comment write/read-back before P-label removal, fail-closed
      incomplete conversion, Task-only validity, native dependency ownership, active-work signals, and
      the prohibition on a duplicate Project priority field.
- [x] TC-04: mutation fixtures and the live repository prove the three exact PR-gate labels remain
      declared and present in the code-owned baseline consumers even if registry consumer metadata is
      weakened; additive declared consumers are also checked and the scan reports its exact non-zero
      examined scope.
- [x] TC-05: read-only Issue audit reports every open Issue exactly once as valid intake, valid
      unconverted candidate, converted/Task-linked, or malformed/unclassified, without changing or
      guessing labels.
- [x] TC-06: live label dry-run reports missing/drifted/unexpected labels without mutation, apply performs
      only declared create/update actions and no deletes, and a final live check reports zero declared
      drift.
- [x] TC-07: focused tests, `node scripts/harness/scan-github-label-registry.mjs`,
      `pnpm harness:scan`, and `pnpm harness:verify-like-ci` all exit 0.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                              | Notes                                                                                                |
| ----- | --------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| TC-01 | RULE      | Focused Vitest validates registry schema, uniqueness, exact core, and no P3  | Test: `scripts/harness/__tests__/scan-github-label-registry.test.mjs`.                               |
| TC-02 | RULE      | Focused Vitest parses Issue Form label arrays and required fields            | Test: `scripts/harness/__tests__/scan-github-label-registry.test.mjs`.                               |
| TC-03 | RULE      | Focused conversion planner/executor tests plus owner-prose assertions        | Test: `scripts/harness/__tests__/github-issue-triage.test.mjs`.                                      |
| TC-04 | RULE      | Fixed-baseline and additive-consumer mutation fixtures plus live static scan | Test: `scripts/harness/__tests__/scan-github-label-registry.test.mjs`.                               |
| TC-05 | RULE      | Pure Issue-audit classifier fixtures plus live read-only audit               | Test: `scripts/harness/__tests__/github-issue-triage.test.mjs`; assert total equals live open count. |
| TC-06 | RULE      | Pure reconciliation-plan tests plus live dry-run/apply/final check           | Test: `scripts/harness/__tests__/github-issue-triage.test.mjs`; no deletes.                          |
| TC-07 | CI        | Focused tests, live scan, full harness scan, and CI-equivalent verification  | Commands named in the criterion.                                                                     |

## User Execution Test Scenarios

**Not applicable.** RULE-018 changes GitHub administrative metadata and tooling, Issue Forms,
repository governance rules/skills, and harness verification scripts. It does not add or alter a
runnable Robota CLI, TUI, browser UI, or public SDK/example surface. Focused tests, static scans, and
live GitHub dry-run/apply checks are engineering/administrative verification, not user-executable
product scenarios.

## Tasks

- [x] `.agents/tasks/completed/RULE-018-github-issues-need-one-deterministic-triage-and-conversion-queue.md`

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → review-ready

- GATE-WRITE — File begins with YAML frontmatter: the file begins with a closed `---` frontmatter block.
- GATE-WRITE — `status: draft` is present: frontmatter declares `status: draft` while the document remains in the draft folder.
- GATE-WRITE — `type:` is an allowed value: frontmatter declares `type: RULE`, one of the catalogue's 11 allowed values.
- GATE-WRITE — `tags:` field is present: frontmatter declares `[github, governance, harness]`.
- GATE-WRITE — Concrete symptom: the Problem gives measured Issue/Task populations and identifies the absent label registry, intake marker, and priority-authority handoff.
- GATE-WRITE — Reproduction condition: the Problem identifies independent Issue/Task priority changes, absent form labels, and renamed/deleted exact-name PR labels as observable failure conditions.
- GATE-WRITE — Problem has no TBD, TODO, or vague single sentence: the section is a concrete multi-paragraph diagnosis with no placeholder marker.
- GATE-WRITE — Prior Art Research section is present: `## Prior Art Research` is present.
- GATE-WRITE — Research is substantiated: the section cites primary GitHub documentation for labels, Issue Forms, dependencies, and Projects, plus Kubernetes label-synchronization guidance.
- GATE-WRITE — Research waiver disjunct: substantiated research satisfies the criterion, so no waiver is required.
- GATE-WRITE — Research findings feed Alternatives and Decision: shared label namespace drives protected-label metadata; missing form-label behavior drives registry-first reconciliation; native dependencies remain blocking SSOT; one-source guidance rules out duplicate Project priority; synchronization guidance drives named producers and consumers.
- GATE-WRITE — All four Architecture Review checklist items are checked: 4/4 items are `[x]`.
- GATE-WRITE — Sibling scan has completion evidence: it names the existing Issue↔Task rule, Task schema, templates, live labels, protected consumers, and prior tracker decision examined.
- GATE-WRITE — Alternatives include at least two entries with pro and con: four numbered alternatives each state both a Pro and a Con.
- GATE-WRITE — Decision references the driving trade-off: deliberate removal of Issue priority after conversion preserves one Task execution authority and offline/Task-only work at the cost of no persistent mirrored Issue priority.
- GATE-WRITE — New-surface placement: N/A — the change replaces an existing GitHub intake configuration and adds repository governance and verification beside established `.github`, `.agents`, and `scripts/harness` analogues; it introduces no package, app, product presentation/API interface, product-family boundary, or sibling-product dependency.
- GATE-WRITE — Every completion item has a TC-N prefix: all seven criteria use distinct `TC-01` through `TC-07` prefixes.
- GATE-WRITE — At least one criterion covers each distinct feature: TC-01 covers the registry, TC-02 forms, TC-03 conversion authority and fail-closed finalization, TC-04 protected consumers, TC-05 Issue audit, TC-06 label reconciliation, and TC-07 integrated verification.
- GATE-WRITE — Each criterion is command or observable form: every TC names inspectable declarations, classification totals, scan refusals/output, ordered external actions, mutation boundaries, or commands with exit status.
- GATE-WRITE — Completion criteria avoid banned vague phrases: none uses `works correctly`, `no errors`, `implemented`, or `displays correctly`.
- GATE-WRITE — Test Plan section is present: `## Test Plan` is present.
- GATE-WRITE — Test Plan has one row per TC-N: seven rows exactly match the seven completion criteria.
- GATE-WRITE — Test Plan fields are non-empty: all seven rows have a Test Type and Tool/Approach and none contains TBD.
- GATE-WRITE — Manual rows have justification: there are zero manual-tool rows, so no manual justification is required.
- GATE-WRITE — Tasks section has a placeholder: `## Tasks` records the paired RULE-018 Task path.
- GATE-WRITE — Evidence Log was empty on first run: no gate entry existed before this guardian entry.
- GATE-WRITE — Body has no Status or Classification section: neither prohibited body heading is present.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "권장 수정안이 타당한 이유를 가지고 있다면 수정안대로 승인한다."
**Given:** 2026-08-29, this conversation
**Review fingerprint:** 624932e31aee (review 9c1bf865, type/tags 18d00301)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-29, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (624932e31aee) equals the document's current fingerprint
- GATE-APPROVAL — Ordering check: PASS — `[GATE-WRITE] — ✅ PASS | 2026-08-29` is recorded, frontmatter is `status: review-ready`, and the document is in `.agents/spec-docs/backlog/`.
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — in this conversation the owner answered the recommendation that preserves Task execution authority while applying the remaining approved label/form/guard scope with “권장 수정안이 타당한 이유를 가지고 있다면 수정안대로 승인한다.”; the document measures the stated condition and implements that exact boundary rather than a different item.
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A — route is `DIRECT`; no delegated class is claimed or needed.
- GATE-APPROVAL — Independent architecture validation: N/A — the spec introduces no package, app, product presentation/API interface, layer reclassification, or product-family boundary; it replaces existing GitHub intake configuration and adds governance/harness artifacts only, so the conditional placement-review requirement does not apply.
- GATE-APPROVAL — Pre-implementation non-compliance check: PASS — the worktree contains only the paired Task/spec and required loop-run records, has no implementation diff, and has no commit ahead of `origin/develop`.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-29; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/RULE-018-github-issues-need-one-deterministic-triage-and-conversion-queue.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/RULE-018-github-issues-need-one-deterministic-triage-and-conversion-queue.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task carries 7 checkbox tasks for 7 criteria
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 339 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 5 path(s), all within the paired spec/Task and .agents/loop-runs/
- GATE-IMPLEMENT — Exact paired spec path: `.agents/spec-docs/active/RULE-018-github-issues-need-one-deterministic-triage-and-conversion-queue.md` is the in-progress spec paired with the recorded Task and PLAN signal.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-29

**Command:** `pnpm exec vitest run scripts/harness/__tests__/frontmatter-parser-ssot.test.mjs scripts/harness/__tests__/scan-github-label-registry.test.mjs scripts/harness/__tests__/github-issue-triage.test.mjs`
**Exit:** 0
**Output:** (last 6 of 6 line(s))

```
RUN v3.2.6 /home/ubunutu/dev/robota
PASS scripts/harness/__tests__/github-issue-triage.test.mjs (6 tests)
PASS scripts/harness/__tests__/scan-github-label-registry.test.mjs (3 tests)
PASS scripts/harness/__tests__/frontmatter-parser-ssot.test.mjs (13 tests)
Test Files 3 passed (3)
Tests 22 passed (22)
```

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-29

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-github-label-registry.test.mjs`
**Exit:** 0
**Output:** (last 6 of 6 line(s))

```
RUN v3.2.6 /home/ubunutu/dev/robota
PASS scripts/harness/__tests__/github-issue-triage.test.mjs (6 tests)
PASS scripts/harness/__tests__/scan-github-label-registry.test.mjs (3 tests)
PASS scripts/harness/__tests__/frontmatter-parser-ssot.test.mjs (13 tests)
Test Files 3 passed (3)
Tests 22 passed (22)
```

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-29

**Command:** `pnpm exec vitest run scripts/harness/__tests__/github-issue-triage.test.mjs`
**Exit:** 0
**Output:** (last 6 of 6 line(s))

```
RUN v3.2.6 /home/ubunutu/dev/robota
PASS scripts/harness/__tests__/github-issue-triage.test.mjs (6 tests)
PASS scripts/harness/__tests__/scan-github-label-registry.test.mjs (3 tests)
PASS scripts/harness/__tests__/frontmatter-parser-ssot.test.mjs (13 tests)
Test Files 3 passed (3)
Tests 22 passed (22)
```

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-29

**Command:** `node scripts/harness/scan-github-label-registry.mjs`
**Exit:** 0
**Output:** (last 2 of 2 line(s))

```
::examined:: 33 registry/form/consumer relation(s)
github-label-registry scan passed.
```

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-08-29

**Command:** `node scripts/harness/github-issue-triage.mjs audit --repo woojubb/robota --check`
**Exit:** 0
**Output:** (last 6 of 6 line(s))

```
Open Issue audit: 256 issue(s) examined
valid intake awaiting triage: 0
valid unconverted priority candidates: 0
converted / linked from an open Task: 2
malformed / unclassified: 254
Mutation count: 0
```

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-08-29

**Command:** `node scripts/harness/github-issue-triage.mjs labels --repo woojubb/robota --check`
**Exit:** 0
**Output:** (last 3 of 3 line(s))

```
Live label reconciliation check: 23 label(s) examined
create=0 update=0 unexpected=0 delete=0
Declared label drift: 0
```

### [GATE-COMPLETE: TC-07] — ✅ PASS | 2026-08-29

**Command:** `pnpm harness:verify-like-ci --base-ref origin/develop`
**Exit:** 0
**Output:** (last 10 of 11 line(s))

```
PASS format-check
PASS commitlint
PASS harness-self-test
PASS harness-hermetic-test (73 files, 1153 tests)
PASS scan-suite-dist-free (145 scans passed, 2 skipped)
PASS typecheck
PASS scan-suite (148 scans passed, 1 skipped)
PASS affected-verify
PASS lint-ceiling
PASS all 13 stages; mirrors the required checks of develop
```

### [GATE-VERIFY] — ❌ FAIL | 2026-08-29

**Status remains:** in-progress
**Failed criteria:**

- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): no supplied --verify-cmd contains `build`, `harness:scan` or `run-all-scans` (supplied: `node scripts/harness/scan-github-label-registry.mjs` → exit 0 (::examined:: 33 registry/form/consumer relation(s)); `pnpm exec vitest run scripts/harness/__tests__/scan-github-label-registry.test.mjs scripts/harness/__tests__/github-issue-triage.test.mjs` → exit 0 ( Duration 233ms (transform 50ms, setup 0ms, collect 67ms, tests 12ms, environment 0ms, prepare 90ms) ⏎ ⏎ 10:16:55 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.))
  **Required action:** pass a build command via --verify-cmd

### [GATE-VERIFY] — ✅ PASS | 2026-08-29

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — ordering: prior gate GATE-IMPLEMENT PASS and status `in-progress`: [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29; status `in-progress`
- GATE-VERIFY — All tasks in `.agents/tasks/<ID>.md` are marked complete (`[x]`): 7/7 tasks `[x]` in .agents/tasks/RULE-018-github-issues-need-one-deterministic-triage-and-conversion-queue.md
- GATE-VERIFY — No tasks are blocked or pending: no unticked, blocked, or pending task
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): build-shaped `pnpm harness:scan` → exit 0 ( ⏎ 148 scans passed, 1 skipped (99 declared what they examined) ⏎ scan receipt NOT written: working tree is not clean: M .agents/loop-runs/post-implementation-checklist.jsonl, M .agents/rules/backlog-execution.md, M .agents/skills/find-to-issue/SKILL.md, A .agents/skills/github-issue-triage/SKILL.md, M .agents/skills/index.md, M .agents/skills/issue-to-backlog/SKILL.md, MM .agents/spec-docs/active/RULE-018-github-issues-need-one-deterministic-triage-and-conversion-queue.md, M .agents/tasks/RULE-018-github-issues-need-one-deterministic-triage-and-conversion-queue.md, D .github/ISSUE_TEMPLATE/bug_report.md, A .github/ISSUE_TEMPLATE/bug_report.yml, A .github/ISSUE_TEMPLATE/documentation.yml, D .github/ISSUE_TEMPLATE/feature_request.md, A .github/ISSUE_TEMPLATE/feature_request.yml, A .github/labels.json, A scripts/harness/**tests**/github-issue-triage.test.mjs, A scripts/harness/**tests**/scan-github-label-registry.test.mjs, M scripts/harness/examined-adoption-baseline.json, A scripts/harness/github-issue-triage.mjs, M scripts/harness/measurement-provenance-pending.json, M scripts/harness/run-all-scans.mjs, A scripts/harness/scan-github-label-registry.mjs); all 2 supplied commands exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): test-shaped `pnpm exec vitest run scripts/harness/__tests__/scan-github-label-registry.test.mjs scripts/harness/__tests__/github-issue-triage.test.mjs` → exit 0 ( Duration 242ms (transform 51ms, setup 0ms, collect 71ms, tests 12ms, environment 0ms, prepare 88ms) ⏎ ⏎ 10:17:17 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.); all 2 supplied commands exit 0

### [GATE-COMPLETE] — ✅ PASS | 2026-08-29

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-08-29; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 7/7 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (7)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (7) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (7) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 7/7 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (7) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/RULE-018-github-issues-need-one-deterministic-triage-and-conversion-queue.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 7/7 tasks `[x]` in .agents/tasks/RULE-018-github-issues-need-one-deterministic-triage-and-conversion-queue.md

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-08-29

**Command:** `node scripts/harness/github-issue-triage.mjs audit --repo woojubb/robota`
**Exit:** 0
**Output:** (last 6 of 6 line(s))

```
Open Issue audit: 256 issue(s) examined
valid intake awaiting triage: 0
valid unconverted priority candidates: 0
converted / linked from an open Task: 2
malformed / unclassified: 254
Mutation count: 0
```

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-29

**Command:** `pnpm exec vitest run scripts/harness/__tests__/frontmatter-parser-ssot.test.mjs scripts/harness/__tests__/scan-github-label-registry.test.mjs scripts/harness/__tests__/github-issue-triage.test.mjs`
**Exit:** 0
**Output:** (last 6 of 6 line(s))

```
RUN v3.2.6 /home/ubunutu/dev/robota
PASS scripts/harness/__tests__/github-issue-triage.test.mjs (7 tests)
PASS scripts/harness/__tests__/scan-github-label-registry.test.mjs (3 tests)
PASS scripts/harness/__tests__/frontmatter-parser-ssot.test.mjs (13 tests)
Test Files 3 passed (3)
Tests 23 passed (23)
```

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-29

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-github-label-registry.test.mjs`
**Exit:** 0
**Output:** (last 4 of 4 line(s))

```
RUN v3.2.6 /home/ubunutu/dev/robota
PASS scripts/harness/__tests__/scan-github-label-registry.test.mjs (3 tests)
Test Files 1 passed (1)
Tests 3 passed (3)
```

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-29

**Command:** `pnpm exec vitest run scripts/harness/__tests__/github-issue-triage.test.mjs`
**Exit:** 0
**Output:** (last 4 of 4 line(s))

```
RUN v3.2.6 /home/ubunutu/dev/robota
PASS scripts/harness/__tests__/github-issue-triage.test.mjs (7 tests)
Test Files 1 passed (1)
Tests 7 passed (7)
```

### [GATE-COMPLETE: TC-07] — ✅ PASS | 2026-08-29

**Command:** `pnpm harness:verify-like-ci --base-ref origin/develop`
**Exit:** 0
**Output:** (last 10 of 11 line(s))

```
PASS format-check
PASS commitlint
PASS harness-self-test
PASS harness-hermetic-test (73 files, 1153 tests)
PASS scan-suite-dist-free (145 scans passed, 2 skipped)
PASS typecheck
PASS scan-suite (147 scans passed, 2 skipped)
PASS affected-verify
PASS lint-ceiling
PASS all 13 stages; mirrors the required checks of develop
```
