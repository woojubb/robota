---
status: done
type: INFRA
tags: [async]
---

# HARNESS-121: User-scenario PLAN order is mechanically enforced

## Problem

The repository requires `user-execution-scenario` PLAN mode before implementation, but the live
mechanism only checks whether a final spec contains `## User Execution Test Scenarios`. HARNESS-119
reproduced the gap: implementation began, a later contract scan found the missing section, and a
retrospective `not-applicable` author verdict made the final tree indistinguishable from a correctly
ordered run.

A mutable section, an Evidence Log entry, or a wall-clock date cannot prove the ordering it claims.
The lifecycle needs a work-unit-bound signal in Git ancestry. GATE-IMPLEMENT must first judge a complete
PLAN result while the whole worktree contains no implementation change; the orchestrator must then
commit that PASS as a dedicated checkpoint; and Phase 3 plus the commit path must fail closed until that
checkpoint is HEAD's ancestor.

## Prior Art Research

### References consulted

- [Git `githooks`](https://git-scm.com/docs/githooks) defines `pre-commit` as running before a commit is
  created and permits a non-zero result to abort that commit.
- [Git `diff`](https://git-scm.com/docs/git-diff) defines `--cached` as the comparison of staged changes
  against a commit, which is the exact proposed implementation payload a pre-commit guard must judge.
- [Git `merge-base`](https://git-scm.com/docs/git-merge-base) defines the common-ancestor operation and
  `--is-ancestor`, which can prove that one checkpoint commit precedes another without wall-clock
  inference.
- [GitHub pull-request merges](https://docs.github.com/en/pull-requests/reference/pull-request-merges)
  documents that squash merge combines a pull request's commits into one base-branch commit, so the
  branch-history check belongs before merge and must not reinterpret the squashed base branch later.

### Observed common behavior and Robota constraints

Git provides two complementary enforcement points: the index before a commit and commit ancestry after
it. A pre-commit check can stop the first implementation commit, while a CI scan can independently
replay the branch range and reject bypassed or reordered commits before merge. The evidence must live in
a dedicated planning checkpoint commit; prose order and authored dates remain useful context but are not
the verdict.

Robota already runs a tracked Husky pre-commit hook and a required `harness:scan` tier. The new mechanism
therefore reuses those paths rather than inventing another lifecycle service. Because squash merge erases
the topic branch's internal commit boundaries on `develop`, the scan judges an ahead-of-base topic range
and reports an explicit expected-empty result when no such range exists.

### Recommendation

Require a dedicated planning checkpoint commit for the exact Task. Before issuing PASS, GATE-IMPLEMENT
must validate a subject-bound PLAN result and prove that no path outside the paired planning artifacts is
modified, staged, renamed, deleted, or untracked. For applicable work the result includes
DONE-GATE-STAGE-1 PASS; for not-applicable work it includes the author verdict and reason. The
orchestrator then commits the guardian's PASS and status transition as a planning-only checkpoint before
entering Phase 3. Add one reusable Node guard that validates the checkpoint transaction in pre-commit
mode and replays the branch range in scan mode. Wire it into the existing Husky hook and
`run-all-scans`. This proves the ordering from Git state and ancestry rather than from mutable prose or
timestamps.

## Architecture Review

### Affected Scope

- `.agents/rules/backlog-execution.md` — owns the durable pre-implementation checkpoint invariant.
- `.agents/specs/gate-catalogue.md` — adds the GATE-IMPLEMENT checkpoint criterion and
  NON-COMPLIANCE trigger.
- `.agents/skills/user-execution-scenario/SKILL.md` and
  `.agents/skills/backlog-execution-orchestrator/SKILL.md` — record and sequence the PLAN result into the
  checkpoint without duplicating its criteria.
- `.husky/pre-commit` — invokes the staged-change guard before a commit is created.
- `scripts/harness/scan-user-execution-plan-order.mjs` — owns staged and branch-history enforcement.
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` — red/green repository fixtures.
- `scripts/harness/run-all-scans.mjs` and the existing auto-discovered harness test tier — register the
  scan and its contract tests in existing mandatory paths.

No package, public API, application surface, or dependency direction changes.

### Alternatives Considered

1. **Require a planning checkpoint commit and verify its worktree isolation plus ancestry at commit time
   and in CI.** Pro: objectively distinguishes pre-implementation PLAN from retrospective prose, catches
   code hidden outside the index, and blocks both the first local implementation commit and a hook bypass
   before merge. Con: every governed work unit gains one small planning commit that a later squash merge
   collapses.
2. **Require only an ordered Evidence Log entry in the final spec.** Pro: minimal implementation and no
   extra commit. Con: the same retrospective edit can insert the entry above GATE-IMPLEMENT, so the check
   proves layout rather than history.
3. **Use ledger timestamps to compare PLAN and GATE-IMPLEMENT.** Pro: reuses current loop-run records.
   Con: wall clocks and post-hoc ledger edits are not causal proof, and the current ledger does not bind a
   run to one exact Task plus implementation diff.
4. **Enforce only through GATE-IMPLEMENT guardian prose.** Pro: no new script or hook. Con: the reproduced
   defect already passed through model-driven sequencing; a skipped guardian invocation stays invisible.

### Decision

Choose alternative 1. The checkpoint commit is the smallest durable causal boundary already native to
the repository. One engine evaluates the full worktree/index checkpoint transaction, subsequent staged
changes, and committed branch history so the hook and CI cannot drift on what counts as implementation
or sufficient PLAN evidence. GATE-IMPLEMENT remains the judgment owner: it validates the complete PLAN
result and clean pre-implementation tree, then emits PASS. The orchestrator owns committing that PASS;
only after HEAD contains the checkpoint may Phase 3 begin.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `spec-user-execution-section`, `backlog-gate-guard`, `user-execution-scenario`,
      `backlog-execution-orchestrator`, the Husky pre-commit hook, and `run-all-scans` inspected.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None. An unreadable base, ambiguous Task, missing checkpoint, stale Task binding, or Git query failure is
a blocking finding rather than a degraded pass.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable. The independent scenario author found that this changes internal repository lifecycle
governance, gate ordering, and harness fixtures only. It delivers no runnable product behavior through
the CLI, TUI, browser, or public SDK, and harness commands are engineering verification rather than
user-execution scenarios. No hidden user-facing capability is introduced behind an internal seam.

## Solution

Define a planning checkpoint as a commit whose tree contains, for one exact Task ID, a complete PLAN
outcome and the paired spec's GATE-IMPLEMENT PASS while changing only the exact paired Task, paired spec,
and subject-bound PLAN ledger evidence. A not-applicable outcome contains the author verdict and reason;
an applicable outcome contains the author verdict plus DONE-GATE-STAGE-1 PASS. Markdown outside this
allowlist—including rules, skills, and documentation—is implementation, not a docs-only exemption.

The lifecycle has two non-circular steps. First, GATE-IMPLEMENT evaluates the PLAN evidence and confirms
that no non-planning path is modified, staged, renamed, deleted, or untracked; it then appends PASS.
Second, the orchestrator immediately commits that PASS, the status transition, the exact Task/spec pair,
and any subject-bound PLAN ledger record as the dedicated checkpoint. Phase 3 may begin only after HEAD
contains that valid checkpoint.

The guard has two modes. `--staged` first validates a proposed checkpoint against the entire working tree
and index, then refuses later staged implementation paths unless HEAD already contains that checkpoint.
Default scan mode locates the topic branch's merge base, replays every commit after it, and refuses a
mixed, missing, ambiguous, or reordered checkpoint. Rename and deletion paths are judged from both sides;
Git query failures and multiple Task bindings fail closed. The range never begins at Task/spec
introduction, because that would let earlier implementation hide outside the audit.

There is one narrowly validated pre-checkpoint prelude for the operational record a previous merge can
only append after that merge: a commit may change only `.agents/loop-runs/post-merge-cycle.jsonl`, must
append exactly one structurally valid closed record without altering prior lines, and must reference a PR
and merge commit that are verifiably landed in the topic merge base. Any unverifiable reference,
rewritten historical line, extra path, or ledger-plus-implementation mixture is implementation before
PLAN and fails. The existing section-presence scan stays focused on its legacy adoption floor; it does
not become a second ordering owner.

## Affected Files

- `.agents/rules/backlog-execution.md`
- `.agents/specs/gate-catalogue.md`
- `.agents/skills/user-execution-scenario/SKILL.md`
- `.agents/skills/backlog-execution-orchestrator/SKILL.md`
- `.husky/pre-commit`
- `scripts/harness/scan-user-execution-plan-order.mjs`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
- `scripts/harness/run-all-scans.mjs`
- `.agents/tasks/HARNESS-121-user-scenario-plan-order-is-not-enforced.md`

## Completion Criteria

- [x] TC-01: GATE-IMPLEMENT requires the exact Task's complete PLAN outcome and a worktree with no
      non-planning modification before emitting PASS; the orchestrator commits that PASS as a dedicated
      checkpoint before Phase 3. Missing, stale, retrospective, ambiguous, or unreadable evidence fails
      closed.
- [x] TC-02: `node scripts/harness/scan-user-execution-plan-order.mjs --staged` exits 1 when staged
      implementation has no checkpoint ancestor, when implementation is hidden unstaged/untracked during
      a proposed checkpoint, or when a rename/deletion crosses the allowlist; it exits 0 after a valid
      checkpoint.
- [x] TC-03: the default scan exits 1 for retrospective PLAN, implementation without an author verdict,
      applicable PLAN without DONE-GATE-STAGE-1, a subject mismatch, ambiguous Tasks, arbitrary Markdown
      implementation before later Task/spec introduction, and a checkpoint that mixes planning with
      implementation; it exits 0 for applicable and not-applicable valid sequences and for one valid
      predecessor post-merge ledger prelude.
- [x] TC-04: the pre-commit hook and mandatory scan/test registries invoke the one guard and its contract
      suite, and focused/full harness verification exits 0.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                  | Notes                                                                                                                                                                                                                                                                                                                             |
| ----- | --------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | INFRA     | contract fixture + text contract                 | PASS — `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` > `user-execution PLAN order — branch history`, `user-execution PLAN order — staged transaction`, and `user-execution PLAN order — repository contract` assert exact binding, canonical outcomes, isolation, checkpoint order, and fail-closed errors. |
| TC-02 | INFRA     | temporary Git repositories, `--staged` mode      | PASS — `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` > `user-execution PLAN order — staged transaction` rejects missing checkpoints, hidden unstaged/untracked implementation, and rename/deletion crossings, then accepts a valid ancestor.                                                                |
| TC-03 | INFRA     | temporary Git repositories, branch-history mode  | PASS — `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` > `user-execution PLAN order — branch history` covers the complete valid/invalid history matrix; the live branch scan also passed across two topic commits.                                                                                            |
| TC-04 | INFRA     | hook/registry assertions + focused/full commands | PASS — `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` > `user-execution PLAN order — repository contract` and `scripts/harness/__tests__/scan-guard-scope-fail-closed.test.mjs` > `derivation (the half that cannot be dodged by editing a table)` / `the scan as a whole`; all full gates passed.           |

## Tasks

- [x] `.agents/tasks/completed/HARNESS-121-user-scenario-plan-order-is-not-enforced.md` — completed Task;
      GATE-IMPLEMENT validated the TC mapping after approval.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-25

**Status upgrade:** draft → review-ready

- Frontmatter opening block: the file begins with a complete `---` YAML frontmatter block.
- Frontmatter status: `status: draft` is present.
- Frontmatter type: `type: INFRA` is one exact value from the permitted type list.
- Frontmatter tags: `tags: [async]` is present.
- Problem symptom: the document identifies the concrete HARNESS-119 behavior in which implementation preceded PLAN and retrospective evidence made the final tree indistinguishable from a correctly ordered run.
- Problem reproduction condition: the gap occurs when implementation begins before PLAN, then the missing scenario section and author verdict are added retrospectively.
- Problem specificity: the section contains neither `TBD` nor `TODO` and is a substantiated multi-paragraph description rather than a vague single sentence.
- Prior Art Research section: `## Prior Art Research` is present.
- Research substantiation: the section cites the official Git `githooks`, `diff`, and `merge-base` documentation plus GitHub pull-request merge documentation.
- Research waiver: N/A — the section supplies qualifying primary documentation, so no waiver is required.
- Research-to-decision trace: the staged-index, ancestry, and squash-merge findings directly support the checkpoint-commit recommendation and the selected alternative.
- Architecture checklist: all four declared checklist items are checked `[x]`.
- Sibling scan: the checked item names `spec-user-execution-section`, `backlog-gate-guard`, `user-execution-scenario`, `backlog-execution-orchestrator`, the pre-commit hook, and `run-all-scans` as inspected siblings.
- Alternatives: four alternatives are recorded, each with an explicit pro and con.
- Decision trade-off: the Decision selects ancestry-backed alternative 1 because it supplies a durable causal boundary while accepting the cost of one planning commit that squash merge later collapses.
- New-surface placement: N/A — Affected Scope explicitly states that no package, public API, application surface, or dependency direction changes, so no new surface or boundary is introduced.
- Completion Criteria prefixes: all four criteria use unique `TC-01` through `TC-04` prefixes.
- Completion Criteria coverage: the four criteria separately cover the gate contract, staged enforcement, branch-history enforcement, and mandatory hook/scan/test reachability.
- Completion Criteria observability: every criterion specifies an observable requirement such as a required ancestor, exact exit status, covered invalid histories, or mandatory invocation path.
- Completion Criteria wording: none uses the prohibited phrases `works correctly`, `no errors`, `implemented`, or `displays correctly`.
- Test Plan section: `## Test Plan` is present.
- Test Plan count: four rows map one-to-one to the four Completion Criteria (`TC-01` through `TC-04`).
- Test Plan completeness: every row has a non-empty Test Type and Tool / Approach, with no `TBD` value.
- Manual-test rationale: N/A — no Test Plan row uses `manual` as its tool.
- Tasks structure: `## Tasks` is present with an unchecked active-task placeholder.
- Evidence structure: `## Evidence Log` was present and empty before this first GATE-WRITE entry.
- Body structure: the document contains neither a `## Status` nor a `## Classification` body section.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-25

**Status upgrade:** review-ready → approved

- Explicit user approval: on 2026-08-25 the user stated verbatim:
  > 승인함. 앞으로의
  > 모든
  > 작업도 승인함
- Direct and unambiguous scope: the statement answered the immediately preceding question, `이 HARNESS-121 설계와 .husky/pre-commit 변경을 승인하시나요?`, and explicitly approved this HARNESS-121 design and its implementation.
- Post-approval architecture/frontmatter integrity: no Architecture Review content or frontmatter type/tags was modified after the approval; the document remains `type: INFRA` with `tags: [async]` and the reviewed Architecture Review intact.
- Independent architecture validation: N/A — the Affected Scope explicitly introduces no package, app, public API, application surface, layer reclassification, product-family boundary, or dependency-direction change, so the conditional independent-placement criterion does not apply.
- Pre-approval implementation check: `git status --short` showed only the paired planning artifacts (`.agents/tasks/HARNESS-121-user-scenario-plan-order-is-not-enforced.md` and this spec); no implementation file edit or implementation commit preceded this gate.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-25

**Status upgrade:** approved → in-progress

- Ordering: the immediately preceding Evidence Log entry is a specific `GATE-APPROVAL` PASS dated 2026-08-25, and the spec is `status: approved` in `.agents/spec-docs/todo/`, the required input state and folder.
- Task artifact: `.agents/tasks/HARNESS-121-user-scenario-plan-order-is-not-enforced.md` exists and is the exact active Task for this spec.
- Task binding: the spec's `## Tasks` section records `.agents/tasks/HARNESS-121-user-scenario-plan-order-is-not-enforced.md` explicitly.
- TC correspondence: Task 1 owns the durable work-unit-bound lifecycle signal for TC-01; Task 2 owns the clean-tree gate and planning-only checkpoint boundary for TC-01/TC-02; Task 3 owns the staged and branch-history red/green fixture matrix for TC-02/TC-03; Task 4 owns orchestration-path reconciliation, with the fixture and integration work covering TC-04 reachability.
- Task Test Plan: the Task contains a substantive `## Test Plan` section longer than 50 characters, requiring focused lifecycle/guardian fixtures, the complete harness contract tier, and `pnpm harness:scan`.
- Subject-bound PLAN terminal result: the exact Task's `## User Execution Test Scenarios` section records `SCENARIO DRAFTED: not-applicable | 0` and gives a concrete reason: the work changes internal lifecycle governance and harness enforcement only, with no CLI, TUI, browser, or public-SDK behavior. DONE-GATE-STAGE-1 is therefore N/A for this not-applicable outcome.
- Whole-worktree precondition: `git status --short --untracked-files=all`, unstaged name-status, and staged name-status showed no staged change and only the exact paired planning artifacts modified/untracked: `.agents/tasks/HARNESS-121-user-scenario-plan-order-is-not-enforced.md` and `.agents/spec-docs/todo/HARNESS-121-user-scenario-plan-order-is-not-enforced.md`; no implementation path, extra planning path, rename, or deletion is present.
- Existing-catalogue NON-COMPLIANCE trigger: N/A — the exact Task exists, and no implementation change or implementation commit exists before this gate.

### [GATE-VERIFY] — ✅ PASS | 2026-08-26

**Status upgrade:** in-progress → verifying

- Task completion: all four Plan items in `.agents/tasks/HARNESS-121-user-scenario-plan-order-is-not-enforced.md` are `[x]`; no item is pending or blocked.
- Build: `pnpm build` completed successfully for the full monorepo with exit code 0.
- Tests: `pnpm test` completed successfully for the full monorepo with exit code 0.
- Independent reproduction: the verifier reran 78 focused tests, 31 guard-scope tests, the two-commit live history scan, all 144 mandatory scans with 2 declared policy skips, and 178 contract files/3,883 tests; every command exited 0.
- Independent review: local review round A36 reported `ACTIONABLE FINDINGS: 0`, and `git diff --check` exited 0.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-26

- Command/action: `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` plus direct inspection of `.agents/rules/backlog-execution.md`, `.agents/specs/gate-catalogue.md`, `.agents/skills/user-execution-scenario/SKILL.md`, and `.agents/skills/backlog-execution-orchestrator/SKILL.md`.
- Observed result: the exact Task binding, canonical applicable/not-applicable PLAN results, whole-worktree isolation, planning-only checkpoint order, fail-closed Git errors, and single ordering owner all passed; 78 tests passed.
- Exit code: 0.
- Test written: `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` > `user-execution PLAN order — branch history`, `user-execution PLAN order — staged transaction`, and `user-execution PLAN order — repository contract`.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-26

- Command/action: `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` with the `--staged` transaction fixtures.
- Observed result: missing checkpoint ancestors, hidden unstaged/untracked implementation, and allowlist-crossing renames/deletions were rejected; staged implementation after a valid checkpoint was accepted.
- Exit code: 0.
- Test written: `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` > `user-execution PLAN order — staged transaction`.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-26

- Command/action: `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` and `node scripts/harness/scan-user-execution-plan-order.mjs` on `fix/user-scenario-plan-order`.
- Observed result: the complete retrospective/missing/mismatched/ambiguous/mixed/forged history matrix behaved as specified; the live scan examined two topic commits and reported no finding.
- Exit code: 0 for both commands.
- Test written: `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` > `user-execution PLAN order — branch history`.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-26

- Command/action: `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs scripts/harness/__tests__/scan-guard-scope-fail-closed.test.mjs`, `pnpm harness:scan`, `pnpm harness:test:contracts`, and `pnpm build && pnpm test`.
- Observed result: focused/guard-scope tests passed 109/109; the pre-commit and mandatory scan registries reached the guard; all 144 scans passed with 2 declared policy skips; 178 contract files/3,883 tests passed; the full build and test completed successfully.
- Exit code: 0 for every command.
- Test written: `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` > `user-execution PLAN order — repository contract`; `scripts/harness/__tests__/scan-guard-scope-fail-closed.test.mjs` > `derivation (the half that cannot be dodged by editing a table)` and `the scan as a whole`.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-26

**Status upgrade:** verifying → done

- TC evidence: TC-01 through TC-04 are all `[x]`, and every matching Evidence Log entry records the exact verification action, observed result, exit code 0, and durable test file plus describe reference.
- Test Plan: all four rows directly name their durable test files and exact describe blocks; no TC is silently unaddressed or skipped.
- Task readiness: the exact Task completed all four Plan items with no pending or blocked work before this PASS.
- Independent verdict: the GATE-COMPLETE guardian reran the 109 focused/guard-scope tests and the two-commit live scan, verified all catalogue criteria, and returned `GATE VERDICT: PASS`.
- Post-PASS handoff: Task status/date, Task archival, archived Task pointer, and this spec's `done` status/folder transition are applied atomically by the orchestrator.
- Final-state verification: after exact-HEAD review required the canonical `Enforced by:` declaration, `pnpm harness:scan` exited 0 on the committed fix with 145 scans passed and 1 declared policy skip; new-rule enforcement, folder/status agreement, Task archival, done evidence, and backlog placement all passed.
- Pre-push hermetic closure: the first push attempt was blocked before reaching the remote because `frontmatter-parser-ssot` found a hand-rolled `status` regex. The guard now imports the owned `frontmatterObject` and `asScalar` boundary helpers; the SSOT/lifecycle/guard tests passed 122/122 and `pnpm harness:test:hermetic` passed 1,149/1,149, both with exit code 0.
