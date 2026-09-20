---
status: done
type: INFRA
tags: [cli]
lane: L2
---

# BRANCH-2664: Make stacked initiative history admissible to plan-order verification

Paired with `.agents/tasks/completed/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md`. Arising from [issue #2664](https://github.com/woojubb/robota/issues/2664).

## Problem

The documented multi-backlog workflow merges each completed child PR into an integration base and
then opens one final PR from that base to `develop`. Two enforcing paths reject that documented
history:

1. `.claude/hooks/pre-push-check.sh` rejects every merge commit in
   `origin/develop..HEAD`, including merge commits already contained in an explicitly declared
   `HARNESS_BASE_REF` integration parent.
2. `scan-user-execution-plan-order.mjs` rejects the final integration range because it treats the
   second child checkpoint as an unrelated second work unit, even when the range begins with one
   valid atomic AGREEMENT whose ordered `children` list names both units.

The current reproduction is `origin/fix/2664-gate-correctness@153a3a412`, which contains completed
BEHAVIOR-2664 and DATA-2664 child histories. A RULE-2582 child based on that ref is blocked before
push, while the final parent scan reports multiple planning checkpoints. Replacing the parent with
an equal-tree synthetic commit is not valid: it moves the merge base to `origin/develop` and expands
the review scope from 12 child paths to 27 aggregate paths.

## Prior Art Research

Waived: This is a repository-specific git-history invariant with no external product behavior; the repository scanner, branch policy, and measured failing history are the authoritative prior art.

## Architecture Review

### Affected Scope

- `.claude/hooks/pre-push-check.sh` — branch-hygiene validation for an explicitly declared stacked base.
- `.claude/hooks/branch-guard.sh` — integration-base naming and explicit child-base creation route.
- `scripts/harness/scan-user-execution-plan-order.mjs` — AGREEMENT-led initiative history analysis.
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` — integration-history regressions.
- `scripts/harness/__tests__/review-before-push.test.mjs` — declared-base push regressions.
- `scripts/harness/__tests__/branch-guard.test.mjs` or the existing owning branch-guard test module —
  integration-name and explicit base-override regressions.
- `.agents/rules/git-branch.md`, `.agents/rules/backlog-execution.md`, and
  `.agents/skills/multi-backlog-initiative/SKILL.md` — one documented contract for the supported route.

### Alternatives Considered

1. Flatten or synthesize the integration parent before every child and final PR.
   - Pro: Existing single-work-unit checks need no code change.
   - Con: The real target is no longer an ancestor, three-dot review scope widens, and the review is
     no longer bound to the branch the child actually targets. The measured RULE-2582 attempt grew
     from 12 to 27 paths and was independently rejected.
2. Bypass the hook or admin-merge the final PR with the plan-order check red.
   - Pro: Fastest one-off route for issue #2664.
   - Con: It suppresses two valid safety questions instead of distinguishing supported stacked
     ancestry from a feature branch accidentally based on `main`.
3. Teach both enforcing paths the existing initiative contract, with a remotely rooted integration
   identity and merge-bounded child histories, and keep fail-closed validation.
   - Pro: Preserves actual ancestry, child review bases, ordinary feature-branch protection, and the
     documented integration-base workflow.
   - Con: Requires bounded changes to two enforcement surfaces and their contract tests.

### Decision

Choose alternative 3.

**Delivery mode:** `single`

An initiative base has the explicit lowercase remote identity
`origin/integration/<agreement-id>` (for example, `origin/integration/agreement-2664`). Its first
push is still subject to the ordinary zero-foreign-merge rule and must therefore start from fresh
`origin/develop`. The ref's tree must contain the matching open AGREEMENT Task/spec pair. A stacked
child declares that exact remote ref inline on its push. The declaration is a claim to verify, not an
exemption: the hook rejects `HEAD`, the current branch, `origin/main`, main-derived aliases, local or
unresolved refs, mismatched AGREEMENT IDs, duplicate declarations, and declarations not bound to each
individual push statement. Every foreign merge in a child must already be an ancestor of the trusted
remote integration base.

An integration-base sync is the only merge that may be newer than its declared remote base: exactly
one clean merge at `HEAD`, whose first parent is the declared remote integration ref and whose second
parent is current `origin/develop`. Any own-path resolution, additional merge, reversed parent, or
stale second parent remains refused.

Plan-order verification recognizes multiple children only on an `integration/<AGREEMENT-ID>` head
whose history begins with the matching valid atomic AGREEMENT. It walks the integration branch's
first-parent merges. Each child merge's second-parent range is independently passed through the
existing single-work-unit analysis against that merge's first parent; this preserves the full
checkpoint-before-implementation state machine, including continuation and correction forms, instead
of attempting to infer ownership from one flattened range. Child IDs must be a unique ordered prefix
of the AGREEMENT `children` list. Prefixes are valid while the integration base is in progress; final
completeness belongs to the existing AGREEMENT GATE-COMPLETE/task-projection checks and the
multi-backlog final-PR gate, not to plan-order.

Reachability covers local PreToolUse push checks, Husky/CI base resolution, affected scans, child PRs,
and final initiative PRs. Capability is preserved because ordinary branches continue through the
unchanged single-unit path, the integration identity is independently rooted at an origin ref created
cleanly from develop, and each child is judged by the same existing state machine. Adversarial review
must probe self-authorizing refs, exact sync parent roles, malformed child segments, prefix/final
semantics, and multiple push statements before approval.

Post-landing initiative handoff — explicitly owned by `AGREEMENT-2664`, not a BRANCH-2664 completion
deliverable — migrates the active legacy base without copying its foreign-merge history or
manufacturing an equal-tree parent. After this prerequisite lands, create
`integration/agreement-2664` from fresh `origin/develop` with the existing explicit
`BRANCH_GUARD_ALLOW_OPEN_BRANCHES=1` form because the immutable legacy branch remains intentionally
unmerged during verification. Then replay only the two AGREEMENT planning commits. Recreate the
completed child branches from that trusted base by replaying each child's non-merge commits in
original order; open and merge new child PRs one at a time. Verification compares the ordered stable patch-ID sequence of every replayed
non-merge commit and the base-relative changed-path set for each planning or child segment. Absolute
tip blobs and whole-tree equality are not claimed because fresh develop can legitimately change an
old-delta path such as the shared loop ledger before the replay. The old
`fix/2664-gate-correctness` ref remains immutable until patch-order, relative-path, and new merge
landing verification completes, then follows normal post-merge cleanup. No remote ref copy,
API-created ref, hook bypass, or synthetic parent is part of the route.

`branch-guard.sh` accepts the `integration/<agreement-id>` name only when creation starts at fresh
`origin/develop`. Child branches remain deliberate non-develop-base creations while the integration
base itself remains open, and therefore use both existing inline forms:
`BRANCH_GUARD_ALLOW_OPEN_BRANCHES=1 BRANCH_GUARD_ALLOW_BASE=1`. The owner documents make both
required exceptions explicit rather than silently widening either ordinary guard.

**Independent recommendation review:** `REVIEW VERDICT: ENDORSE` on 2026-09-20 after four bounded
revision rounds covering trusted identity, exact sync ancestry, merge-bounded child analysis,
intermediate/final ownership, statement binding, branch-guard reachability, and migration evidence.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: This is a repository-specific git-history invariant with no external product behavior; the repository scanner, branch policy, and measured failing history are the authoritative prior art.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. Add RED fixtures for the exact measured two-child AGREEMENT merge graph and trusted stacked-base push.
2. Refactor plan-order history analysis so the existing single-unit path remains unchanged and an
   `integration/<AGREEMENT-ID>` path validates each clean child merge's second-parent history through
   that same path, accepting only a unique ordered child prefix.
3. Extend pre-push branch hygiene to read one inline
   `HARNESS_BASE_REF=origin/integration/<agreement-id>` bound to each push statement, validate the
   matching remote AGREEMENT identity, and prove child containment or one exact clean sync merge.
4. Extend branch-guard naming for `integration/<agreement-id>` created from fresh develop and document
   the existing inline base override as mandatory for child creation.
5. Update the three owner documents to require the explicit base declaration and describe final
   AGREEMENT-led validation.
6. Re-run the current issue #2664 parent history, focused suites, and affected scans. The actual
   RULE-2582 network push is the subsequent initiative continuation after this prerequisite lands,
   not evidence this branch can produce before its own merge.

## Affected Files

- `.claude/hooks/pre-push-check.sh`
- `.claude/hooks/branch-guard.sh`
- `scripts/harness/scan-user-execution-plan-order.mjs`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
- `scripts/harness/__tests__/review-before-push.test.mjs`
- `scripts/harness/__tests__/branch-guard*.test.mjs`
- `.agents/rules/git-branch.md`
- `.agents/rules/backlog-execution.md`
- `.agents/skills/multi-backlog-initiative/SKILL.md`

## Completion Criteria

- [x] TC-01: A fixture matching the exact issue #2664 atomic AGREEMENT and clean merge graph for
      BEHAVIOR-2664 then DATA-2664 returns zero plan-order findings, resolving all four findings
      reproduced from `f05926eca..153a3a412`; the test fails before implementation.
- [x] TC-02: A non-integration head with two checkpoints, or an integration head with duplicate,
      out-of-order, undeclared, non-merge-bounded, or malformed child history, returns respectively
      `multiple planning checkpoint candidates`, `duplicate initiative child`, `out-of-order
initiative child`, `undeclared initiative child`, `child history is not merge-bounded`, or the
      existing `implementation or invalid-lifecycle path(s) changed before the planning checkpoint`,
      `checkpoint is neither the first GATE-IMPLEMENT PASS`, or `GATE-IMPLEMENT checkpoint binding
failed` finding. First-form, continuation, and correction child histories are each covered.
- [x] TC-03: An inline
      `HARNESS_BASE_REF=origin/integration/agreement-2664 git push` fixture exits 0 only when the
      remote ref contains the matching open AGREEMENT pair, is an ancestor of the child HEAD, and
      contains every merge in `origin/develop..HEAD`; the accepted fixture fails before implementation.
- [x] TC-04: `HEAD`, the current branch, `origin/main`, a main-derived alias, a local/unresolved ref,
      a mismatched AGREEMENT identity, a non-ancestor/incomplete remote base, duplicate or quoted
      declarations, and one declared plus one undeclared push statement each exit 2 with a stable
      `trusted integration base` or `each push statement` refusal; the ordinary undeclared
      main-derived case retains `carries merge commits in its range over origin/develop`.
- [x] TC-05: An integration-base sync fixture exits 0 only for one clean HEAD merge whose first parent
      is the declared remote integration ref and second parent is current `origin/develop`; own-path,
      extra-merge, reversed-parent, and stale-develop variants exit 2 with `invalid integration-base sync`.
- [x] TC-06: Separate bounded Vitest invocations for
      `scan-user-execution-plan-order.test.mjs`, `review-before-push.test.mjs`, and all six explicit
      `branch-guard-*.test.mjs` files exit 0 with the thread pool and one worker.
- [x] TC-07: `HARNESS_BASE_REF=origin/develop node scripts/harness/run-all-scans.mjs --affected --context pr` exits 0 apart from repository-baseline advisories explicitly classified by the runner.
- [x] TC-08: Creating `integration/agreement-2664` from fresh `origin/develop` passes branch guard;
      the same name from another base fails, an unsupported `integration/*` spelling fails, and a
      child created from the open trusted base passes only with inline
      `BRANCH_GUARD_ALLOW_OPEN_BRANCHES=1 BRANCH_GUARD_ALLOW_BASE=1`; either assignment alone fails.
- [x] TC-09: `.agents/rules/git-branch.md`, `.agents/rules/backlog-execution.md`, and
      `.agents/skills/multi-backlog-initiative/SKILL.md` each name the inline
      `HARNESS_BASE_REF=origin/integration/<agreement-id>` push contract, exact clean-sync shape,
      merge-bounded child validation, ordered-prefix semantics, both mandatory child-creation overrides,
      `BRANCH_GUARD_ALLOW_OPEN_BRANCHES=1` migration creation, replay patch-order and base-relative
      changed-path equivalence, legacy-ref immutability, and the separate final-completeness owner;
      `pnpm harness:scan -- --only rule-case-narrative,skill-registration` exits 0.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                               | Notes                                      |
| ----- | ----------- | ----------------------------------------------------------------------------- | ------------------------------------------ |
| TC-01 | Integration | `scan-user-execution-plan-order.test.mjs`                                     | RED on the exact measured merge graph      |
| TC-02 | Integration | Negative child-merge matrix in `scan-user-execution-plan-order.test.mjs`      | Reuses single-unit state machine           |
| TC-03 | Integration | Executed hook fixture in `review-before-push.test.mjs`                        | Trusted remote integration identity        |
| TC-04 | Integration | Adversarial declaration/statement matrix in `review-before-push.test.mjs`     | No self-authorizing claim                  |
| TC-05 | Integration | Exact-parent sync matrix in `review-before-push.test.mjs`                     | One narrow base-sync shape                 |
| TC-06 | Suite       | Separate bounded Vitest runs over plan-order, pre-push, and six branch files  | Avoids worker RPC and shell-glob ambiguity |
| TC-07 | Suite       | `run-all-scans.mjs --affected --context pr`                                   | Affected repository gates                  |
| TC-08 | Integration | Existing branch-guard executed fixture suite                                  | Trusted base name and both child overrides |
| TC-09 | Contract    | Owner-document assertions plus `rule-case-narrative,skill-registration` scans | Three owners state one route               |

## User Execution Test Scenarios

Not applicable.

**Reason:** No runnable user-facing behaviour changes; verification evidence is recorded in the
engineering test plan (TC-01 to TC-09).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [x] `.agents/tasks/completed/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md` — done

## Evidence Log

### [IMPLEMENTATION VERIFICATION] — ✅ PASS | 2026-09-20

- Plan-order history: `scan-user-execution-plan-order.test.mjs` passed 266/266, including the exact
  two-child graph, ordered-prefix refusals, first-form/continuation/correction child checkpoints,
  direct implementation before or without a first child merge, persisted conflict-marker sync trees,
  and stale unpushed develop sync rejection.
- Branch guard: all six `branch-guard-*.test.mjs` files passed 133/133, including remote-develop
  freshness, trusted integration naming, and the two required child-creation overrides.
- Pre-push: `review-before-push.test.mjs` passed 51/51, including statement binding, remote identity,
  inherited merge containment, conflict-tree rejection, and the exact clean-sync matrix.
- Contract and syntax checks passed: `bash -n`, `git diff --check`, Prettier for supported changed
  files, and the rule-case-narrative, skill-registration, hook-override-declarations,
  shell-portability, spec-user-execution-section, reference-kind-qualified, and current-branch
  user-execution-plan-order scans.
- Affected PR scans exited 0: 73 passed, one skipped, and only the runner-classified pre-existing
  `progress-report-quantification` and `task-merged-citation` advisories remained.
- Independent local review initially reported five actionable findings. The repair batch now requires
  exact current-develop or remotely landed historical sync ancestry, preserves `merge-tree` conflict
  status, rejects pre-first-child direct implementation, verifies the live remote develop identity,
  and covers correction-form child history. Final retained-reviewer convergence is recorded separately
  when its verdict returns.
- The second retained-reviewer round reported three findings. Two local gaps were reproduced RED and
  fixed: zero-child integration histories now reject direct implementation, and remote lookup failure
  now emits an explicit blocking exit 2. The shared merge-tree status loss was independently classified
  FOUNDATIONAL, filed as `MERGE-2664`, and registered at
  https://github.com/woojubb/robota/issues/2664#issuecomment-5747991049. The current integration path
  carries a labelled fail-closed containment and a persisted conflict-marker-tree regression test;
  the shared staged-merge abstraction remains owned by that root Task.

### [GATE-WRITE] — ✅ PASS | 2026-09-20

**Status upgrade:** draft → review-ready

- Mechanical evaluation: PASS — `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this>` reported 20 PASS, 0 FAIL, and seven criteria reserved for the independent guardian.
- GATE-WRITE — Contains a concrete symptom: PASS — the Problem names the pre-push foreign-merge refusal and the final plan-order second-checkpoint refusal.
- GATE-WRITE — Contains a reproduction condition: PASS — the Problem binds both failures to `origin/fix/2664-gate-correctness@153a3a412`, its completed child histories, and the blocked RULE-2582 child.
- GATE-WRITE — Research findings feed Alternatives Considered / Decision: PASS — the repository-specific waiver leads to measured flatten, bypass, and contract-aware alternatives and the fail-closed choice.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — actual ancestry and child review bases are preserved without weakening accidental-main or malformed-checkpoint refusals.
- GATE-WRITE — New-surface placement (conditional): PASS (N/A) — the change extends existing hook, scanner, test, rule, and skill surfaces without adding a package, app, interface surface, or layer boundary.
- GATE-WRITE — At least one criterion per distinct feature or sub-item: PASS — TC-01 through TC-07 cover positive and negative initiative history, positive and negative explicit-base push behavior, focused and affected suites, and all three owner documents.
- GATE-WRITE — Each criterion uses Command or Observable behavior form: PASS — the negative matrices name exact finding/message fragments and exit behavior, while suite and document criteria name exact commands.

**Judged by:** `backlog-gate-guard` semantic evaluator (evidence recorded by the orchestrator from the read-only guardian verdict)
**Judged at:** HEAD `5662bbbb18db55bed9b3c209d22c0ba1d4ea93a6` · base `origin/develop@f05926ecac6d25ddca74c58aaf6eead8b4dff219` · document `.agents/spec-docs/draft/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md` blob `eee8beea2d4693308d2dd80dec202c2771a5bd88` (untracked)

### [GATE-WRITE] — ✅ PASS | 2026-09-20 (re-run)

**Status upgrade:** review-ready → review-ready (re-run after four bounded `proposal-reviewer`
revision rounds; the first PASS performed the transition and this entry attests the current design)

- Mechanical evaluation: PASS — the final `gate.mjs judge --gate GATE-WRITE` re-run reported 20 PASS, 0 FAIL, and seven semantic criteria pending; it counted nine TC criteria and nine Test Plan rows.
- GATE-WRITE — Contains a concrete symptom: PASS — both the foreign-merge push refusal and multi-child plan-order refusal remain specific.
- GATE-WRITE — Contains a reproduction condition: PASS — the exact legacy ref, two completed children, blocked RULE-2582 continuation, four scanner findings, and 12-to-27 path expansion are named.
- GATE-WRITE — Research findings feed Alternatives Considered / Decision: PASS — repository-owned measurements ground the flatten, bypass, and trusted-integration alternatives.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — remote identity, exact sync parents, merge-bounded child analysis, and statement binding preserve real ancestry without weakening ordinary refusals.
- GATE-WRITE — New-surface placement (conditional): PASS (N/A) — existing repository-control surfaces are extended without a package, app, interface surface, or product-family boundary.
- GATE-WRITE — At least one criterion per distinct feature or sub-item: PASS — TC-01 through TC-09 cover plan-order, trusted pushes, exact sync, focused/affected verification, branch guard, and all owner-document contracts; migration execution is an explicit AGREEMENT-2664 handoff.
- GATE-WRITE — Each criterion uses Command or Observable behavior form: PASS — all nine TCs state exact findings, message fragments, exit behavior, commands, allow/refuse outcomes, or document assertions.
- Independent recommendation review: PASS — `proposal-reviewer` returned `REVIEW VERDICT: ENDORSE` after the final corrections for both child-creation overrides and base-relative replay evidence.

**Judged by:** `backlog-gate-guard` semantic evaluator and independent `proposal-reviewer` (evidence recorded by the orchestrator from read-only verdicts)
**Judged at:** HEAD `5662bbbb18db55bed9b3c209d22c0ba1d4ea93a6` · base `origin/develop@f05926ecac6d25ddca74c58aaf6eead8b4dff219` · document `.agents/spec-docs/backlog/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md` blob `00f9ac4f0ccdb5a4ae7c0ef8a819bee7381348ad` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인합니다. 그리고 앞으로 타당한 근거와 함께 추천안을 제시하면 근거가 타당할 경우 자동으로 승인합니다."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** bf9e9e93f38d (review 32c8f66e, type/tags d024da1a)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (bf9e9e93f38d) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the recorded instruction begins `승인합니다.` and its future standing condition is satisfied by the independent `REVIEW VERDICT: ENDORSE` recorded above.
- GATE-APPROVAL — The item is inside the class as the registry defines it: PASS (N/A) — this is route DIRECT, so no delegated class or class boundary applies.
- GATE-APPROVAL — Independent architecture validation (conditional): PASS (N/A, independently corroborated) — no new package, app, surface, layer, or product-family placement is introduced; the proposal reviewer independently ENDORSED the enforcement design after its bounded revisions.

**Judged by:** `gate.mjs` mechanical evaluator plus `backlog-gate-guard` semantic evaluator (guardian evidence recorded by the orchestrator from the read-only verdict)
**Judged at:** HEAD `5662bbbb18db` · base `origin/develop@f05926ecac6d` · document `.agents/spec-docs/backlog/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md` blob `caa9b164cef0` (untracked)

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-20

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names 0/9 TC ids and carries 5 checkbox task(s)
  **Required action:** one task per TC-N
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task Test Plan/Testing section is 0 chars (absent)
  **Required action:** write a ≥50-char test plan in the Task

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d91a2789f3d2` · base `origin/develop@867c7752984a` · document `.agents/spec-docs/todo/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md` blob `02b3ccbf4e63` (tracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** approved → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인합니다. 그리고 앞으로 타당한 근거와 함께 추천안을 제시하면 근거가 타당할 경우 자동으로 승인합니다."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** f2ff0bb47fae (review 9f7884bb, type/tags d024da1a)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (f2ff0bb47fae) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d91a2789f3d2` · base `origin/develop@867c7752984a` · document `.agents/spec-docs/todo/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md` blob `c0ef2e18f41e` (modified)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-20

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-20; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (9)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 429 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md",
  "specPath": ".agents/spec-docs/todo/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    },
    {
      "kind": "tc-id",
      "value": "TC-07"
    },
    {
      "kind": "tc-id",
      "value": "TC-08"
    },
    {
      "kind": "tc-id",
      "value": "TC-09"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md",
    ".agents/tasks/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d91a2789f3d2` · base `origin/develop@867c7752984a` · document `.agents/spec-docs/todo/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md` blob `8f3501772333` (modified)

### [GATE-VERIFY] — ❌ FAIL | 2026-09-20

**Status remains:** in-progress
**Failed criteria:**

- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): no `--verify-cmd` supplied, so nothing was run
  **Required action:** pass the build/test command(s) via --verify-cmd
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): no `--verify-cmd` supplied, so nothing was run
  **Required action:** pass the build/test command(s) via --verify-cmd

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `1c911c6c5abf` · base `origin/develop@867c7752984a` · document `.agents/spec-docs/active/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md` blob `219dd72afc4d` (modified)

### [GATE-VERIFY CORRECTION AUTHORIZATION] | 2026-09-20

**Standing instruction (verbatim):** "승인합니다. 그리고 앞으로 타당한 근거와 함께 추천안을 제시하면 근거가 타당할 경우 자동으로 승인합니다."

The failed criteria name only missing `--verify-cmd` arguments. The implementation, approved scope,
and test plan are unchanged, so the bounded correction is to re-run the same gate with the affected
PR scan as the build-shaped command and the complete plan-order, pre-push, and branch-guard Vitest
suites as the test-shaped command. This recommendation is supported by the same commands already
passing independently above; the gate re-run makes that evidence machine-bound to GATE-VERIFY.

**Judged by:** current-session orchestrator applying the recorded user standing authorization

### [GATE-VERIFY GUARDIAN] — ❌ FAIL | 2026-09-20

**Status remains:** in-progress
**Failed criteria:**

- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): the guardian's combined focused
  execution reported 317 passing assertions but exited 1 after a Vitest worker
  `Timeout calling "onTaskUpdate"`; its quoted branch-guard glob also selected no branch-guard files
  **Required action:** re-run plan-order, pre-push, and all six explicitly named branch-guard files
  as separate bounded commands that each exit 0, then re-run this guardian gate

**Judged by:** `backlog-gate-guard` semantic evaluator (read-only verdict recorded by the orchestrator)

### [GATE-VERIFY GUARDIAN CORRECTION AUTHORIZATION] | 2026-09-20

**Standing instruction (verbatim):** "승인합니다. 그리고 앞으로 타당한 근거와 함께 추천안을 제시하면 근거가 타당할 경우 자동으로 승인합니다."

The failed criterion concerns only test-process reliability and file selection. The bounded correction
keeps the approved implementation and assertions unchanged, replaces one combined test process with
three independent test-shaped commands, and names every branch-guard file explicitly. This removes
both the worker RPC failure mode and shell-glob ambiguity identified by the guardian.

**Judged by:** current-session orchestrator applying the recorded user standing authorization

### [GATE-VERIFY] — ✅ PASS | 2026-09-20

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — Every item in the Task `## Plan` is complete: TC-01 through TC-09 are all `[x]`.
- GATE-VERIFY — No Plan item is blocked or pending: no unchecked, blocked, or pending Plan item was
  found.
- GATE-VERIFY — Build passes for all affected packages: the affected PR scan exited 0 with 73 passed,
  one skipped, and only two runner-classified baseline advisories.
- GATE-VERIFY — Tests pass for all affected packages: plan-order 266/266, pre-push 51/51, and six
  explicitly named branch-guard files 133/133; all three test-shaped commands exited 0.
- Retained independent local review converged 5 → 3 → 0 actionable findings. The final reviewer
  confirmed zero-child merge bounding, the `MERGE-2664` labelled containment, explicit remote lookup
  failure blocking, owner-document alignment, and no ordinary-branch regression.

**Judged by:** `gate.mjs` mechanical evaluator plus `backlog-gate-guard` semantic evaluator (read-only
guardian verdict recorded by the orchestrator)

### [GATE-COMPLETE] — ❌ FAIL | 2026-09-20

**Status remains:** verifying
**Failed criteria:**

- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: no `[GATE-COMPLETE: TC-N]` entry for TC-01, TC-02, TC-03, TC-04, TC-05, TC-06, TC-07, TC-08, TC-09
  **Required action:** run `gate.mjs record` for each
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : TC-06, TC-07, TC-08, TC-09: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: TC-06, TC-07, TC-08, TC-09: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: TC-06, TC-07, TC-08, TC-09: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `1c911c6c5abf` · base `origin/develop@867c7752984a` · document `.agents/spec-docs/active/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md` blob `c9ee0412680c` (modified)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-20

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs --pool=threads --maxWorkers=1 --testTimeout=30000 --reporter=dot`
**Exit:** 0
**Output:** (last 6 of 6 line(s))

```
Observed result: exit 0.
scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs passed 266/266.
scripts/harness/__tests__/review-before-push.test.mjs passed 51/51.
The six explicit scripts/harness/__tests__/branch-guard-*.test.mjs files passed 133/133.
The affected PR scan passed 73 scans, skipped 1 non-applicable scan, and tolerated only the two runner-classified repository-baseline advisories.
Named contract, syntax, formatting, and direct harness scans all exited 0.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `1c911c6c5abf` · base `origin/develop@867c7752984a` · document `.agents/spec-docs/active/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md` blob `a243c8e3724b` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-20

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs --pool=threads --maxWorkers=1 --testTimeout=30000 --reporter=dot`
**Exit:** 0
**Output:** (last 6 of 6 line(s))

```
Observed result: exit 0.
scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs passed 266/266.
scripts/harness/__tests__/review-before-push.test.mjs passed 51/51.
The six explicit scripts/harness/__tests__/branch-guard-*.test.mjs files passed 133/133.
The affected PR scan passed 73 scans, skipped 1 non-applicable scan, and tolerated only the two runner-classified repository-baseline advisories.
Named contract, syntax, formatting, and direct harness scans all exited 0.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `1c911c6c5abf` · base `origin/develop@867c7752984a` · document `.agents/spec-docs/active/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md` blob `45a776bf5bf7` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-20

**Command:** `pnpm exec vitest run scripts/harness/__tests__/review-before-push.test.mjs --pool=threads --maxWorkers=1 --testTimeout=30000 --reporter=dot`
**Exit:** 0
**Output:** (last 6 of 6 line(s))

```
Observed result: exit 0.
scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs passed 266/266.
scripts/harness/__tests__/review-before-push.test.mjs passed 51/51.
The six explicit scripts/harness/__tests__/branch-guard-*.test.mjs files passed 133/133.
The affected PR scan passed 73 scans, skipped 1 non-applicable scan, and tolerated only the two runner-classified repository-baseline advisories.
Named contract, syntax, formatting, and direct harness scans all exited 0.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `1c911c6c5abf` · base `origin/develop@867c7752984a` · document `.agents/spec-docs/active/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md` blob `8436a7885bb9` (modified)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-20

**Command:** `pnpm exec vitest run scripts/harness/__tests__/review-before-push.test.mjs --pool=threads --maxWorkers=1 --testTimeout=30000 --reporter=dot`
**Exit:** 0
**Output:** (last 6 of 6 line(s))

```
Observed result: exit 0.
scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs passed 266/266.
scripts/harness/__tests__/review-before-push.test.mjs passed 51/51.
The six explicit scripts/harness/__tests__/branch-guard-*.test.mjs files passed 133/133.
The affected PR scan passed 73 scans, skipped 1 non-applicable scan, and tolerated only the two runner-classified repository-baseline advisories.
Named contract, syntax, formatting, and direct harness scans all exited 0.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `1c911c6c5abf` · base `origin/develop@867c7752984a` · document `.agents/spec-docs/active/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md` blob `312e4acd08ad` (modified)

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-09-20

**Command:** `pnpm exec vitest run scripts/harness/__tests__/review-before-push.test.mjs --pool=threads --maxWorkers=1 --testTimeout=30000 --reporter=dot`
**Exit:** 0
**Output:** (last 6 of 6 line(s))

```
Observed result: exit 0.
scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs passed 266/266.
scripts/harness/__tests__/review-before-push.test.mjs passed 51/51.
The six explicit scripts/harness/__tests__/branch-guard-*.test.mjs files passed 133/133.
The affected PR scan passed 73 scans, skipped 1 non-applicable scan, and tolerated only the two runner-classified repository-baseline advisories.
Named contract, syntax, formatting, and direct harness scans all exited 0.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `1c911c6c5abf` · base `origin/develop@867c7752984a` · document `.agents/spec-docs/active/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md` blob `9a5c8740b2c3` (modified)

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-09-20

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs scripts/harness/__tests__/review-before-push.test.mjs --pool=threads --maxWorkers=1 --testTimeout=30000 --reporter=dot`
**Exit:** 0
**Output:** (last 6 of 6 line(s))

```
Observed result: exit 0.
scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs passed 266/266.
scripts/harness/__tests__/review-before-push.test.mjs passed 51/51.
The six explicit scripts/harness/__tests__/branch-guard-*.test.mjs files passed 133/133.
The affected PR scan passed 73 scans, skipped 1 non-applicable scan, and tolerated only the two runner-classified repository-baseline advisories.
Named contract, syntax, formatting, and direct harness scans all exited 0.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `1c911c6c5abf` · base `origin/develop@867c7752984a` · document `.agents/spec-docs/active/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md` blob `7072b51d7eb7` (modified)

### [GATE-COMPLETE: TC-07] — ✅ PASS | 2026-09-20

**Command:** `HARNESS_BASE_REF=origin/develop node scripts/harness/run-all-scans.mjs --affected --context pr`
**Exit:** 0
**Output:** (last 6 of 6 line(s))

```
Observed result: exit 0.
scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs passed 266/266.
scripts/harness/__tests__/review-before-push.test.mjs passed 51/51.
The six explicit scripts/harness/__tests__/branch-guard-*.test.mjs files passed 133/133.
The affected PR scan passed 73 scans, skipped 1 non-applicable scan, and tolerated only the two runner-classified repository-baseline advisories.
Named contract, syntax, formatting, and direct harness scans all exited 0.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `1c911c6c5abf` · base `origin/develop@867c7752984a` · document `.agents/spec-docs/active/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md` blob `b77c9de45384` (modified)

### [GATE-COMPLETE: TC-08] — ✅ PASS | 2026-09-20

**Command:** `pnpm exec vitest run scripts/harness/__tests__/branch-guard-aliases.test.mjs scripts/harness/__tests__/branch-guard-reads-nested-commands.test.mjs scripts/harness/__tests__/branch-guard-worktree-merge.test.mjs scripts/harness/__tests__/branch-guard-judges-each-statement.test.mjs scripts/harness/__tests__/branch-guard-unmerged.test.mjs scripts/harness/__tests__/branch-guard-reads-git-branch.test.mjs --pool=threads --maxWorkers=1 --testTimeout=30000 --reporter=dot`
**Exit:** 0
**Output:** (last 6 of 6 line(s))

```
Observed result: exit 0.
scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs passed 266/266.
scripts/harness/__tests__/review-before-push.test.mjs passed 51/51.
The six explicit scripts/harness/__tests__/branch-guard-*.test.mjs files passed 133/133.
The affected PR scan passed 73 scans, skipped 1 non-applicable scan, and tolerated only the two runner-classified repository-baseline advisories.
Named contract, syntax, formatting, and direct harness scans all exited 0.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `1c911c6c5abf` · base `origin/develop@867c7752984a` · document `.agents/spec-docs/active/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md` blob `3c727f22fdbd` (modified)

### [GATE-COMPLETE: TC-09] — ✅ PASS | 2026-09-20

**Command:** `node scripts/harness/scan-rule-case-narrative.mjs && node scripts/harness/scan-skill-registration.mjs && node scripts/harness/scan-hook-override-declarations.mjs && node scripts/harness/scan-shell-portability.mjs`
**Exit:** 0
**Output:** (last 6 of 6 line(s))

```
Observed result: exit 0.
scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs passed 266/266.
scripts/harness/__tests__/review-before-push.test.mjs passed 51/51.
The six explicit scripts/harness/__tests__/branch-guard-*.test.mjs files passed 133/133.
The affected PR scan passed 73 scans, skipped 1 non-applicable scan, and tolerated only the two runner-classified repository-baseline advisories.
Named contract, syntax, formatting, and direct harness scans all exited 0.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `1c911c6c5abf` · base `origin/develop@867c7752984a` · document `.agents/spec-docs/active/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md` blob `80b60345dcaa` (modified)

### [GATE-COMPLETE] — ✅ PASS | 2026-09-20

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-09-20; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 9/9 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (9)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (9) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (9) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 9/9 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (9) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 9/9 tasks `[x]` in .agents/tasks/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `1c911c6c5abf` · base `origin/develop@867c7752984a` · document `.agents/spec-docs/active/BRANCH-2664-make-stacked-child-ancestry-publishable-under-pre-push-branch-hygiene.md` blob `2a9db14abcf6` (modified)
