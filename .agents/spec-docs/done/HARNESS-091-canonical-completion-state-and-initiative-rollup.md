---
status: done
completed: 2026-08-14
type: RULE
tags: [harness, tasks, completion]
---

# HARNESS-091: Canonical completion state and initiative rollup

## Problem

Completed child work can remain visibly open in an initiative even after its Task has `status: done`, a
completion date, a passing done gate, and an archived file. On 2026-08-14, AGREEMENT-001's initiative
Task Plan still showed RUNTIME-003, RUNTIME-005, and RUNTIME-006 as unchecked although all three source
Tasks were archived. Its paired spec `## Tasks` index still pointed RUNTIME-003 and RUNTIME-005 at active
paths with unchecked rows; RUNTIME-006 had already been reconciled there, demonstrating that the two
initiative artifacts can drift independently. The spec Completion Criteria are initiative-level
verification assertions, not child lifecycle rows, so this design does not infer their checkbox state from
child status.

The guidance also contradicts its own canonical model. `.agents/tasks/README.md` defines YAML
frontmatter `status` as the single source of truth and uses `done` as the successful terminal state,
while `task-tracking/SKILL.md`, `check-task-archival.mjs`, and the task-tracking hook still teach or
recognize the retired body-level `Status: completed` form. This makes a correct completion depend on
which document an agent happened to read and leaves initiative checkboxes as an unverified duplicate.

## Prior Art Research

- Jira and Linear use normalized finite workflow states rather than prose-derived status, and Jira
  guards parent completion when child work remains open.
- GitHub sub-issues and Linear parent/sub-issue views derive parent progress from child state rather
  than asking users to maintain an independent count.
- GitHub Projects makes workflow automation explicit through configured field/state mappings.
- XState documents finite/final states as guarded state-machine transitions rather than labels inferred
  from surrounding text.

These patterns support a canonical child state plus derived rollup and guarded terminal transition. They
rule out an additional hand-maintained completion ledger. References:
[Jira workflow statuses](https://support.atlassian.com/jira-cloud-administration/docs/configure-statuses-resolutions-and-priorities/),
[Jira sub-task blocking](https://support.atlassian.com/jira/kb/how-to-prevent-issues-from-being-closed-while-sub-tasks-are-open/),
[GitHub sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues),
[Linear sub-issues](https://linear.app/docs/parent-and-sub-issues), and
[XState final states](https://stately.ai/docs/final-states).

## Architecture Review

### Affected Scope

- `.agents/tasks/README.md` and `.agents/rules/backlog-execution.md` — canonical Task terminal-state
  vocabulary and atomic completion invariant.
- `.agents/skills/task-tracking/SKILL.md` and `.claude/hooks/task-tracking.sh` — agent procedure and
  session reminders aligned to that invariant.
- `scripts/harness/check-task-archival.mjs` and its tests — mechanical completion/rollup enforcement.
- AGREEMENT-001 task/spec — first live initiative declaration and stale rollup reconciliation.

### Sibling Scan

`check-backlog-placement.mjs` already owns status↔folder placement and duplicate Task IDs;
`check-task-archival.mjs` owns completion readiness and archive drift; `frontmatter.mjs` owns parsing.
The new relation belongs in `check-task-archival.mjs` because it asks whether canonical child completion
has been projected into the active initiative that tracks it. No new scan, package, product surface, or
parallel parser is introduced.

The closest metadata analog is the existing Task `depends_on` relation: both are YAML frontmatter lists
of Task IDs parsed by the shared `frontmatter.mjs` contract and consumed by repository governance rather
than runtime products. `children` is classified as an additive field in the existing Task/harness-governance
document-contract family. `.agents/tasks/README.md` owns its schema meaning, `frontmatter.mjs` owns generic
parsing/reachability, and `check-task-archival.mjs` consumes it. It is not an AGREEMENT-001-specific shape,
does not belong to any shipped product, and introduces no dependency on a sibling package or application.

### Alternatives Considered

1. Add stronger prose reminders only. Pro: minimal implementation. Con: it cannot detect the exact stale
   checkbox state that survived the current reminders.
2. Make initiative checkboxes authoritative and push their state down to child Tasks. Pro: one visible
   parent ledger. Con: it reverses ownership and can falsely close detailed work whose evidence lives in
   the child Task.
3. Keep child Task frontmatter/folder as canonical and validate initiative checkbox projections. Pro:
   preserves existing ownership and makes stale or premature rollups fail closed. Con: initiatives need
   an explicit machine-readable child list.

### Decision

Choose option 3 with a dedicated rollup rather than interpreting authored Plan/Completion Criteria rows.
An initiative is independently recognizable when its exact-ID paired spec has `type: AGREEMENT`; every such
Task must declare a non-empty `children: [<Task IDs>]`, and every declared child is required. Removing or
emptying `children` therefore fails rather than disabling the guard. V1 forbids self-reference and nested
AGREEMENT children.

The Task's canonical projection is a `## Children` section, and the paired spec's projection is its existing
`## Tasks` section. Each has exactly one checkbox row per declared child, using an exact ID token, explicit
status, and canonical repository-relative path. A row is checked iff the child is terminal and always names
the actual disposition (`done`, `wontfix`, `skipped`, or `superseded`); it is unchecked for `todo`,
`in-progress`, or `blocked`. Thus a closed administrative disposition is visible but never mislabeled as
successful implementation. An AGREEMENT Task/spec pair may itself reach successful `done` only when every
declared child is `done`; any open, `wontfix`, `skipped`, or `superseded` child makes parent `done` fail. A
parent closed as `wontfix`, `skipped`, or `superseded` is an administrative closure and does not claim
successful delivery. V1 has no optional-child or inferred-replacement semantics.

Authored Plan and Completion Criteria remain independent outcome/evidence assertions and may group
dependencies; they are not child-status projections and are never auto-classified from child lifecycle.
The live reconciliation removes stale lifecycle duplication from the Task Plan in favor of `## Children`;
Completion Criteria change only when their own initiative evidence is satisfied. This avoids the impossible
mixed state in AGREEMENT-001 TC-03, which groups ARCH-012 and ARCH-011.

Lifecycle vocabulary moves to a neutral `task-lifecycle.mjs` owner imported by placement and archival scans;
the hook invokes that executable owner instead of maintaining a shell regex. `frontmatter.mjs` stays generic.
All terminal statuses require a syntactically valid `completed: YYYY-MM-DD`. Body prose containing
`Status: completed` has no lifecycle meaning.

The repository predates that date contract: 341 archived records lack an evidence-backed canonical
date/status. Their exact path/status/date fingerprint is frozen by count and SHA-256 so no new violation
or substitution can pass, while HARNESS-092 owns history-backed removal of the baseline. This task does
not invent dates for historical records.

Pairing is by exact Task ID across all spec lifecycle folders, reusing the existing `idOf()`/index semantics:
missing or duplicate pairs/children fail; prefix matches do not count. Section parsing is bounded by the next
`##` heading. The expected child path is `.agents/tasks/<actual filename>` for open state and
`.agents/tasks/completed/<actual filename>` for terminal state. Global duplicate-ID ownership remains in
`check-backlog-placement`; the relation check only reports that a unique record cannot be resolved.

The archival owner checks both active and archived initiatives. The same commit that changes a child to a
terminal status and archives it must update every declaring initiative's Task/spec rollups. It never edits
parents automatically and never propagates parent state into a child.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — existing placement, archival, and frontmatter owners are reused
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None. A declared initiative whose child cannot be resolved or whose projection is stale fails closed.

## Solution

1. Add a neutral Task-lifecycle owner for status/date classification, consumed by placement, archival, and
   the hook; keep YAML parsing in `frontmatter.mjs`.
2. Align Task README, backlog completion rules, and task-tracking skill on frontmatter-only lifecycle state,
   the full open/terminal vocabulary, valid terminal dates, and atomic child→initiative projection updates.
3. Identify initiatives from paired `type: AGREEMENT`, require non-empty `children`, and validate exact
   one-child rows in Task `## Children` and spec `## Tasks` across active and archived initiative corpora.
4. Prove missing/empty declaration/row, duplicate/self/nested IDs, mixed dispositions, malformed dates,
   prefix-ID collisions, stale paths/checks, body-status spoofing, child-archived-with-parent-stale, and
   premature parent-`done` cases RED.
5. Declare AGREEMENT-001's twelve children, record the live RED naming stale RUNTIME projections, reconcile
   its dedicated rollups, remove child-lifecycle duplication from the authored Plan, and leave Completion
   Criteria governed by their own evidence, then restore GREEN.

## Affected Files

- `.agents/tasks/README.md`
- `.agents/rules/backlog-execution.md`
- `.agents/skills/task-tracking/SKILL.md`
- `.claude/hooks/task-tracking.sh`
- `scripts/harness/task-lifecycle.mjs`
- `scripts/harness/task-lifecycle-legacy-baseline.json`
- `scripts/harness/frontmatter.mjs`
- `scripts/harness/check-backlog-placement.mjs`
- `scripts/harness/check-task-archival.mjs`
- `scripts/harness/__tests__/check-task-archival.test.mjs`
- `scripts/harness/__tests__/remaining-hooks-run.test.mjs`
- `.agents/tasks/AGREEMENT-001-complete-arch-dag-runtime-backlog.md`
- `.agents/spec-docs/active/AGREEMENT-001-complete-arch-dag-runtime-backlog.md`
- `.agents/tasks/completed/PM-027-korean-marketing-content.md`
- `.agents/spec-docs/done/PM-027-korean-marketing-content.md`
- `.agents/spec-docs/draft/HARNESS-092-retire-legacy-task-lifecycle-baseline.md`
- `.agents/archive/audits/rules-without-enforcement-2026-07-28.md`

## Completion Criteria

- [x] TC-01: one shared lifecycle classifier reports `todo`, `in-progress`, and `blocked` as open; reports
      `done`, `wontfix`, `skipped`, and `superseded` as terminal only with a valid `completed: YYYY-MM-DD`;
      and ignores body prose such as `Status: completed`.
- [x] TC-02: an exact-ID paired `type: AGREEMENT` Task without a non-empty, unique, non-self,
      non-initiative `children` list fails; declared initiatives in both active and archived corpora require
      exactly one status/path row per child in Task `## Children` and spec `## Tasks`; parent `status: done`
      fails unless every declared child is `done`.
- [x] TC-03: `task-tracking/SKILL.md`, the Task README, backlog completion rules, and the session hook all
      consume/name the same canonical status/folder/date transition, require atomic parent rollup updates,
      and no longer direct or attempt to infer body-level completion.
- [x] TC-04: AGREEMENT-001 declares all twelve source Task IDs; its archived RUNTIME-003,
      RUNTIME-005, and RUNTIME-006 dedicated rollups are checked, labeled `done`, and point to completed
      paths; its seven open children remain unchecked with their exact statuses/paths; authored Plan and
      Completion Criteria are explicitly non-rollup initiative assertions and are not inferred from child
      state.
- [x] TC-05: focused archival/hook tests, the live task-archival scan, `pnpm harness:scan`, and
      `pnpm harness:verify-like-ci` exit 0 after the RED fixture/live-state proof is recorded.

## Test Plan

| TC-ID | Test Type                  | Tool / Approach                                                                                                                                                                                                                                                                                                         | Notes                                                                                                                                                    |
| ----- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Unit / contract            | `scripts/harness/__tests__/task-lifecycle.test.mjs > canonical Task lifecycle classification`; `check-task-archival.test.mjs > classifyTaskFile`                                                                                                                                                                        | Covers every status, malformed dates, and body-status spoofing.                                                                                          |
| TC-02 | Relational fixture         | `scripts/harness/__tests__/check-task-archival.test.mjs > AGREEMENT child lifecycle projections`                                                                                                                                                                                                                        | Covers exact pairs/declarations/rows, duplicates, self/nested/prefix IDs, dispositions, stale paths/checks, archived parents, and premature parent done. |
| TC-03 | Hook / governance contract | `scripts/harness/__tests__/remaining-hooks-run.test.mjs > task-tracking`                                                                                                                                                                                                                                                | Proves hook delegation and body-prose rejection; owner documents state atomic projection updates.                                                        |
| TC-04 | Live regression            | `scripts/harness/__tests__/check-task-archival.test.mjs > AGREEMENT child lifecycle projections`; live archival scan                                                                                                                                                                                                    | Fixture guards the relation; live scan proves AGREEMENT-001 has seven open and five done children.                                                       |
| TC-05 | CI-equivalent              | `task-lifecycle.test.mjs > canonical Task lifecycle classification`; `check-backlog-placement.test.mjs`; `check-task-archival.test.mjs > AGREEMENT child lifecycle projections`; `frontmatter-parser-ssot.test.mjs`; `remaining-hooks-run.test.mjs > task-tracking`; `pnpm harness:scan`; `pnpm harness:verify-like-ci` | Post-fix verification passed 87 focused tests and all 11 CI-equivalent stages.                                                                           |

## User Execution Test Scenarios

**Applicability:** not-applicable. This changes repository-internal Task lifecycle governance,
agent guidance, hooks, and harness checks. It adds no shipped CLI, TUI, browser, application, or public SDK
behavior; all observables are engineering verification and belong in the Test Plan.

## Tasks

- [x] `.agents/tasks/completed/HARNESS-091-canonical-completion-state-and-initiative-rollup.md` — TC-01 through TC-05 implementation and verification

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-08-14

**Status remains:** draft
**Failed criteria:**

- Problem / concrete symptom accuracy: the draft said RUNTIME-003, RUNTIME-005, and RUNTIME-006 were
  unchecked in every AGREEMENT-001 projection, but the paired spec already had RUNTIME-006/TC-11 and its
  completed-path Tasks row checked. Only the initiative Task Plan remained stale for RUNTIME-006.
  **Required action:** Distinguish the exact stale state on the initiative Task and paired spec surfaces.
- New-surface placement: `children` is a new machine-consumed Task-frontmatter field, but the draft did
  not name its analogous metadata relation, document-contract family, or shared parser/schema ownership.
  **Required action:** Classify it beside `depends_on` in the Task/harness-governance document contract
  and explicitly keep parsing/consumption in the shared existing owners.

### [GATE-WRITE] — ✅ PASS | 2026-08-14

**Status upgrade:** draft → review-ready

- Frontmatter: valid YAML contains `status: draft`, allowed `type: RULE`, and non-empty `tags`.
- Problem: records the concrete 2026-08-14 AGREEMENT-001 drift accurately — the initiative Task Plan
  leaves RUNTIME-003/005/006 unchecked, while the paired spec remains stale only for RUNTIME-003/005
  and already reconciles RUNTIME-006. It also identifies the confirmed frontmatter-SSOT versus
  body-level `Status: completed` guidance contradiction.
- Prior Art Research: cites official Jira, GitHub, Linear, and Stately/XState documentation; the
  normalized child-state, derived-rollup, and guarded-transition findings directly inform Alternatives
  and the selected Decision. `scan-spec-research.mjs` exits 0.
- Architecture Review: affected owners and sibling mechanisms are named; all four checklist items are
  checked; three alternatives carry Pro/Con analysis; the Decision records the ownership and
  false-completion trade-off.
- New-surface placement: `children` is classified as an additive Task/harness-governance
  document-contract field analogous to `depends_on`; `.agents/tasks/README.md` owns semantics, shared
  `frontmatter.mjs` owns parsing, and the existing archival scan consumes it without an
  initiative-local parser or sibling product dependency.
- Completion Criteria: five observable criteria are numbered TC-01 through TC-05, with no vague or
  forbidden completion language.
- Test Plan: five non-empty rows map one-to-one to TC-01 through TC-05; no manual-only row requires
  justification.
- Structure: Tasks placeholder is present, the prior failed GATE-WRITE evidence is retained for audit,
  and no body-level Status or Classification section exists.

### [PROPOSAL REVIEW] — 🔧 REVISE | 2026-08-14

- Direction/placement endorsed: child Task frontmatter remains canonical; Task schema, shared parser,
  and existing archival owner are the correct layers.
- Revision required: arbitrary Plan rows cannot serve as rollups because one row may name mixed-state
  children; absent `children` could disable the guard; administrative terminal dispositions are not
  successful delivery; pair/section/corpus/atomicity semantics and shared lifecycle ownership were not
  closed.
- Applied revision: dedicated one-child Task/spec rollups, independent AGREEMENT identification,
  disposition labels and terminal-date rules, exact-ID pair/path semantics, active+archived corpus,
  atomic parent update, and a neutral lifecycle classifier are now specified above.

**REVIEW VERDICT: REVISE**

### [PROPOSAL RE-REVIEW] — 🔧 REVISE | 2026-08-14

- Most prior ambiguities were closed, but two remained: the successful parent-`done` invariant lacked an
  explicit non-empty/all-children-done fixture, and Completion Criteria were incorrectly described as stale
  child projections while being excluded from repeatable rollup enforcement.
- Applied revision: all declared children are required and non-empty; parent `done` fails for every open or
  administrative child disposition; Completion Criteria are explicitly independent initiative evidence,
  while Task `## Children` and spec `## Tasks` are the only lifecycle projections.

**REVIEW VERDICT: REVISE**

### [PROPOSAL FINAL REVIEW] — ✅ ENDORSE | 2026-08-14

- The revised design makes `children` non-empty, unique, all-required, and independently mandatory for
  exact-ID `type: AGREEMENT` pairs.
- Task `## Children` and spec `## Tasks` are the only lifecycle projections; authored Plan and Completion
  Criteria remain independent initiative evidence.
- Parent `done` is prohibited for every open or administrative child disposition, with direct RED fixtures;
  administrative closure remains distinguishable from successful delivery.
- Shared lifecycle ownership, exact pair/ID/path/section semantics, active+archived coverage, terminal dates,
  and atomic parent updates are testable and prevent the observed drift without auto-editing or product scope.

**REVIEW VERDICT: ENDORSE**

### [IMPLEMENTATION EVIDENCE] — ✅ PASS | 2026-08-14

- RED→GREEN: the first focused run failed on the absent lifecycle owner and all retired completion paths;
  the final five-suite run passed 87 tests, including exact pair/declaration/row/disposition/date/baseline cases.
- Live corpus: the first task-archival run failed on AGREEMENT-001 and PM-027. The repaired run passed over
  69 active and 779 archived Tasks; AGREEMENT-001 projects five done and seven open children exactly.
- Legacy sweep: 341 pre-contract archived records are frozen by exact count/SHA-256, zero-set and substitution
  changes fail, and HARNESS-092 is filed as the canonical removal owner rather than inventing dates.
- Governance: the Task README, backlog rule, task-tracking skill, hook, placement scan, and archival scan share
  the same frontmatter-only vocabulary and atomic initiative-update contract.
- Independent local review: converged to `ACTIONABLE FINDINGS: 0` after missing-pair, zero-set baseline,
  canonical follow-up, and adversarial fixture findings were corrected.
- Verification: `pnpm lint` exited 0 with existing warnings; `pnpm harness:scan` passed 108 scans with two
  declared skips; `pnpm harness:verify-like-ci` passed all 11 stages in 4m02.2s.

### [GATE-VERIFY] — ✅ PASS | 2026-08-14

**Status upgrade:** in-progress → verifying

- Ordering/state: `[GATE-IMPLEMENT] — ✅ PASS | 2026-08-14` exists; the spec entered this gate with
  `status: in-progress` under `.agents/spec-docs/active/`.
- Task completion: the active HARNESS-091 Task contains exactly five TC-mapped Plan items; all five are
  `[x]`, unchecked count is zero, and `## Blockers` records `None`.
- Focused tests: the five lifecycle/placement/archival/frontmatter/hook suites exited 0; 87 tests passed.
- Live corpus: `node scripts/harness/check-task-archival.mjs` exited 0; 69 active and 779 archived Task files
  were measured. `pnpm harness:scan` exited 0 with 108 scans passed and two declared skips.
- Build/lint: independent `pnpm build` exited 0 through all nine ordered type-build tiers; `pnpm lint`
  exited 0 with zero errors and 1,946 existing warnings.
- Tests/CI equivalent: no workspace product package is affected; the exact harness tests passed 87/87 and
  the current-tree `pnpm harness:verify-like-ci` passed all 11 stages in 4m02.2s.
- Review convergence: independent Round A review returned `ACTIONABLE FINDINGS: 0` after all findings were
  corrected.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-14

**Status upgrade:** verifying → verifying

- Command/result: `pnpm exec vitest run scripts/harness/__tests__/task-lifecycle.test.mjs scripts/harness/__tests__/check-backlog-placement.test.mjs scripts/harness/__tests__/check-task-archival.test.mjs scripts/harness/__tests__/frontmatter-parser-ssot.test.mjs scripts/harness/__tests__/remaining-hooks-run.test.mjs` exited 0; 5 files and 87 tests passed.
- Reference: `task-lifecycle.test.mjs > canonical Task lifecycle classification` proves all states,
  terminal dates, and body spoof rejection; `check-task-archival.test.mjs > classifyTaskFile` proves consumer behavior.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-14

**Status upgrade:** verifying → verifying

- Commands/results: focused Vitest and `node scripts/harness/check-task-archival.mjs` exited 0; live corpus
  passed with 69 active and 779 archived Tasks.
- Reference: `check-task-archival.test.mjs > AGREEMENT child lifecycle projections` covers exact
  pairs/declarations/rows, stale and malformed cases, active/archived parents, and premature parent done.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-14

**Status upgrade:** verifying → verifying

- Commands/results: focused Vitest exited 0 and `pnpm harness:scan` exited 0 with 108 passed, two declared skips.
- Reference: `remaining-hooks-run.test.mjs > task-tracking` proves shared classification and body-prose rejection;
  README/rule/skill/hook inspection confirms atomic terminal status/date, move, and parent projection updates.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-14

**Status upgrade:** verifying → verifying

- Action/result: inspected `.agents/tasks/AGREEMENT-001-complete-arch-dag-runtime-backlog.md` and
  `.agents/spec-docs/active/AGREEMENT-001-complete-arch-dag-runtime-backlog.md`, then ran
  `node scripts/harness/check-task-archival.mjs`; it exited 0. All 12 rows agree: five `done` completed
  paths and seven exact open rows.
- Reference: `check-task-archival.test.mjs > AGREEMENT child lifecycle projections`; authored Plan and
  Completion Criteria remain explicitly independent initiative evidence.

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-08-14

**Status upgrade:** verifying → verifying

- Results: `pnpm exec vitest run scripts/harness/__tests__/task-lifecycle.test.mjs scripts/harness/__tests__/check-backlog-placement.test.mjs scripts/harness/__tests__/check-task-archival.test.mjs scripts/harness/__tests__/frontmatter-parser-ssot.test.mjs scripts/harness/__tests__/remaining-hooks-run.test.mjs` exited 0 with 5 files and 87 tests; `node scripts/harness/check-task-archival.mjs` exited 0 with 69 active and 779 archived Tasks; `pnpm harness:scan` exited 0 with 108 passed and two declared skips; `pnpm lint` exited 0 with zero errors; `pnpm build` exited 0 through all nine type tiers; and `pnpm harness:verify-like-ci` exited 0 with all 11 stages in 4m02.2s. Round A found zero actionable issues.
- References: the focused suites in the Test Plan are durable regression owners; aggregate commands validate
  their integration in the final tree.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-14

**Status upgrade:** review-ready → approved

- Explicit scope authorization: the user directed, `완료된 것은 완료 처리를 완벽하게 하세요. 필요하면
완료폴더에 옮기세요. 그리고 앞으로는 이걸 더 명확하게 완료된 것과 완료 아닌 상태 같은 것을
명확하게 에이전트가 처리할 수 있게 규칙과 스킬을 좀더 명확하게 하세요. 실수가 재발하지 않게
해주세요.`
- Standing approval directive: the user stated, `타당한 이유와 함께 추천안을 제시하면 타당할 경우
자동으로 승인하겠습니다.`
- Approval applicability: HARNESS-091 is the concrete, reasoned recommendation for that exact requested
  scope. Its prior art, alternatives, ownership decision, completion criteria, and test plan were presented
  and independently reviewed.
- Conditional approval satisfaction: two `REVISE` rounds were incorporated, and
  `[PROPOSAL FINAL REVIEW] — ✅ ENDORSE | 2026-08-14` establishes that the final recommendation is sound.
  The standing directive therefore explicitly approves this final endorsed revision, not either earlier
  version.
- Post-approval integrity: the final ENDORSE is the last recorded design event; no subsequent Architecture
  Review or frontmatter type/tags modification is present. Frontmatter remains `type: RULE` with
  `tags: [harness, tasks, completion]`.
- Independent architecture validation: the final reviewer endorsed the new Task-contract placement,
  shared lifecycle ownership, exact ID/pair/path semantics, active and archived initiative coverage,
  terminal-date invariants, and atomic parent updates.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-14

**Status upgrade:** approved → in-progress

- Prior approval/order: `[GATE-APPROVAL] — ✅ PASS | 2026-08-14` is recorded; the spec entered this gate
  with `status: approved` under `.agents/spec-docs/todo/`.
- Task file: `.agents/tasks/HARNESS-091-canonical-completion-state-and-initiative-rollup.md` exists with
  `status: in-progress` and links to the exact todo spec.
- Tasks-section linkage: the spec's `## Tasks` section records the Task as the TC-01 through TC-05
  implementation and verification owner.
- Completion-Criteria coverage: the Task Plan contains five explicit tasks mapped one-to-one to TC-01
  through TC-05 — shared lifecycle classification; AGREEMENT/children pairing and rollup enforcement;
  rule/skill/hook alignment; AGREEMENT-001 reconciliation; and RED→GREEN plus final verification.
- Task Test Plan: the substantive plan covers lifecycle state/date/body-spoof tables, adversarial temporary
  initiative trees, shared hook delegation, live AGREEMENT-001 RED/GREEN evidence, focused Vitest,
  `pnpm harness:scan`, and `pnpm harness:verify-like-ci`.
- Implementation boundary: current changes contain only the new spec and Task documents; no
  `task-lifecycle.mjs`, HARNESS-091 source edit, or HARNESS-091 implementation commit exists. Task creation
  therefore precedes implementation.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-14

**Status upgrade:** verifying → done

- Ordering/state: `[GATE-VERIFY] — ✅ PASS | 2026-08-14` exists; the spec entered GATE-COMPLETE with
  `status: verifying` under `.agents/spec-docs/active/`.
- Completion Criteria: TC-01 through TC-05 are all checked and each has a structured
  `[GATE-COMPLETE: TC-N]` entry containing an exact verification command or action, the observed result,
  and exit code where applicable.
- Test Plan: all five TC rows record durable test file/describe references; no TC is silently unaddressed
  and no manual skip is present.
- TC-01: the exact five-suite Vitest command exited 0 with 5 files and 87 tests passed, covering canonical
  lifecycle states, terminal dates, and body-prose spoof rejection.
- TC-02: focused fixtures and `node scripts/harness/check-task-archival.mjs` passed; the live corpus contained
  69 active and 779 archived Tasks.
- TC-03: hook/governance tests passed and `pnpm harness:scan` exited 0 with 108 scans passed and two declared
  skips.
- TC-04: both live AGREEMENT-001 Task/spec projections were inspected and the archival scan exited 0; all
  twelve rows agree as five `done` and seven open children.
- TC-05: focused tests, archival scan, harness scan, lint, build, and verify-like-CI all exited 0;
  verify-like-CI passed all 11 stages in 4m02.2s and Round A reported zero actionable findings.
- Task readiness: `.agents/tasks/HARNESS-091-canonical-completion-state-and-initiative-rollup.md` existed,
  all five TC-mapped Plan items were checked, no pending item remained, and `## Blockers` recorded `None`.
- Independent final check: the exact focused Vitest command again passed 87/87, the archival scan again
  passed 69/779, the current documentation tree passed all 108 harness scans with two declared skips, and
  `git diff --check` exited 0.
