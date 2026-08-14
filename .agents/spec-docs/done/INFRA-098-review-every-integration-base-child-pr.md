---
status: done
type: INFRA
tags: [typescript, async]
---

# INFRA-098: review every integration-base child PR against its exact diff

## Problem

The multi-backlog initiative workflow requires each child PR to target an initiative integration
base, while the pre-merge rule requires every code PR to carry a current automated review verdict.
The only verdict producer, `.github/workflows/claude-code-review.yml`, filters `pull_request` events
to base branches `[main, develop]`. PR #1724 targets `feat/arch-dag-runtime-completion`, so opening,
pushing, and commenting `/code-review` produce no workflow run, no `github-actions` verdict, and no
merge-gate-satisfying `ACTIONABLE FINDINGS` result.

The current merge gate also treats a verdict timestamp newer than the head commit as freshness. An
integration base can advance or be retargeted without changing the child head, so a newer timestamp
does not prove that the reviewer saw the current base/head comparison.

## Prior Art Research

GitHub documents that `pull_request.branches` filters the PR's **target/base branch**. Omitting that
filter is the default all-branch behavior; the `**` glob is its explicit equivalent. This explains
why a child PR targeting a feature integration base has no run even though its head branch is valid.
See [Workflow syntax: pull request branch filters](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpull_requestpull_request_targetbranchesbranches-ignore).

For an open mergeable PR, GitHub sets `GITHUB_REF` to `refs/pull/<number>/merge` and `GITHUB_SHA` to
the synthetic merge commit, so an ordinary `pull_request` run observes the proposed head combined
with its current base. See [How the merge branch affects your workflow](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#how-the-merge-branch-affects-your-workflow).
The event payload separately exposes immutable `pull_request.base.sha` and `pull_request.head.sha`;
those two values, not wall-clock recency, are the durable review identity.

GitHub recommends `pull_request_target` when privileged automation must use a trusted default-branch
workflow, while warning not to execute untrusted PR content in that context. That is the correct
repository-wide provenance end state, already filed as INFRA-097 / issue #1719. See
[Secure use of pull_request_target](https://docs.github.com/en/actions/reference/security/secure-use#preventing-pwn-requests).
INFRA-098 restores complete initiative-child coverage and exact comparison identity within the
current `pull_request` architecture; the pre-existing workflow-provenance finding remains explicitly
contained under INFRA-097 rather than being misrepresented as solved here.

## Architecture Review

### Affected Scope

- `.github/workflows/claude-code-review.yml` — all-base lifecycle trigger and exact SHA verdict
- `.claude/hooks/merge-gate.sh` — current base/head verdict binding
- `.agents/rules/git-branch.md` — exact comparison identity replaces timestamp-only freshness
- `.agents/skills/pr-finding-resolution-loop/SKILL.md` — review verdict contract
- `scripts/harness/**` — workflow and merge-gate regression coverage
- `.agents/tasks/AGREEMENT-001-complete-arch-dag-runtime-backlog.md` and paired spec — discovered
  initiative prerequisite projection

### Alternatives Considered

1. Add `feat/**` to the existing branch filter.
   - Pro: one-line change.
   - Con: branch naming becomes policy, other valid integration-base prefixes remain unreviewed,
     and the repository's “every code PR” contract is still only partially implemented.
2. Remove base-branch filtering and bind the verdict to exact event base/head SHAs.
   - Pro: covers every initiative child without naming conventions and makes stale-base/head reviews
     mechanically unusable.
   - Con: retains the already-filed PR-controlled workflow provenance until INFRA-097 lands.
3. Convert immediately to a hardened `pull_request_target` reviewer.
   - Pro: trusted default-branch control plane and all-base coverage.
   - Con: the new workflow definition is not active until it reaches `main`; using it as the only
     repair leaves the current initiative circularly unable to merge its child PRs. It also belongs
     to INFRA-097's repository-wide provenance and rollout boundary.
4. Use a manual merge override for integration-base PRs.
   - Pro: no repository change.
   - Con: directly violates the zero-exception pre-merge review rule and repeats the ARCH-019
     incident instead of fixing the failed owner.

### Decision

Choose alternative 2 as the bounded prerequisite, with the workflow site labelled
`Contained — INFRA-097.`. Remove `branches`/`branches-ignore` and path filters from the Claude review
trigger; handle `opened`, `synchronize`, `reopened`, and `edited`; retain the same-repository guard,
least privileges, explicit `github_token`, and existing concurrency cancellation. The reviewer must
end its verdict with `REVIEWED BASE: <40-hex event base SHA>`, `REVIEWED HEAD: <40-hex event head SHA>`,
and `ACTIONABLE FINDINGS: <n>`.

The merge gate must read current `baseRefOid` and `headRefOid` and accept only one unambiguous newest
reviewer verdict whose two markers match those current OIDs. Missing, malformed, duplicate, stale-base,
stale-head, or nonzero verdicts fail closed. Timestamp remains diagnostic only. This closes the
initiative-child coverage and stale-comparison defects without claiming to close INFRA-097's trusted
workflow provenance. Once INFRA-097 reaches `main`, it may change the event/control plane while
preserving this exact SHA-pair verdict contract.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — Claude review, CodeQL/review-gate, merge-gate, initiative child PR flow examined
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

Add a mechanically tested all-base review trigger and exact comparison identity. Extend the existing
merge-gate fixtures so every accepted verdict carries one base marker, one head marker, and a zero
finding count. Add a workflow structural regression that rejects any base/path filter, missing
lifecycle event, weakened permission/token guard, or missing SHA markers. Keep protected-branch CI
and required-status configuration unchanged.

After the implementation commit is pushed to #1724, its `synchronize` event must start the Claude
review workflow from the PR merge revision. Resolve any findings and rerun until the newest verdict
matches #1724's current base/head OIDs with `ACTIONABLE FINDINGS: 0`; only then may the ordinary merge
path run.

## Affected Files

- `.github/workflows/claude-code-review.yml`
- `.claude/hooks/merge-gate.sh`
- `.agents/rules/git-branch.md`
- `.agents/skills/pr-finding-resolution-loop/SKILL.md`
- `scripts/harness/__tests__/merge-gate-decision.test.mjs`
- `scripts/harness/__tests__/merge-gate-disposition.test.mjs`
- new workflow coverage scan/test under `scripts/harness/`
- scan registration and fail-closed ownership files required by the harness
- AGREEMENT-001 task/spec child projection

## Completion Criteria

- [x] TC-01: parsed workflow tests prove Claude review handles all PR base branches with
      `opened`, `synchronize`, `reopened`, and `edited`, while no branch/path filter can silently
      exclude an integration-base child PR.
- [x] TC-02: workflow structure tests prove the same-repository condition, `contents: read` plus
      `pull-requests: write` permission boundary, explicit `github_token`, concurrency cancellation,
      and `REVIEWED BASE` / `REVIEWED HEAD` / `ACTIONABLE FINDINGS` output contract remain present.
- [x] TC-03: merge-gate fixtures pass only a unique exact current base/head verdict with zero findings
      and reject stale base, stale head, malformed/missing/duplicate markers, unreadable OIDs, and
      nonzero findings.
- [x] TC-04: `pnpm harness:scan` and the focused workflow/merge-gate suites exit 0, and the new
      workflow safety owner is registered fail-closed.
- [x] TC-05: PR #1724 receives a `github-actions` review on its current base/head pair after the
      implementation push and reaches `ACTIONABLE FINDINGS: 0` without an override.

## Test Plan

| TC-ID | Test Type           | Tool / Approach                                                                                                                                                                                                                                                                                                 | Notes                                                                                           |
| ----- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| TC-01 | CI structure        | `scripts/harness/__tests__/scan-claude-review-coverage.test.mjs` > `scan-claude-review-coverage (INFRA-098)` > `rejects target-base filters and missing lifecycle events`                                                                                                                                       | Include arbitrary slash-containing base names and filter mutations.                             |
| TC-02 | Security contract   | same file/suite > `composes the existing token and permission owners without copying their parsers`; `rejects review conditions moved from the job if field into a comment`; `rejects a job condition neutralized by an always-true disjunction`                                                                | Bidirectional permission/token/event/marker assertions.                                         |
| TC-03 | Hook integration    | `scripts/harness/__tests__/merge-gate-decision.test.mjs` > `the merge gate decides on CI and on a current review` > `allows a merge when CI is clean and the review names the exact current pair`; `refuses a zero-finding verdict for a stale base SHA`; `refuses a zero-finding verdict for a stale head SHA` | Exact SHA-pair matrix; timestamp-only verdicts fail.                                            |
| TC-04 | Harness integration | `scripts/harness/__tests__/scan-claude-review-coverage.test.mjs` > `scan-claude-review-coverage (INFRA-098)` > `is registered and passes on the live repository`                                                                                                                                                | Zero examined tests/scans must fail closed.                                                     |
| TC-05 | Hosted CI smoke     | live PR #1724 review comment and merge-gate dry decision                                                                                                                                                                                                                                                        | Test skipped: hosted GitHub/Claude credentials and event delivery cannot be reproduced locally. |

## Tasks

- [x] `.agents/tasks/completed/INFRA-098-review-every-integration-base-child-pr.md`

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-14

**Status upgrade:** draft → review-ready
Frontmatter: PASS — valid YAML frontmatter contains `status: draft`, allowed single type `INFRA`, and `tags: [typescript, async]`.
Problem: PASS — records the concrete PR #1724 integration-base trigger failure, its reproduction conditions, missing verdict behavior, and timestamp-only freshness defect with no placeholders.
Prior Art Research: PASS — cites GitHub workflow-filter, merge-branch, and secure-trigger documentation; findings directly support the alternatives and bounded all-base/exact-SHA decision.
Architecture Review: PASS — all four checklist items are checked, sibling surfaces are named, four alternatives have explicit pros/cons, and the decision states the coverage, freshness, rollout, and provenance trade-offs.
New-surface placement: N/A — the change strengthens existing workflow, hook, rule, skill, and harness contracts without introducing or reclassifying a package, app, presentation layer, or product-family boundary.
Completion Criteria: PASS — five observable criteria are uniquely prefixed `TC-01` through `TC-05` and cover every stated sub-item without prohibited vague language.
Test Plan: PASS — five non-empty rows match the five Completion Criteria exactly; TC-05 explicitly explains the hosted GitHub/Claude automation limitation.
Structure: PASS — Tasks placeholder and an initially empty Evidence Log are present, with no body-level Status or Classification section.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-14

**Status upgrade:** review-ready → approved
User approval: PASS — `타당한 이유와 함께 추천안을 제시하면 타당할 경우 자동으로 승인하겠습니다.` together with `추천 우선순위 대로 전부 진행해서 완료해줘.` explicitly authorizes this independently endorsed recommended prerequisite.
Approval scope: PASS — the exact INFRA-098 recommendation received `REVIEW VERDICT: ENDORSE`, satisfying the user's stated automatic-approval condition; this is not silence, a bare acknowledgement, or approval of another item.
Post-approval stability: PASS — effective approval followed the completed independent endorsement, with no subsequent Architecture Review or frontmatter `type`/`tags` modification and no implementation-file edit present.
Independent architecture validation: N/A — the spec strengthens existing automation surfaces and does not introduce or reclassify a package, app, presentation/interface surface, layer, or product-family boundary; the exact proposal nevertheless received an independent ENDORSE verdict.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-14

**Status upgrade:** approved → in-progress
Tasks file: PASS — `.agents/tasks/INFRA-098-review-every-integration-base-child-pr.md` exists and is named exactly in the spec document's `## Tasks` section.
Task mapping: PASS — TC-01 covers all-base lifecycle workflow tests; TC-02 covers security and verdict-marker contracts; TC-03 covers exact SHA-pair merge-gate fixtures; TC-04 covers fail-closed scan registration and focused/full harness verification; TC-05 covers hosted PR #1724 review convergence.
Test Plan: PASS — the task carries a substantive `## Test Plan` exceeding 50 characters and covering every TC.
Blockers: PASS — explicitly recorded as `None.`
Implementation boundary: PASS — no INFRA-098 implementation edits or commits exist before this gate; only the spec, task, and parent initiative projections are present.

### [GATE-VERIFY] — ❌ FAIL | 2026-08-14

**Status remains:** in-progress
The first verification audit found no recorded current `pnpm build` or root `pnpm test` result. Focused suites, harness scans, local review, and hosted review were green, but those did not replace the catalogue's explicit build/test evidence requirement. Required action was to record the already-executed exact build and run a fresh root test before retrying.

### [GATE-VERIFY] — ✅ PASS | 2026-08-14

**Status upgrade:** in-progress → verifying
Tasks completion: PASS — TC-01 through TC-05 are checked in `.agents/tasks/INFRA-098-review-every-integration-base-child-pr.md`; no pending task remains and `## Blockers` records `None.`
Build: PASS — the exact pre-push `pnpm build` completed all package JavaScript and ordered declaration builds with exit 0.
Tests: PASS — a fresh explicit `pnpm test` ran every workspace test script and exited 0.
Supplementary verification: PASS — focused workflow/merge suites passed 116/116, broader hook selection passed 199/199, and `pnpm harness:scan` passed 110 scans with one intentional skip.
Review evidence: PASS — independent local review reported `ACTIONABLE FINDINGS: 0`; hosted run `31755020176` succeeded on exact base `95f74bfa029ec00cab191351b436be1d19ca6fc1` and head `1562fda76c5b1227f6c8e390dff785969fd8d938` with zero actionable findings.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-14

**Status remains:** verifying
`pnpm exec vitest run scripts/harness/__tests__/scan-claude-review-coverage.test.mjs` exited 0 with 15/15 tests. The exact `scan-claude-review-coverage (INFRA-098) > rejects target-base filters and missing lifecycle events` regression rejects target/path filters and missing `opened`, `synchronize`, `reopened`, or `edited`, while the live all-base workflow passes.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-14

**Status remains:** verifying
The same exact focused command exited 0. Its named security-contract tests proved token/permission composition, action-local prompt ownership, actual job-level `if:` ownership, exact same-repository plus edited-base-retarget semantics, `|| true` rejection, and concurrency retention; decoy comments and unrelated strings do not satisfy the owner.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-14

**Status remains:** verifying
`pnpm exec vitest run scripts/harness/__tests__/merge-gate-decision.test.mjs scripts/harness/__tests__/merge-gate-disposition.test.mjs` exited 0 with 55/55 tests. The exact named current-pair acceptance and stale-base/stale-head rejection tests passed alongside malformed, missing, duplicate, unreadable, nonzero, thread, and labelled-containment cases.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-14

**Status remains:** verifying
`pnpm exec vitest run scripts/harness/__tests__/scan-claude-review-coverage.test.mjs scripts/harness/__tests__/merge-gate-decision.test.mjs scripts/harness/__tests__/merge-gate-disposition.test.mjs scripts/harness/__tests__/scan-review-token-supply.test.mjs scripts/harness/__tests__/scan-workflow-permissions.test.mjs` exited 0 with 116/116 tests. `pnpm harness:scan` exited 0 with 110 scans passed and one intentional skip. The exact `is registered and passes on the live repository` test proves registration and the zero-owner fixture fails closed.

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-08-14

**Status remains:** verifying
Hosted GitHub run `31755020176` completed successfully in 2m44s on PR #1724. The posted verdict exactly matched base `95f74bfa029ec00cab191351b436be1d19ca6fc1` and head `1562fda76c5b1227f6c8e390dff785969fd8d938` and ended `ACTIONABLE FINDINGS: 0`; no override was used. Test skipped: hosted GitHub/Claude credentials and event delivery cannot be reproduced locally.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-14

**Status upgrade:** verifying → done
Completion Criteria: PASS — TC-01 through TC-05 are all checked and each has a matching `[GATE-COMPLETE: TC-N]` entry recording the exact verification action, observed result, and exit code where applicable.
Test Plan: PASS — TC-01 through TC-04 name exact durable test files, suites, and tests; TC-05 records the explicit hosted-automation skip reason and the successful hosted PR #1724 smoke evidence.
Task linkage: PASS — the checked spec pointer names `.agents/tasks/completed/INFRA-098-review-every-integration-base-child-pr.md` exactly after the atomic archive handoff.
Task readiness: PASS — all five Task Plan items are checked and `## Blockers` records `None.`
Hosted acceptance: PASS — run `31755020176` reviewed exact base `95f74bfa029ec00cab191351b436be1d19ca6fc1` and head `1562fda76c5b1227f6c8e390dff785969fd8d938`, ending with `ACTIONABLE FINDINGS: 0` without an override.
Post-PASS handoff: PASS — the Task is terminal with a completion date and archived path, this spec is terminal under `done/`, and the parent initiative projection records the same completed state.
