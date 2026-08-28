---
status: review-ready
type: INFRA
tags: [docs, migration]
lane: L2
---

# DOCS-033: Terminalize backlog-zero migration batch 04

## Problem

At fixed population object `2c875dd3ec6938d6eb0563b50c40d1f116fb4e7e`, four valid CLI and
command backlog records remain nonterminal after their implementation work can be owned exactly in
GitHub. CLI-082 already cites exact open issue #1988; CMD-007 is exactly tracked by open issue #2058
but its Task does not yet cite that owner. CMD-008 and CMD-009 remain valid current defects but have no
exact issue owner.

The current `origin/develop` base is `7994ee9def631349e7db6f982517c9b71d1de6ca`. All four Task blobs
are byte-identical between the fixed population and this base. The open PR set is empty, and no
matching implementation branch, extra worktree, assignee, or loop reservation owns any unit. Leaving
the Tasks open after exact issue handoff would keep the repository as a second durable work queue.

Issue #2404 owns the foundational lifetime invariant that will prevent this state from recurring.
DOCS-033 is a finite migration child of that initiative, not a claim to solve the root mechanism. The
registered class and the user's instruction to complete the remaining backlog migration authorize this
four-record containment while #2404 stays open.

## Prior Art Research

Waived: RULE-017 and the registered `BACKLOG-ZERO-MIGRATION` class already selected the finite
manifest, exact readback, append-only handoff, and history-preserving terminalization mechanism. This
batch applies that mechanism to fixed repository records and makes no package, product, or policy
decision.

## Architecture Review

### Affected Scope

- Four Task lifecycle paths for CLI-082, CMD-007, CMD-008, and CMD-009.
- The paired DOCS-033 Task/spec and the two required loop ledgers.
- Append-only GitHub issue creation/comments and exact readback only.

CLI-083 is excluded because its historical Done Gate NON-COMPLIANCE and changed current blob require a
separate disposition. CLI2-011 is already terminal. No package/app source, public API/contract,
package documentation, product/user documentation, policy/gate rule, skill/workflow/hook, topology,
baseline, carrier, or product-direction change is in scope.

### Alternatives Considered

1. Leave all four Tasks open. Pro: no lifecycle edits. Con: preserves a second durable queue after
   exact GitHub ownership can be established.
2. Delete or bulk-mark the four records done. Pro: smallest local queue count. Con: destroys history
   and falsely claims delivery of four unresolved research, architecture, and behavior units.
3. Revalidate each unit, reuse or create one exact open issue, append a canonical handoff, and
   terminalize each local Task as skipped. Pro: preserves criterion-level history while making GitHub
   the sole active queue. Con: requires exact remote readback before the lifecycle move.

### Decision

Choose alternative 3. CLI-082 returns to issue #1988 and CMD-007 to issue #2058. CMD-008 and CMD-009
receive exact new issues with fixed-population markers. Each Task cites one canonical handoff comment.

This accepts exact remote readback in exchange for canonical ownership within the delegated class. It
rejects destructive deletion, false completion, and widening the batch to CLI-083 or any code/policy
surface.

Independent depth review classified the missing integration lifetime invariant as `FOUNDATIONAL` (one
of one): the same duplicate-queue symptom recurred across DOCS-030 through DOCS-032, and moving four
records cannot prevent the next recurrence. Issue #2404 already owns that cause and its mechanical
direction. The disposition for this named work unit is the explicitly authorized finite containment;
the preventive invariant is not absorbed into this manifest.

Independent proposal review on 2026-08-29 verified every load-bearing premise, the four-unit/eight-path
ceiling, the two exact existing issue owners, the absence of competing ownership and baseline/carrier
changes, and the CLI-083/CLI2-011 exclusions. It reported `ACTIONABLE FINDINGS: 0` and
`REVIEW VERDICT: ENDORSE`.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — four lifecycle documents and two ledgers only
- [x] Sibling scan 완료 — all four units, fixed/current blobs, issues, PRs, branches, worktrees,
      reservations, current source evidence, and exclusions checked
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Migration Manifest

Population object: `2c875dd3ec6938d6eb0563b50c40d1f116fb4e7e`.

Pre-approval base: `origin/develop` at `7994ee9def631349e7db6f982517c9b71d1de6ca`.

Limits: 4 units; 8 final tracked paths. The `/tmp` survey is discovery-only. Every governed source
blob below is identical at the population object, base, and this branch. There are zero baseline
rekeys and zero baseline additions.

| Unit    | Original path and blob OID                                                                                                           | Current ownership and evidence                                                                                                                                                                                                                                                                                                                                                                                                                               | Criterion-level disposition                                                                                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI-082 | `.agents/tasks/CLI-082-output-styles-research.md` @ `d178952d3a03a361e2474b817cbda19b86168d98`                                       | Exact OPEN/unassigned issue #1988. No dedicated output-style surface exists. Current preset/persona, composed-prompt, and live `/preset` seams narrow the old Task statement, but its reference re-read, provider-neutral model, per-line decisions, and reviewer sign-off remain open. Canonical handoff: https://github.com/woojubb/robota/issues/1988#issuecomment-5456241480.                                                                            | Preserve the completed seam research and corrected current seams; retain steps 1, 2, and 4 plus implementation as issue work. Task `skipped`, returned to the cited handoff comment.                                |
| CMD-007 | `.agents/tasks/CMD-007-cost-budget-hardcodes-fs-path-bypassing-settings-port.md` @ `68b69f36f17ad85f1880ea007985772af94e6142`        | Exact OPEN/unassigned issue #2058. Production `session-command.ts` still imports filesystem primitives, owns `.robota/budget.json`, and performs budget persistence inside the reusable command package. Canonical handoff: https://github.com/woojubb/robota/issues/2058#issuecomment-5456241547.                                                                                                                                                           | Preserve the port-ownership, product-path, typed failure, tests, and restart scenario criteria. Task `skipped`, returned to the cited handoff comment.                                                              |
| CMD-008 | `.agents/tasks/CMD-008-sessionrequirements-documented-as-gate-implemented-as-switch.md` @ `67f3d5570e441b71c3013e654ac27c01814a82e5` | Exact OPEN/unassigned issue #2449 with marker `backlog-zero:CMD-008:2c875dd3`. The contract still describes a required runtime facility while the sole consumer enables `agent-runtime` when a declaring module is present. The append-only correction is canonical because inline-code spans were stripped from the initial body. Canonical handoff: https://github.com/woojubb/robota/issues/2449#issuecomment-5456241523.                                 | Decide demand-switch versus registration-gate semantics, then align the contract, package SPEC, implementation, tests, and any applicable product scenario. Task `skipped`, returned to the cited handoff comment.  |
| CMD-009 | `.agents/tasks/CMD-009-schedule-list-shows-the-pre-edit-instruction.md` @ `270db6474f03cc2e0f6d170bad4c73bd88f411d4`                 | Exact OPEN/unassigned issue #2448 with marker `backlog-zero:CMD-009:2c875dd3`. Schedule creation still captures `labelFor('Scheduled', instruction)` in `state.label`; edit updates `agentInstruction` but not the label, and list renders the stale label. The append-only correction is canonical because inline-code spans were stripped from the initial body. Canonical handoff: https://github.com/woojubb/robota/issues/2448#issuecomment-5456241485. | Derive displayed instruction from current state, check sibling rendered fields, add red-first coverage, and verify edit-to-list through the product surface. Task `skipped`, returned to the cited handoff comment. |

Live ownership check: PR #2446 is merged into this base and the open PR set is empty. No matching
implementation branch, extra worktree, assignee, session, or loop reservation exists. This branch is
the sole migration owner and owns no implementation. Any governed blob or unit ownership change
excludes that unit and requires a fresh manifest approval.

Control issue #2447 is OPEN/unassigned and uniquely carries marker
`backlog-zero:DOCS-033:2c875dd3`; its append-only fixed-manifest correction is
https://github.com/woojubb/robota/issues/2447#issuecomment-5456241557. It owns this batch PR only.
Parent issue #2404 remains open for later batches and the preventive durable-queue mechanism.

### Baseline disposition

None of the four governed Tasks has an existing baseline path key. No baseline file changes.

## Solution

1. Commit this exact four-unit manifest, create and read back two continuation issues plus the
   DOCS-033 control issue, then append and read back four canonical unfinished-work handoff comments.
2. Record class approval only after exact issue/comment URLs, unchanged source ownership, the
   8-path ceiling, and zero baseline changes are independently proven.
3. Create the paired DOCS-033 planning checkpoint, then terminalize all four Tasks as skipped without
   deleting or rewriting historical evidence.
4. Run the declared verification against the final tree before completing DOCS-033.

## Affected Files

- `.agents/loop-runs/backlog-execution-orchestrator.jsonl`
- `.agents/loop-runs/user-execution-scenario.jsonl`
- `.agents/spec-docs/done/DOCS-033-terminalize-backlog-zero-migration-batch-04.md`
- `.agents/tasks/completed/DOCS-033-terminalize-backlog-zero-migration-batch-04.md`
- `.agents/tasks/completed/CLI-082-output-styles-research.md`
- `.agents/tasks/completed/CMD-007-cost-budget-hardcodes-fs-path-bypassing-settings-port.md`
- `.agents/tasks/completed/CMD-008-sessionrequirements-documented-as-gate-implemented-as-switch.md`
- `.agents/tasks/completed/CMD-009-schedule-list-shows-the-pre-edit-instruction.md`

## Completion Criteria

- [ ] TC-01: the committed manifest contains exactly four units, eight final tracked paths, all four
      governed blobs, current ownership, one disposition per unit, and zero baseline changes.
- [ ] TC-02: two unique continuation issues, exact existing issues #1988 and #2058, four canonical
      handoff comments, and the DOCS-033 control issue are read back; every skipped Task cites its
      exact canonical comment URL.
- [ ] TC-03: all four Tasks become skipped without deleting or rewriting historical evidence; the
      excluded CLI-083 and terminal CLI2-011 records remain byte-unchanged.
- [ ] TC-04: the exact final changed-path set contains only the four Task moves, paired DOCS-033
      Task/spec, and two append-only loop ledgers; no baseline, carrier, or package path changes.
- [ ] TC-05: focused lifecycle/path/reference/delegation checks, `pnpm harness:scan`, and
      `pnpm harness:verify-like-ci` exit 0 on the final branch.

## Test Plan

| TC-ID | Test Type             | Tool / Approach                                                         | Notes                                                                                   |
| ----- | --------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| TC-01 | Agreement / manifest  | Git object/blob comparison, exact path set, unit/path count             | Test skipped: evidence audit observes four units, eight paths, and four governed blobs. |
| TC-02 | Agreement / remote    | Exact title/marker search and `gh api` issue/comment readback           | Test skipped: remote state is append-only control-plane evidence.                       |
| TC-03 | Agreement / lifecycle | Task archival and folder/status scanners plus preserved-blob comparison | Test skipped: existing scanners and blob comparison prove history preservation.         |
| TC-04 | Agreement / scope     | Exact changed-path inventory and excluded-path blob comparison          | Test skipped: exact diff and Git blobs prove the class boundary.                        |
| TC-05 | Agreement / CI        | Focused scanners, full harness scan, CI mirror                          | Test skipped: no new behavior; existing full gates verify atomic final placement.       |

## Tasks

- [ ] `.agents/tasks/DOCS-033-terminalize-backlog-zero-migration-batch-04.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## User Execution Test Scenarios

Not applicable. This batch changes internal lifecycle evidence and remote queue ownership only. It
adds no runnable user-facing behavior.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → review-ready

- GATE-WRITE — Frontmatter: the file begins with YAML frontmatter and declares `status: draft`, the
  permitted `INFRA` type, and a non-empty `tags` field.
- GATE-WRITE — Problem: the concrete symptom is four fixed-population CLI/command Tasks remaining
  nonterminal after their unfinished work can be owned exactly in GitHub; the reproduction condition
  names the population/base OIDs, unchanged governed blobs, empty open-PR set, and absence of competing
  branch, worktree, assignee, session, or reservation ownership. No TBD, TODO, or vague one-sentence
  problem statement is present.
- GATE-WRITE — Prior Art Research: the explicit waiver identifies RULE-017 and the registered
  `BACKLOG-ZERO-MIGRATION` mechanism; that prior mechanism feeds alternative 3 and the Decision's finite
  manifest, exact-readback, canonical-handoff, and history-preserving terminalization choice.
- GATE-WRITE — Architecture Review: all four checklist items are checked; the sibling scan carries
  concrete completion evidence; three alternatives each state a pro and a con; and the Decision names
  exact remote readback versus canonical ownership and preserved history as the driving trade-off.
- GATE-WRITE — New-surface placement: N/A because the spec explicitly excludes package, app,
  presentation, interface, API/contract, policy, workflow, topology, and product-direction changes.
- GATE-WRITE — Completion Criteria: TC-01 through TC-05 cover the distinct manifest, remote-ownership,
  lifecycle, exact-scope, and verification outcomes, including all four governed units; every criterion
  uses observable counts, OIDs/URLs, statuses, path inventories, preservation conditions, or command
  exit results, and none uses a forbidden vague phrase.
- GATE-WRITE — Test Plan: five non-empty rows map one-for-one to the five TC-N criteria, each with a
  Test Type and Tool/Approach; no row uses a manual tool, so manual-only Notes justification is N/A.
- GATE-WRITE — Structure: the Tasks section contains its pre-approval placeholder, this was the empty
  Evidence Log on the first run, and no body `Status` or `Classification` section exists.
- GATE-WRITE — Mechanical criteria: 20/20 PASS; semantic criteria: 7/7 PASS; TC-N/Test Plan count: 5/5.

### [GATE-WRITE] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → review-ready

- GATE-WRITE — Guardian re-review ordering: this is a re-judgement of the entry gate while the document
  remains `status: draft` in the draft folder; the prior complete GATE-WRITE PASS is present, and no
  later gate or implementation evidence has been introduced.
- GATE-WRITE — Guardian re-review frontmatter and structure: valid YAML retains `status: draft`, allowed
  `INFRA` type, tags, all required sections, the Tasks placeholder, no body Status/Classification
  section, and the first-run entry records that the Evidence Log was initially empty.
- GATE-WRITE — Guardian re-review problem: the four exact nonterminal records remain the concrete
  symptom, and the population/base/blob/ownership facts remain the reproduction condition. The added
  issue #2404 boundary makes explicit that DOCS-033 contains four records while the foundational
  lifetime invariant remains owned by the open parent issue; no TBD, TODO, or vague problem text exists.
- GATE-WRITE — Guardian re-review research and architecture: the RULE-017/class waiver still feeds the
  three researched alternatives and chosen finite-handoff mechanism; all four checklist items remain
  checked with sibling-scan evidence and pro/con alternatives.
- GATE-WRITE — Guardian re-review decision and trade-off: the Decision still chooses exact readback and
  canonical ownership with history preservation over deletion or false completion, and now records the
  independent `FOUNDATIONAL` depth verdict plus the deliberate containment/prevention split owned by
  issue #2404.
- GATE-WRITE — Guardian re-review new-surface placement: N/A; the final text introduces or reclassifies
  no package, app, presentation/interface, API/contract, policy, workflow, topology, or product surface.
- GATE-WRITE — Guardian re-review Completion Criteria: TC-01 through TC-05 observably cover the manifest,
  remote ownership, four-unit lifecycle, exact path/exclusion boundary, and verification; all four
  governed records are covered and no forbidden vague outcome phrase appears.
- GATE-WRITE — Guardian re-review Test Plan: five complete, non-manual rows still map exactly to the five
  TC-N criteria with non-empty Test Type and Tool/Approach fields; manual Notes justification is N/A.
- GATE-WRITE — Guardian re-review final totals: mechanical criteria 20/20 PASS; semantic criteria 7/7
  PASS; TC-N/Test Plan count 5/5.

### [GATE-WRITE] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → review-ready

- GATE-WRITE — Final guardian re-review ordering: the entry gate is being re-judged while the document
  remains `status: draft` in the draft folder; two prior complete GATE-WRITE PASS entries exist, and no
  later gate or implementation evidence has been introduced.
- GATE-WRITE — Final guardian re-review frontmatter and structure: valid YAML retains `status: draft`,
  allowed `INFRA` type, tags, every required section, the Tasks placeholder, no body
  Status/Classification section, and first-run evidence that the Evidence Log began empty.
- GATE-WRITE — Final guardian re-review problem: four fixed-population records remain the concrete
  nonterminal symptom, while the population/base/blob/ownership facts reproduce it. The corrected text
  accurately distinguishes CLI-082's existing citation from CMD-007's exact issue #2058 ownership that
  is not yet cited by its Task; issue #2404 retains the preventive lifetime invariant.
- GATE-WRITE — Final guardian re-review research and architecture: the explicit RULE-017 and registered
  class waiver feeds the finite manifest, readback, handoff, and history-preserving recommendation; all
  four checklist items remain checked, the sibling scan is evidenced, and three alternatives retain
  explicit pros and cons.
- GATE-WRITE — Final guardian re-review decision and trade-off: alternative 3 accepts exact remote
  readback for canonical ownership and preserved history while rejecting deletion and false completion;
  the independent foundational-depth result keeps prevention in issue #2404, and the recorded proposal
  review independently ENDORSES the four-unit/eight-path recommendation with zero actionable findings.
- GATE-WRITE — Final guardian re-review new-surface placement: N/A because the final draft introduces or
  reclassifies no package, app, presentation/interface, API/contract, policy, workflow, topology, or
  product surface.
- GATE-WRITE — Final guardian re-review Completion Criteria: TC-01 through TC-05 observably cover the
  manifest, remote ownership, all four lifecycle moves, the exact scope/exclusion boundary, and final
  verification; each distinct outcome is covered and no forbidden vague phrase appears.
- GATE-WRITE — Final guardian re-review Test Plan: five complete non-manual rows map one-for-one to the
  five TC-N criteria with non-empty Test Type and Tool/Approach values; manual Notes justification is
  N/A.
- GATE-WRITE — Final guardian re-review totals: mechanical criteria 20/20 PASS; semantic criteria 7/7
  PASS; TC-N/Test Plan count 5/5.
