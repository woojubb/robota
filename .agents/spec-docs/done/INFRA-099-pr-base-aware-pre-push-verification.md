---
status: done
type: INFRA
tags: [cli, typescript]
---

# INFRA-099: resolve pre-push verification against the current PR base

## Problem

`scripts/harness/pre-push.mjs` calls `resolveGitBaseRef()`, whose first repository fallback is
`origin/develop`. That is correct for an ordinary feature PR targeting `develop`, but incorrect for a
multi-backlog child PR targeting an integration base. On PR #1724 the actual base was
`95f74bfa029ec00cab191351b436be1d19ca6fc1` on `feat/arch-dag-runtime-completion`; the hook instead
planned against `origin/develop`, classified 99 cumulative files and 11 workspace scopes, ran the root
76-package JavaScript/declaration build, package tests/lint/typechecks, and the repository-contract tier.
After a four-document completion/archive commit, the second push repeated the same cumulative plan and
full package work.

Reproduction: push the checked-out integration-child branch, or run `pnpm harness:pre-push` manually, without
`HARNESS_BASE_REF`. The plan prints `base: origin/develop` instead of the unique same-repository OPEN PR's
`baseRefOid`. This is not merely missing cache reuse: the planner is evaluating the wrong delta. Conversely,
choosing a PR from the checkout alone during a different-branch, renamed-ref, detached, or multi-ref push
could narrow verification against the wrong base, so the optimization must be bound to the actual push update.

## Prior Art Research

Git's official pre-push contract supplies local/remote ref names and object IDs, but it does not carry a
GitHub PR target. The hook therefore cannot infer the review base from stdin alone. See
[Git githooks — pre-push](https://git-scm.com/docs/githooks).

GitHub CLI's official `gh pr list` command supports filtering by head branch and returns structured PR fields.
This is the narrowest existing host seam that can also prove candidate cardinality instead of silently choosing
one of multiple PRs. See [GitHub CLI — gh pr list](https://cli.github.com/manual/gh_pr_list).

The existing INFRA-091 exact verification receipt remains correct: a full receipt must match the exact
commit/tree/base/tool/profile. This item does not weaken receipt identity. It corrects the base input
before planning, classification, and receipt lookup. If PR discovery is absent, unauthenticated,
malformed, stale, or names an unavailable object, the hook must report that it is using the existing
`origin/develop` fallback and run the broader safe plan.

## Architecture Review

### Affected Scope

- `scripts/harness/pre-push.mjs` — pre-push base discovery and one resolved-base owner
- a small root-private `scripts/harness/` PR-base resolver beside the existing
  `pre-push-updates.mjs` Git-boundary parser/decision seam
- `scripts/harness/__tests__/**` — exact precedence, malformed/unavailable/fallback, and execution-plan tests
- `.agents/rules/verification.md` and `.agents/rules/git-branch.md` — actual PR base versus safe fallback
- `.agents/specs/verification-pipeline-plan.md` — local planning identity and evidence boundary

### Alternatives Considered

1. Keep `origin/develop` for every push.
   - Pro: no network or GitHub dependency.
   - Con: every integration child repeatedly verifies the entire accumulated initiative rather than its
     own review delta; this reproduced the user's multi-minute merge/push delay twice on one item.
2. Require callers to export `HARNESS_BASE_REF` manually.
   - Pro: exact and requires no discovery code.
   - Con: the normal `git push` path remains wrong by default, and a forgotten environment variable silently
     restores cumulative over-verification.
3. Preserve the existing resolver precedence, otherwise resolve the one same-repository OPEN PR for the
   push-bound branch through `gh pr list`, and fall back visibly when discovery cannot be trusted.
   - Pro: normal integration-child pushes plan the same comparison GitHub reviews, ordinary/no-PR pushes
     retain today's safe behavior, and receipt identity uses the same exact base.
   - Con: adds one short GitHub API call; unavailable auth/network loses the optimization but not coverage.
4. Reuse the prior commit's full receipt across a changed tree.
   - Pro: can skip nearly all local work.
   - Con: turns correctness evidence into a fuzzy cache and contradicts INFRA-091; a four-document archive
     change still legitimately affects repository-contract checks.

### Decision

Choose alternative 3. Add a pure parser/decision seam plus an imperative `gh pr list --state open --head
<branch> --json baseRefName,baseRefOid,headRefName,state,isCrossRepository` adapter. A real hook invocation
may use PR discovery only when its parsed stdin has exactly one non-delete update, `localRef` is
`refs/heads/<currentBranch>`, and `localObjectId` equals `HEAD^{commit}`. A different branch, refspec rename,
multi-ref push, or detached HEAD is an optimization miss. A manual `pnpm harness:pre-push` invocation with no
stdin may use the current attached branch and `HEAD`.

The Git hook also forwards its remote name and URL. For a real hook invocation the optimization is eligible
only when the destination name is `origin` and the hook URL exactly matches `git remote get-url origin`, because
that is the repository used by both `gh` discovery and any exact-base fetch. Another destination is a visible
broad-fallback case. Manual no-stdin execution remains eligible against the current repository's origin.

Precedence is: a nonempty explicit `HARNESS_BASE_REF`; a trusted unique PR base OID; then an unmodified call
to the existing `resolveGitBaseRef()`, which preserves `GITHUB_BASE_REF` and the
`origin/develop`/`develop`/`origin/main`/`main` candidates. An explicit but invalid override continues to flow
downstream and fail closed; it is never softened into PR discovery or fallback. A PR candidate is trusted only
when exactly one result is `OPEN`, not cross-repository, has the exact push-bound `headRefName`, has a valid
full `refs/heads/<base>` accepted by `git check-ref-format`, and has a lowercase 40- or 64-hex `baseRefOid`.

The advertised OID, never a mutable branch name, is the comparison base. If that commit object is absent,
invoke Git with an argv array—never a shell-composed string—using `git fetch --no-tags origin
refs/heads/<base>` and require `FETCH_HEAD^{commit}` to equal the advertised OID. A base move between lookup
and fetch, multiple or fork candidates, malformed output, missing object, or command failure visibly falls
back through the existing resolver. The resolver returns one source-tagged result and one fallback reason;
reporting occurs exactly once even when the eventual path is no-delta skip or receipt reuse.

Resolve once per pre-push invocation and pass the same exact base to plan, change classification, empty-diff
decision, and receipt lookup. Never copy PR-base discovery into plan/verify/receipt modules. A PR lookup
failure is an optimization miss, not a verification pass or push failure: the existing broader plan is the
fail-safe behavior.

Placement follows the existing harness split. `pre-push-updates.mjs` is the analogous owner for parsing and
decision logic at the Git pre-push boundary, while `shared.mjs` remains the owner of the generic local-Git
fallback resolver. The new PR-aware resolver therefore belongs beside `pre-push-updates.mjs` in the
root-private `scripts/harness/` internal-tooling family and is exported only to `pre-push.mjs` and its
tests. It creates no package or public SDK surface, reuses shared harness/core primitives, imports no PRODUCT
package or sibling application, and does not create a dependency from product code back into the harness.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `pre-push-updates.mjs` selected as the analogous Git-boundary seam;
      `shared.mjs`, receipt identity, and multi-backlog child flow examined; no PRODUCT sibling dependency added
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

GitHub PR discovery may be unavailable because no PR exists, the push is not exactly the checked-out branch,
the push has multiple refs, `gh` is unauthenticated, candidates are multiple/cross-repository, the network
fails, or the response/fetched object is invalid. In every such case the hook emits one named fallback reason
and delegates to the existing resolver including `GITHUB_BASE_REF`. Verification becomes slower but never
weaker or silent.

## Solution

1. Add testable push-update binding plus PR metadata/cardinality parsing with strict schema/identity validation.
2. Query the unique same-repository OPEN PR once, verify/fetch the exact advertised base object with argv-safe
   Git calls, and return a source-tagged resolved base result.
3. Make pre-push use that one result for planning, classification, receipt lookup, and reporting.
4. Add scratch Git/CLI fixtures proving an integration-child completion delta is planned against its PR base,
   while missing/malformed/mismatched discovery takes the existing broad path.
5. Synchronize verification policy and record measured before/after plan counts and elapsed owners.

## Affected Files

- `scripts/harness/pre-push.mjs`
- new or existing harness-owned pre-push base resolver under `scripts/harness/`
- focused tests under `scripts/harness/__tests__/`
- `.agents/rules/verification.md`
- `.agents/rules/git-branch.md`
- `.agents/specs/verification-pipeline-plan.md`
- paired Task/spec lifecycle artifacts

## Completion Criteria

- [x] TC-01: parser/decision tests accept only a single non-delete push of the attached current branch whose
      local OID equals `HEAD`, plus the explicit no-stdin manual path; they reject different-branch, renamed-ref,
      multi-ref, detached, deleted, mismatched-OID, or non-origin name/URL updates.
- [x] TC-02: PR/adapter tests preserve explicit override and `GITHUB_BASE_REF` precedence, accept exactly one
      same-repository OPEN exact-head candidate, reject multiple/fork/wrong-head/malformed candidates, fetch only
      the argv-safe advertised full base ref when needed, and reject lookup→fetch OID races.
- [x] TC-03: pre-push sequence tests prove one resolved base value owns plan, classification, empty-diff decision,
      and receipt lookup; no consumer independently re-resolves, and each fallback reason is printed once on
      verification, no-delta skip, and receipt-reuse paths.
- [x] TC-04: a scratch integration-child fixture whose branch contains cumulative ancestor work plus a
      four-document child delta reports the PR base OID and selects only that child delta; a no-PR twin reports
      the broad fallback and retains the cumulative plan.
- [x] TC-05: focused tests, `pnpm harness:scan`, root build/test requirements, and independent local review pass;
      hosted PR evidence shows a later push plans against the integration-base OID rather than `origin/develop`.

## Test Plan

| TC-ID | Test Type               | Tool / Approach                                                                                                                                                                                                                        | Notes                                                                                                                                          |
| ----- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Unit                    | `scripts/harness/__tests__/pre-push-base-ref.test.mjs` > `selectPushBoundBranch (INFRA-099)` > `accepts one exact current-branch push and the no-stdin manual path`                                                                    | The same suite's rejection matrix covers other/renamed/multi/detached/delete/OID/remote cases                                                  |
| TC-02 | Integration/unit        | `scripts/harness/__tests__/pre-push-base-ref.test.mjs` > `resolvePrePushBaseRef (INFRA-099)` > unique-PR, explicit/fallback precedence, full-ref fetch, fetch-race, and fetch-failure tests                                            | Exact individual test names are repeated in TC-02 completion evidence                                                                          |
| TC-03 | Sequence contract       | `scripts/harness/__tests__/pre-push-base-ref.test.mjs` > `createPrePushBasePlan (INFRA-099)` > `projects one exact base into plan, classification, decision, and receipt consumers`; sequence/structural tests named in TC-03 evidence | Same base and one report reach every consumer/path                                                                                             |
| TC-04 | Scratch Git integration | `scripts/harness/__tests__/pre-push-base-ref.test.mjs` > `integration-child delta isolation (INFRA-099)` > `excludes cumulative initiative history only when the unique PR base is trusted`                                            | Asserts exact child/fallback changed paths                                                                                                     |
| TC-05 | Regression/hosted smoke | `pnpm harness:verify-like-ci` plus PR #1725 hosted push/review evidence                                                                                                                                                                | Test skipped: GitHub/Claude credentials and push-event delivery cannot be reproduced locally; the successful exact-pair hosted run is evidence |

## Tasks

- [x] `.agents/tasks/completed/INFRA-099-pr-base-aware-pre-push-verification.md`

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-14

**Status upgrade:** draft → review-ready
Frontmatter: PASS — valid YAML frontmatter contains `status: draft`, allowed single type `INFRA`, and
`tags: [cli, typescript]`. Problem: PASS — records PR #1724's incorrect `origin/develop` planning base,
measured cumulative scope and repeated package work, plus the exact `pnpm harness:pre-push` reproduction
condition. Prior Art Research: PASS — cites official Git pre-push and GitHub CLI documentation; the findings
directly support PR-base discovery with a broad fail-safe fallback. Architecture Review: PASS — all checklist
items are checked, four alternatives carry pros/cons, and the decision documents correctness, performance,
network, and fallback trade-offs. New-surface placement: PASS — `pre-push-updates.mjs` is identified as the
analogous Git-boundary seam; the resolver is classified in the root-private `scripts/harness/core/`
internal-tooling family, reuses shared harness/core primitives, and introduces no PRODUCT or
sibling-application dependency. Completion Criteria: PASS — five observable criteria are uniquely prefixed
TC-01 through TC-05 and cover parser, adapter, sequence, scratch integration, and final verification behavior.
Test Plan: PASS — five non-empty rows map exactly to the five Completion Criteria; no manual row requires
justification. Structure: PASS — the Tasks placeholder and initially empty Evidence Log are present, with no
body-level Status or Classification section.

### [GATE-WRITE] — ✅ PASS | 2026-08-14

**Status upgrade:** draft → review-ready
Frontmatter: PASS — the revised document has valid YAML frontmatter with `status: draft`, allowed single
type `INFRA`, and `tags: [cli, typescript]`. Problem: PASS — it records PR #1724's incorrect
`origin/develop` planning base, measured cumulative work, exact reproduction, and the wrong-ref narrowing
risk that requires push-bound identity. Prior Art Research: PASS — official Git pre-push and GitHub CLI
`gh pr list` documentation substantiate the stdin identity boundary and unique-candidate discovery design.
Architecture Review: PASS — all checklist items are checked; four alternatives carry pros/cons; the decision
specifies push-update eligibility, exact precedence, candidate cardinality, same-repository validation,
argv-safe fetch, OID race rejection, and broad fallback. New-surface placement: PASS —
`pre-push-updates.mjs` is the analogous Git-boundary seam; the resolver remains in the root-private
`scripts/harness/core/` internal-tooling family, reuses shared harness/core primitives, and introduces no
PRODUCT or sibling-application dependency. Completion Criteria: PASS — five observable criteria are uniquely
prefixed TC-01 through TC-05 and cover push binding, PR/fetch trust, one-owner sequencing, scratch integration,
and final verification. Test Plan: PASS — five non-empty rows map exactly to the five Completion Criteria; no
manual row requires justification. Structure: PASS — the exact Tasks placeholder is present, the Evidence Log
preserves the prior-revision gate history, and no body-level Status or Classification section exists. Revision
handling: PASS — the earlier GATE-WRITE entry is retained only as historical evidence; this entry independently
validates the latest push-bound revision.

### [PROPOSAL-REVIEW] — ✅ ENDORSE | 2026-08-14

**Status remains:** review-ready
Independent reviewer `infra098_research` reviewed the latest push-bound revision after its five safety findings
were incorporated. It confirmed that actual pre-push stdin binds discovery to the one current-branch ref and
HEAD OID; `gh pr list` accepts only one same-repository OPEN PR; the existing resolver including
`GITHUB_BASE_REF` remains the fallback owner; fetch uses argv-safe full refs and verifies `FETCH_HEAD` against
the advertised OID; and the adversarial matrix covers renamed, multi-ref, detached, fork, ambiguous, and race
cases. It also endorsed the root-private pre-push adapter placement and the priority of correcting base identity
before extending receipt reuse. `REVIEW VERDICT: ENDORSE`.

### [GATE-APPROVAL] — ❌ FAIL | 2026-08-14

**Status remains:** review-ready
**Failed criteria:**

- Independent architecture validation: the latest INFRA-099 recommendation had received
  `REVIEW VERDICT: ENDORSE`, but no independent proposal-review entry containing that verdict existed in this
  spec document's Evidence Log.
  **Required action:** append a durable Evidence Log entry identifying the independent reviewer, reviewed latest
  revision, placement conclusion, and exact verdict; then re-run GATE-APPROVAL without modifying Architecture
  Review or frontmatter type/tags.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-14

**Status upgrade:** review-ready → approved
User approval: PASS — `타당한 이유와 함께 추천안을 제시하면 타당할 경우 자동으로 승인하겠습니다.`
explicitly authorizes automatically proceeding with a recommendation once it is independently found valid.
Approval scope: PASS — the latest push-bound INFRA-099 recommendation received the exact independent verdict
`REVIEW VERDICT: ENDORSE`, satisfying the user's stated condition for this spec. Post-approval stability:
PASS — no Architecture Review change or frontmatter `type`/`tags` modification occurred after the effective
conditional approval. Independent architecture validation: PASS — the durable `[PROPOSAL-REVIEW]` entry
identifies the independent reviewer and latest revision, validates push-bound identity, unique same-repository
candidate selection, existing fallback ownership, argv-safe fetch with OID race rejection, adversarial coverage,
and root-private internal-tooling placement. Implementation boundary: PASS — implementation work has not begun;
only lifecycle/specification artifacts are present.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-14

**Status upgrade:** approved → in-progress
Tasks file: PASS — `.agents/tasks/INFRA-099-pr-base-aware-pre-push-verification.md` exists and is named
exactly in the spec document's Tasks section. Task mapping: PASS — TC-01 covers push-bound identity; TC-02
covers unique same-repository discovery, precedence, argv-safe fetch, OID-race rejection, and fallback; TC-03
covers one-owner sequencing; TC-04 covers scratch Git delta isolation; TC-05 covers focused, broad, hosted,
review, gate, and archive completion. Test Plan: PASS — the Task contains a substantive Test Plan exceeding
50 characters and covering all five TC areas. Blockers: PASS — explicitly recorded as `None.` Implementation
boundary: PASS — no INFRA-099 implementation edits or commits exist before this gate; only lifecycle and
specification artifacts are present. Lifecycle note: the Task Spec pointer is synchronized during this
post-PASS transition.

### [RECOMMENDATION REOPENED] — ⚠️ REVISE | 2026-08-14

**Status reset:** in-progress → draft
Pre-implementation source inspection found that the analogous owners `pre-push-updates.mjs` and `shared.mjs`
are directly under `scripts/harness/`; no `scripts/harness/core/` family exists. No implementation had begun.
The placement statement is corrected to the existing root-private `scripts/harness/` internal-tooling family,
and recommendation, write, and approval gates must be rerun before implementation.

### [PROPOSAL-REVIEW] — ✅ ENDORSE | 2026-08-14

**Status remains:** draft
Independent reviewer `infra098_research` confirmed that the corrected placement matches the actual tree: the
resolver belongs directly under root-private `scripts/harness/` beside `pre-push-updates.mjs`, `shared.mjs`,
and `verification-receipt.mjs`. It confirmed that the earlier five safety conditions and adversarial test
matrix remain intact, the lifecycle was correctly reset before implementation, and no blocker remains.
`REVIEW VERDICT: ENDORSE`.

### [GATE-WRITE] — ✅ PASS | 2026-08-14

**Status upgrade:** draft → review-ready
Frontmatter: PASS — the corrected document has valid YAML frontmatter with `status: draft`, allowed single
type `INFRA`, and `tags: [cli, typescript]`. Problem: PASS — it records PR #1724's incorrect
`origin/develop` planning base, measured cumulative work, exact reproduction, and the wrong-ref narrowing
risk requiring push-bound identity. Prior Art Research: PASS — official Git pre-push and GitHub CLI
`gh pr list` documentation substantiate the push-update identity and unique-candidate discovery design.
Architecture Review: PASS — all checklist items are checked; four alternatives carry pros/cons; the decision
specifies push-update eligibility, precedence, cardinality, same-repository validation, argv-safe fetch,
OID-race rejection, and broad fallback. New-surface placement: PASS — `pre-push-updates.mjs` is the analogous
Git-boundary seam and `shared.mjs` owns generic fallback; both are directly under the existing root-private
`scripts/harness/` internal-tooling family, where the new resolver will be placed. Dependency direction:
PASS — the resolver reuses harness primitives, exposes no package/public SDK surface, imports no PRODUCT or
sibling application, and creates no product-to-harness dependency. Completion Criteria: PASS — five
observable criteria are uniquely prefixed TC-01 through TC-05 and cover push binding, PR/fetch trust,
one-owner sequencing, scratch integration, and final verification. Test Plan: PASS — five non-empty rows map
exactly to the five Completion Criteria; no manual row requires justification. Structure: PASS — the exact
Tasks placeholder is present, historical evidence and the explicit recommendation-reopen record are preserved,
and no body-level Status or Classification section exists. Revision handling: PASS — previous approval and
implementation-gate evidence is historical only; this entry independently validates the corrected placement
revision.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-14

**Status upgrade:** review-ready → approved
User approval: PASS — `타당한 이유와 함께 추천안을 제시하면 타당할 경우 자동으로 승인하겠습니다.`
explicitly authorizes automatically proceeding with a recommendation once it is independently found valid.
Approval scope: PASS — the corrected-placement INFRA-099 recommendation received a fresh exact
`REVIEW VERDICT: ENDORSE`, satisfying the user's stated condition for this revision. Revision isolation:
PASS — `[RECOMMENDATION REOPENED]` invalidated the earlier lifecycle, and the fresh endorsement explicitly
reviews the corrected actual-tree placement rather than relying on prior evidence. Post-approval stability:
PASS — no Architecture Review change or frontmatter `type`/`tags` modification occurred after the effective
conditional approval. Independent architecture validation: PASS — the durable fresh `[PROPOSAL-REVIEW]`
entry validates placement directly under root-private `scripts/harness/` beside `pre-push-updates.mjs`,
`shared.mjs`, and `verification-receipt.mjs`, confirms the safety conditions and adversarial matrix remain
intact, and records exact `REVIEW VERDICT: ENDORSE`. Implementation boundary: PASS — implementation work has
not begun; only lifecycle and specification artifacts are present.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-14

**Status upgrade:** approved → in-progress
Revision isolation: PASS — this gate evaluates only the corrected placement revision following
`[RECOMMENDATION REOPENED]`, fresh GATE-WRITE PASS, fresh ENDORSE, and fresh GATE-APPROVAL PASS. Tasks file:
PASS — `.agents/tasks/INFRA-099-pr-base-aware-pre-push-verification.md` exists and is named exactly in the
spec document's Tasks section. Task mapping: PASS — TC-01 covers push-bound identity; TC-02 covers unique
same-repository discovery, precedence, argv-safe fetch, OID-race rejection, and fallback; TC-03 covers
one-owner sequencing; TC-04 covers scratch Git delta isolation; TC-05 covers focused, broad, hosted, review,
lifecycle, and archive completion. Test Plan: PASS — the Task contains a substantive Test Plan exceeding 50
characters and covering all five TC areas. Blockers: PASS — explicitly recorded as `None.` Implementation
boundary: PASS — no INFRA-099 implementation edit or commit exists before this gate; only lifecycle and
specification artifacts are present. Lifecycle note: the Task Spec pointer is synchronized during this
post-PASS transition.

### [GATE-VERIFY] — ✅ PASS | 2026-08-14

**Status upgrade:** in-progress → verifying
Tasks completion: PASS — TC-01 through TC-05 are checked in
`.agents/tasks/INFRA-099-pr-base-aware-pre-push-verification.md`; no implementation item remains and
`## Blockers` records `None.` Build: PASS — `pnpm harness:verify-like-ci` passed all 12 stages in 7m04.1s,
including the root `pnpm build` stage. Tests: PASS — the exact PR-base plan had zero affected workspace
package/app scopes, so no affected package test was omitted; affected verification, the 112-file/2,289-test
repository-contract tier, and the 72-file/1,058-test hermetic tier all passed. Focused verification: PASS —
resolver, sequence, and structural suites passed 3 files / 122 tests; the embedded harness scan passed 110
scans with one intentional skip. Hosted planning evidence: PASS — the PR-aware push selected exact base
`0d98461b6a613dadb26a4410619ebc9c430ecba9`, reducing the plan from 110 to 14 files and from 11 to zero
workspace scopes while preserving the always-on contract/scans floor. Review evidence: PASS — independent
local review reported `ACTIONABLE FINDINGS: 0`; GitHub confirms PR #1725's successful fresh automated review
for exact base `0d98461b6a613dadb26a4410619ebc9c430ecba9` and head
`71c6874040bd873a731cce72a6ccfc13bdb45571`, with zero review threads and
`ACTIONABLE FINDINGS: 0`.

### [GATE-COMPLETE] — ❌ FAIL | 2026-08-14

**Status remains:** verifying
**Failed criteria:**

- Per-TC completion evidence: TC-01 through TC-05 were checked, but none had a matching
  `[GATE-COMPLETE: TC-N]` entry containing the exact verification command/action, observed result, and exit
  code where applicable.
  **Required action:** add one format-compliant completion-evidence entry for each TC.
- Test Plan evidence: TC-01 through TC-04 did not identify exact durable test file/suite/test names, and TC-05
  had neither exact test references nor an explicit hosted-only skip statement.
  **Required action:** replace generic Tool/Approach descriptions with exact file/suite/test references; for
  the non-local hosted portion of TC-05, record `Test skipped:` with the specific GitHub/Claude credential and
  event-delivery reason.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-14

**Status remains:** verifying
`pnpm exec vitest run scripts/harness/__tests__/pre-push-base-ref.test.mjs scripts/harness/__tests__/pre-push-sequence.test.mjs scripts/harness/__tests__/harness-scripts.test.mjs`
exited 0 as a 3-file / 122-test focused run. `scripts/harness/__tests__/pre-push-base-ref.test.mjs` >
`selectPushBoundBranch (INFRA-099)` > `accepts one exact current-branch push and the no-stdin manual path`
passed, and the same suite rejected other-branch, renamed-ref, multi-ref, detached, deleted, mismatched-OID,
and non-origin destination cases.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-14

**Status remains:** verifying
The same exact focused Vitest command exited 0. `scripts/harness/__tests__/pre-push-base-ref.test.mjs` >
`resolvePrePushBaseRef (INFRA-099)` passed `uses one same-repository OPEN PR and returns its immutable base OID`,
`keeps explicit HARNESS_BASE_REF authoritative without consulting GitHub`,
`delegates misses to the existing resolver, preserving GITHUB_BASE_REF`,
`fetches only the advertised full base ref via argv and accepts matching FETCH_HEAD`, and the lookup/fetch
OID-race and fetch-failure fallback tests.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-14

**Status remains:** verifying
The same exact focused Vitest command exited 0. `scripts/harness/__tests__/pre-push-base-ref.test.mjs` >
`createPrePushBasePlan (INFRA-099)` >
`projects one exact base into plan, classification, decision, and receipt consumers`;
`scripts/harness/__tests__/pre-push-sequence.test.mjs` > `runPrePushGate step order` >
`reports the resolved base exactly once on the verification/no-delta/receipt reuse paths`; and
`scripts/harness/__tests__/harness-scripts.test.mjs` > `pre-push hook` >
`threads the one resolved base plan through every pre-push consumer` all passed.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-14

**Status remains:** verifying
The same exact focused Vitest command exited 0. `scripts/harness/__tests__/pre-push-base-ref.test.mjs` >
`integration-child delta isolation (INFRA-099)` >
`excludes cumulative initiative history only when the unique PR base is trusted` observed exactly four child
documents for the trusted PR base and those four documents plus the cumulative package file for the broad
fallback.

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-08-14

**Status remains:** verifying
`pnpm harness:verify-like-ci` exited 0 with all 12 stages passing in 7m04.1s, including root build, affected
verification, repository-contract tests, hermetic tests, scans, typecheck, binary E2E, examples, and TUI E2E.
Hosted PR #1725 selected exact base `0d98461b6a613dadb26a4410619ebc9c430ecba9`, reducing the plan from 110
to 14 files and 11 to zero workspace scopes. Its exact base/head automated review ended with
`ACTIONABLE FINDINGS: 0`. Test skipped: hosted GitHub/Claude credentials and push-event delivery cannot be
reproduced locally; the successful PR #1725 run is the durable hosted evidence.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-14

**Status upgrade:** verifying → done
Completion Criteria: PASS — TC-01 through TC-05 are all checked and each has a matching
`[GATE-COMPLETE: TC-N]` entry recording the exact verification command or action, observed result, and exit
code where applicable. Test Plan: PASS — TC-01 through TC-04 identify durable test files, suites, and named
tests; TC-05 records the explicit hosted-only local-reproduction skip reason and durable PR #1725 evidence.
Focused verification: PASS —
`pnpm exec vitest run scripts/harness/__tests__/pre-push-base-ref.test.mjs scripts/harness/__tests__/pre-push-sequence.test.mjs scripts/harness/__tests__/harness-scripts.test.mjs`
exited 0 with 3 files and 122 tests passing. Full verification: PASS — `pnpm harness:verify-like-ci` exited 0
with all 12 stages passing in 7m04.1s. Hosted acceptance: PASS — PR #1725 selected exact base
`0d98461b6a613dadb26a4410619ebc9c430ecba9`, reduced the plan from 110 to 14 files and 11 to zero workspace
scopes, and received an exact base/head automated review ending `ACTIONABLE FINDINGS: 0`. Task linkage: PASS —
the checked spec pointer names `.agents/tasks/completed/INFRA-099-pr-base-aware-pre-push-verification.md`
exactly. Task readiness: PASS — all five Task Plan items are checked and `## Blockers` records `None.`
Post-PASS handoff: the Task is terminal with a completion date, Task/spec are archived, parent projections are
done, and placement/task-archival scans are the final mechanical check.
