---
status: done
type: INFRA
tags: [harness, ci]
---

# INFRA-088: Make promotion novelty scans compare against develop

## Problem

The `release-grade verification` job on develop→main promotion PR #1690 failed in
`new-rule-declares-enforcement`. The promotion head had the exact `origin/develop` tree, but the
shared base resolver selected `origin/main` from `GITHUB_BASE_REF=main`. Its three-dot diff therefore
treated the full historical develop delta as promotion-local work and reported eleven already-landed
rule sections as newly introduced.

Reproduction condition: create the sanctioned promotion merge from `origin/develop`, run
`pnpm harness:verify:release` in a pull-request environment with `GITHUB_BASE_REF=main`, and leave
`HARNESS_BASE_REF` unset. Diff-sensitive scans inspect `origin/main...HEAD`, even though the
promotion's content is already the verified develop tree. The same incorrect baseline also affects
the local release preflight in `scripts/harness/promote.mjs`; additionally,
`check-document-authority.mjs` does not currently honor the shared `HARNESS_BASE_REF` override.

## Prior Art Research

### Official behavior

GitHub exposes `github.base_ref` as the pull request's target branch, so a develop→main promotion
correctly receives `main` as its event base ([GitHub Actions contexts reference](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#github-context)).
For `pull_request`, GitHub checks out a synthetic merge result by default
([pull-request event reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)).
With `fetch-depth: 0`, all branch history—including `origin/develop`—is available
([actions/checkout documentation](https://github.com/actions/checkout#fetch-all-history-for-all-tags-and-branches)).

Git defines `git diff A...B` as the diff from `merge-base(A, B)` to `B`
([git-diff documentation](https://git-scm.com/docs/git-diff.html#_description)); the merge base is the
best common ancestor reachable through parent links
([git-merge-base documentation](https://git-scm.com/docs/git-merge-base#_description)). GitHub pull
requests likewise use three-dot comparison
([GitHub branch-comparison documentation](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-comparing-branches-in-pull-requests#three-dot-and-two-dot-git-diff-comparisons)).
Consequently, `origin/main...HEAD` on a promotion includes the accumulated develop delta since the
last main/develop merge base. That is correct for the release delta, but wrong for scans asking
whether the promotion step newly introduced a rule or document.

### Observed common behavior

PR automation normally uses the event's target branch because that answers what merging the PR
changes in the target. A promotion gate has two legitimate baselines: `main` for release contents
and `develop` for promotion-local novelty. These meanings should be explicit rather than hidden
behind a global resolver heuristic.

### Robota constraint and recommendation

Robota separately asserts that the promotion carries `main` ancestry and that its tree equals
`develop`. The release job must retain `GITHUB_BASE_REF=main` so promotion-only gates continue to
recognize main-promotion context. Set `HARNESS_BASE_REF: origin/develop` only on the release-grade
verification step and on the local promotion preflight process. Bring the independent
`check-document-authority.mjs` resolver under the same explicit-override precedence. Do not globally
reinterpret main-targeted PRs and do not retrofit historic develop documents to compensate for a
baseline defect.

## Architecture Review

### Affected Scope

- `.github/workflows/ci.yml` — release-grade verification environment.
- `scripts/harness/promote.mjs` — local release preflight environment.
- `scripts/harness/check-document-authority.mjs` — independent diff-base resolver.
- `scripts/harness/__tests__/promotion-preflight-parity.test.mjs` — workflow/preflight parity.
- `scripts/harness/__tests__/check-document-authority.test.mjs` — resolver precedence.
- Sibling scan: all direct `GITHUB_BASE_REF` and `HARNESS_BASE_REF` readers under
  `scripts/harness/` were inspected. `scan-promotion-ancestry` and `scan-action-references` use
  `GITHUB_BASE_REF` for promotion context rather than novelty diffs and must remain unchanged.

### Alternatives Considered

1. **Step-scoped develop novelty baseline (recommended).** Set `HARNESS_BASE_REF=origin/develop` only
   for local and CI release verification, and make the one independent diff resolver honor it.
   Pro: uses the existing explicit override seam, preserves main-promotion context, and matches the
   tree-equality promotion invariant. Con: the release gate intentionally uses a different novelty
   baseline from the PR target and therefore needs parity tests and an explanatory comment.
2. **Change the shared resolver globally for main PRs.** Infer `origin/develop` whenever
   `GITHUB_BASE_REF=main`. Pro: one centralized code change. Con: silently undercounts legitimate
   main-targeted diffs outside the sanctioned promotion workflow and conflates event context with
   analysis intent.
3. **Add enforcement declarations to the eleven historical rule sections.** Pro: makes the observed
   scan green without resolver changes. Con: edits domain documents that were not introduced by the
   promotion, leaves every other diff-sensitive scan on the wrong time horizon, and creates content
   solely to satisfy a false finding.

### Decision

Choose alternative 1. Promotion ancestry and tree equality remain checked against `main` and
`develop` by their owning gate, while diff-sensitive novelty scans explicitly compare the release
candidate to the already-verified develop tree. This is the narrowest change that preserves both
meanings and keeps ordinary PR base resolution unchanged. The affected consumers were inspected:
shared resolver users already prioritize `HARNESS_BASE_REF`; the only independent diff resolver in
the release sweep will be aligned; promotion-context readers remain on `GITHUB_BASE_REF=main`.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `GITHUB_BASE_REF`/`HARNESS_BASE_REF` 직접 사용처를 전수 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

Add a red regression assertion that the main-only release job declares
`HARNESS_BASE_REF: origin/develop` while retaining `PR_HEAD_SHA`, and that `promote.mjs` passes the
same override to its local `pnpm harness:verify:release` child. Add a resolver test proving
`check-document-authority.mjs` prefers `HARNESS_BASE_REF` over `GITHUB_BASE_REF`, then implement that
precedence. Explicitly add declared package-manager homes (`PNPM_HOME` and `VOLTA_HOME/bin`) to the
local release child's `PATH` so both the first pnpm process and nested pnpm scripts resolve without
depending on interactive-shell mutation. Preserve the global shared resolver and every
promotion-context reader unchanged.

## Affected Files

- `.github/workflows/ci.yml`
- `scripts/harness/promote.mjs`
- `scripts/harness/check-document-authority.mjs`
- `scripts/harness/__tests__/promotion-preflight-parity.test.mjs`
- `scripts/harness/__tests__/check-document-authority.test.mjs`
- `.agents/tasks/INFRA-088-promotion-scan-baseline.md`

## Completion Criteria

- [x] TC-01: The `release-grade verification` workflow step runs with
      `HARNESS_BASE_REF=origin/develop` while `GITHUB_BASE_REF` remains the GitHub-provided `main`, and a
      focused workflow test verifies the declaration.
- [x] TC-02: `scripts/harness/promote.mjs` runs its local `pnpm harness:verify:release` child with
      `HARNESS_BASE_REF` equal to its configured develop ref, and the preflight parity test verifies it.
- [x] TC-03: `check-document-authority.mjs` resolves an existing `HARNESS_BASE_REF` before
      `GITHUB_BASE_REF`, while ordinary PR resolution remains covered and unchanged.
- [x] TC-04: A fresh sanctioned promotion runs the full release gate without reporting historical
      develop rules as promotion-local additions.

## Test Plan

| TC-ID | Test Type                   | Tool / Approach                                                                                                                                                                                                  | Notes                                                                                     |
| ----- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| TC-01 | CI configuration regression | `scripts/harness/__tests__/promotion-preflight-parity.test.mjs` > `promotion preflight mirrors protect-main` > `compares promotion-local novelty against develop in the main-only release job`                   | Assert step scope and preserve promotion context.                                         |
| TC-02 | Unit/integration            | `scripts/harness/__tests__/promote.test.mjs` > `promote.mjs (INFRA-051)` > `runs the release gate against the configured develop novelty baseline`                                                               | Assert child process environment matches configured develop ref.                          |
| TC-03 | Unit                        | `scripts/harness/__tests__/check-document-authority.test.mjs` > `base-ref resolution` > `prefers HARNESS_BASE_REF over the GitHub PR target`                                                                     | Assert resolver precedence and ordinary PR behavior.                                      |
| TC-04 | Release smoke               | Automated test skipped: the release gate is exercised by the sanctioned real-repository `node scripts/harness/promote.mjs` smoke action because a fixture cannot reproduce the complete workspace release chain. | Require a green, non-skipped local promotion preflight before opening the replacement PR. |

## Tasks

- [x] `.agents/tasks/completed/INFRA-088-promotion-scan-baseline.md` — TC-01 through TC-04 implementation and verification plan

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-12

**Status upgrade:** draft → review-ready
Frontmatter: YAML block is present first; `status: draft`, valid `type: INFRA`, and `tags: [harness, ci]` are present.
Problem: identifies the concrete `release-grade verification` / `new-rule-declares-enforcement` failure and reproduces it under a develop→main PR with `GITHUB_BASE_REF=main` and no `HARNESS_BASE_REF`; no TBD, TODO, or vague one-line description is present.
Prior Art Research: cites official GitHub Actions, actions/checkout, Git diff/merge-base, and GitHub comparison documentation; the findings directly support the explicit-baseline alternatives and Decision.
Architecture Review: all four checklist items are checked; the sibling scan names the inspected baseline readers and explains why promotion-context readers remain unchanged.
Alternatives and Decision: three alternatives each state a pro and con; the Decision selects the step-scoped baseline because it preserves promotion context while narrowing novelty scans to the verified develop tree.
New-surface placement: N/A — the spec changes CI/harness baseline resolution and introduces no package, app, presentation/interface surface, or layer/product-family boundary.
Completion Criteria: TC-01 through TC-04 cover workflow configuration, local promotion parity, resolver precedence, and release smoke behavior; all are command or observable-behavior criteria and contain none of the prohibited vague phrases.
Test Plan: 4 Completion Criteria and 4 matching non-empty Test Plan rows (4/4 = 100%); every row names a test type and tool/approach, and none uses a manual tool requiring a waiver note.
Structure: Tasks contains the required post-approval placeholder; Evidence Log was empty before this first gate run; no body `## Status` or `## Classification` section exists.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-12

**Status upgrade:** review-ready → approved
Ordering: GATE-WRITE has a specific recorded PASS and the document is `status: review-ready` in `.agents/spec-docs/backlog/`, matching the required input state.
Explicit approval: the user stated verbatim, “그런거 나에게 뭍너보지 말고 타당한 이유와 함께 추천안을 제시하면 타당할 경우 내가 사전 승인합키다” (2026-08-12), then separately directed completion of the branch integration into `main`; this is an explicit pre-authorization for a reasoned recommendation necessary to that integration, not silence or inferred assent.
Directness and scope: the presented recommendation was specifically to set the promotion novelty baseline to `origin/develop` because the promotion tree equals develop while ancestry remains independently checked, rather than editing historical rules; this document records that same recommendation and trade-off without expanding its scope, so the user's stated pre-approval applies directly to this design.
Post-approval integrity: the Architecture Review, `type: INFRA`, and `tags: [harness, ci]` encode the recommendation as presented; no implementation edit or later design/type/tag change is present after the pre-approved recommendation was recorded.
Independent architecture validation: N/A — the design changes CI/harness baseline selection and introduces no package, app, interface/presentation surface, or layer/product-family reclassification.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-12

**Status upgrade:** approved → in-progress
Ordering: GATE-APPROVAL has a specific recorded PASS, and the document is `status: approved` in `.agents/spec-docs/todo/`, matching the required input state and folder.
Tasks file: `.agents/tasks/INFRA-088-promotion-scan-baseline.md` exists and is recorded in this document's `## Tasks` section.
TC-01 task: red-prove and add the release-grade workflow's step-scoped `HARNESS_BASE_REF=origin/develop` declaration; this maps directly to Completion Criterion TC-01.
TC-02 task: red-prove and pass the configured develop ref as `HARNESS_BASE_REF` to the local promotion preflight child; this maps directly to Completion Criterion TC-02.
TC-03 task: red-prove and align `check-document-authority.mjs` explicit-override precedence while preserving ordinary PR resolution; this maps directly to Completion Criterion TC-03.
TC-04 task: run the focused suites and full release verification, then create a fresh sanctioned promotion without skipping the release gate; this maps directly to Completion Criterion TC-04.
Task test plan: the tasks file contains a substantive `## Test Plan` section covering the two focused Vitest suites, `pnpm harness:test`, `pnpm harness:scan`, the release gate, and the sanctioned promotion command; its content exceeds the required 50 characters.
Process integrity: no implementation commit for the INFRA-088 affected files exists on the current branch; the spec and tasks files are untracked and implementation has not begun, so the missing-task NON-COMPLIANCE trigger does not apply.

### Implementation Evidence | 2026-08-12

- TC-01: `promotion-preflight-parity.test.mjs` verifies the main-only release step declares
  `HARNESS_BASE_REF: origin/develop` while retaining `PR_HEAD_SHA`; PR #1691 CI passed.
- TC-02: `promote.test.mjs` verifies the configured develop ref is passed as `HARNESS_BASE_REF` and
  package-manager homes are propagated to the child process tree; focused suite passed 9/9.
- TC-03: `check-document-authority.test.mjs` verifies `HARNESS_BASE_REF` precedence over
  `GITHUB_BASE_REF`; the focused baseline suite passed and PR #1691 CI passed all required checks.
- TC-04: `node scripts/harness/promote.mjs` created promotion head `caced9feba4ed467ac6f1f61add561abf712926f`
  from `origin/develop` `d1a9a98621b9a0c179d709273267e7afbc152d52`, reported
  `release gate PASSED locally`, and exited 0. The head and develop tree hashes were both
  `dbff4d8ffdc5754574f514d9aa5bb9e18083268c`; no historical-rule novelty finding occurred.
- Full release evidence: build, 107 harness scans, 173 harness files / 3,182 tests, workspace tests,
  release suites, typecheck, and lint all completed with exit 0. Lint reported 1,969 warnings and
  zero errors.

### [GATE-VERIFY] — ✅ PASS | 2026-08-12

**Status upgrade:** in-progress → verifying
Ordering: GATE-IMPLEMENT has a criterion-specific recorded PASS, and the document is `status: in-progress` in `.agents/spec-docs/active/`, matching the required input state and folder.
Task completion: `.agents/tasks/INFRA-088-promotion-scan-baseline.md` has TC-01 through TC-04 checked (4/4 = 100%); `## Blockers` says `None`, and no unchecked task or pending/blocked work remains.
Build: the independent gate guard ran `pnpm build` at develop commit `d1a9a98621b9a0c179d709273267e7afbc152d52`; all workspace JavaScript and ordered type builds completed with exit code 0.
Tests: the independent gate guard ran `pnpm test` at the same commit; all workspace project test commands completed with exit code 0. It also ran the three affected harness files with `pnpm exec vitest run scripts/harness/__tests__/promotion-preflight-parity.test.mjs scripts/harness/__tests__/promote.test.mjs scripts/harness/__tests__/check-document-authority.test.mjs --pool=threads --maxWorkers=2 --testTimeout=30000 --reporter=dot`; 3/3 files and 31/31 tests passed with exit code 0.
Implementation traceability: PRs #1691, #1692, and #1693 are merged into `develop` with successful build/scans/quality/review checks; promotion head `caced9feba4ed467ac6f1f61add561abf712926f` contains develop `d1a9a98621b9a0c179d709273267e7afbc152d52` as an ancestor, and both resolve to tree `dbff4d8ffdc5754574f514d9aa5bb9e18083268c`, corroborating TC-04's recorded full-gate run.

### [GATE-COMPLETE: TC-01] | 2026-08-12

- Command: `pnpm exec vitest run scripts/harness/__tests__/promotion-preflight-parity.test.mjs scripts/harness/__tests__/promote.test.mjs scripts/harness/__tests__/check-document-authority.test.mjs --pool=threads --maxWorkers=2 --testTimeout=30000 --reporter=dot`
- Result: 3 test files and 31 tests passed, including `promotion preflight mirrors protect-main > compares promotion-local novelty against develop in the main-only release job`.
- Exit code: 0.

### [GATE-COMPLETE: TC-02] | 2026-08-12

- Command: `pnpm exec vitest run scripts/harness/__tests__/promotion-preflight-parity.test.mjs scripts/harness/__tests__/promote.test.mjs scripts/harness/__tests__/check-document-authority.test.mjs --pool=threads --maxWorkers=2 --testTimeout=30000 --reporter=dot`
- Result: 3 test files and 31 tests passed, including `promote.mjs (INFRA-051) > runs the release gate against the configured develop novelty baseline`.
- Exit code: 0.

### [GATE-COMPLETE: TC-03] | 2026-08-12

- Command: `pnpm exec vitest run scripts/harness/__tests__/promotion-preflight-parity.test.mjs scripts/harness/__tests__/promote.test.mjs scripts/harness/__tests__/check-document-authority.test.mjs --pool=threads --maxWorkers=2 --testTimeout=30000 --reporter=dot`
- Result: 3 test files and 31 tests passed, including `base-ref resolution > prefers HARNESS_BASE_REF over the GitHub PR target` while the neighboring explicit and unresolved-base cases also passed.
- Exit code: 0.

### [GATE-COMPLETE: TC-04] | 2026-08-12

- Action: ran `node scripts/harness/promote.mjs` on `origin/develop` `d1a9a98621b9a0c179d709273267e7afbc152d52` without `--skip-release-gate`.
- Result: the command reported `release gate PASSED locally`; build, 107 scans, 173 harness files / 3,182 tests, workspace tests, release suites, typecheck, and lint completed. Promotion head `caced9feba4ed467ac6f1f61add561abf712926f` and develop both had tree `dbff4d8ffdc5754574f514d9aa5bb9e18083268c`, with no historical-rule novelty finding.
- Exit code: 0.

### [GATE-COMPLETE] — ❌ FAIL | 2026-08-12

**Status remains:** verifying
**Failed criteria:**

- TC-specific completion evidence: TC-01 through TC-04 are checked, but no `[GATE-COMPLETE: TC-01]` through `[GATE-COMPLETE: TC-04]` Evidence Log entries exist with each criterion's exact verification command/action, observed result, and applicable exit code.
  **Required action:** Add one `[GATE-COMPLETE: TC-N]` entry per criterion containing the exact command or action, actual output/result, exit code where applicable, and its test reference or explicit skip reason.
- Test Plan traceability: all four Test Plan rows describe tools or approaches, but none records the required exact test file path plus test/describe name; TC-04 also has neither an automated-test reference nor an explicit automated-test skip reason.
  **Required action:** Update every Test Plan row with an exact test file path and test/describe name, or record a specific reason automated coverage was skipped.
- Task archival: `.agents/tasks/INFRA-088-promotion-scan-baseline.md` remains in the active tasks directory, and the spec's `## Tasks` section still points there.
  **Required action:** Archive the task as `.agents/tasks/completed/INFRA-088-promotion-scan-baseline.md` and update the spec's `## Tasks` path before re-running GATE-COMPLETE.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-12

**Status upgrade:** verifying → done
Ordering: GATE-VERIFY has a criterion-specific recorded PASS, and the document is `status: verifying` in `.agents/spec-docs/active/`, matching the required input state and folder.
Completion Criteria: TC-01 through TC-04 are checked (4/4 = 100%).
TC evidence: four `[GATE-COMPLETE: TC-N]` entries exist (4/4 = 100%); each records the exact command or action, observed result, and exit code 0. The three cited test names resolve in their stated files, and TC-04's develop/promotion SHAs resolve to the same tree with develop ancestry preserved.
Test Plan: TC-01 through TC-03 record exact test file paths plus test names; TC-04 records a specific automated-test skip reason and the sanctioned real-repository smoke action (4/4 = 100%). No TC is silently unaddressed.
Task archival: `.agents/tasks/completed/INFRA-088-promotion-scan-baseline.md` exists, the former active task path no longer exists, and this document's `## Tasks` section points to the archived path.
