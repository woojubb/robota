---
status: in-progress
type: INFRA
tags: [async]
---

# INFRA-096: Order review gate after CodeQL without recovery reruns

## Problem

Every code PR currently starts `.github/workflows/review-gate.yml` and `.github/workflows/codeql.yml`
in parallel. Review Gate reads code-scanning once, normally before CodeQL finishes, posts a routine
`verdict-unavailable` BLOCKED comment, fails, and disarms auto-merge. CodeQL later uses an
`actions: write` recovery job to rerun the failed gate. PR #1718 reproduced the full sequence on
2026-08-14: review-gate failed in 10 seconds, CodeQL completed in 2m44s, recovery reran the gate,
and the second attempt passed. The PR accumulated a false BLOCKED comment, a supersession comment,
and an unnecessary failed attempt even though no finding existed.

The recovery also cannot safely re-arm auto-merge, so the transient ordering failure leaves a human
workflow side effect after it has been superseded. This is orchestration work caused solely by the
two workflows lacking an explicit dependency edge.

## Prior Art Research

[GitHub Actions workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
defines `jobs.<job_id>.needs` as the dependency that waits for prerequisite jobs to complete. It also
states that a dependent job is skipped after prerequisite failure unless its `if` expression overrides
the implicit success condition. GitHub's
[expression documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions)
recommends `!cancelled()` rather than unconditional `always()` for jobs that perform critical work, so
workflow cancellation does not start new work while prerequisite failure still reaches a fail-closed gate.

The official CodeQL action declares that analysis uploads results to code scanning, and its
[`upload-sarif` action contract](https://github.com/github/codeql-action/blob/main/upload-sarif/action.yml)
sets `wait-for-processing` to `true` by default. Therefore a same-workflow review job that needs a
successful CodeQL analyze job can read processed results without a first-fail/recovery protocol.

The repository already supplies the decision core in `scripts/harness/check-review-gate.mjs`; the
workflow should retain that owner and change only orchestration. Label changes are a distinct case:
they must re-evaluate the acknowledge/withdrawal decision without rerunning CodeQL or cancelling an
in-flight merge analysis. A separate concurrency lane and current-merge analysis identity preserve
that behavior.

## Architecture Review

### Affected Scope

- `.github/workflows/review-gate.yml` — PR classify/analyze/gate/disarm DAG.
- `.github/workflows/codeql.yml` — push-only CodeQL; remove PR recovery/write permission.
- `scripts/harness/classify-changed-paths.mjs` and its tests — make the classifier, not workflow path filters, the docs-only SSOT.
- `scripts/harness/check-review-gate.mjs` — update stale ownership comments without changing decisions.
- `scripts/harness/scan-workflow-permissions.mjs` — remove the retired recovery permission exception.
- `scripts/harness/__tests__/` — workflow structure, permission, disarm, classifier, and gate regressions.
- Current harness/verification documentation that describes the recovery path.

### Alternatives Considered

1. Keep the current first-fail plus recovery rerun.
   - Pro: no workflow restructuring.
   - Con: every code PR pays a false failure, comment noise, auto-merge disarm, and `actions: write` scope.
2. Poll CodeQL from Review Gate until results appear.
   - Pro: one workflow attempt eventually passes.
   - Con: holds and bills a runner while idle and recreates the previously removed 15-minute wait.
3. Use a `workflow_run` listener after CodeQL.
   - Pro: preserves separate workflows.
   - Con: runs from default-branch workflow context and does not provide a proven exact PR-SHA required-context identity.
4. Put PR CodeQL and Review Gate in one explicit job DAG, retaining push CodeQL separately.
   - Pro: `needs` makes ordering deterministic, CodeQL failure reaches a required fail-closed gate, and recovery/write scope disappears.
   - Con: label-only events need an explicit no-analysis lane and current-merge result reuse.

### Decision

Choose alternative 4. `review-gate.yml` will own PR classification, CodeQL analysis, review decision,
and disarm sequencing. Its `review-gate` job depends on both classifier and analyzer and runs under a
cancellation-excluding condition, so analyzer failure/skips are judged rather than silently skipping
the required context. Only a literal docs-only classification may take the N/A path.

Label/unlabel events use a distinct concurrency key, skip the analyzer, and re-read a processed
analysis whose merge has the same base parent, head parent, and tree as the current PR merge, plus
the expected tool and category. GitHub may regenerate a synthetic merge with a different commit SHA
while preserving those identities, so literal SHA equality rejects a result that analyzed the same
merge. Ordinary head events instead bind to the immutable `github.sha` that their own analyzer job
checked out. Head-changing events include `edited`: base retargeting must
reclassify and reanalyze the new merge ref rather than reuse an old-base result. Open/synchronize/
reopen/edited events share a head-analysis lane so synchronize cancels obsolete work. `codeql.yml`
remains the push owner for base-branch inventory and loses its PR trigger, recovery job, and
`actions: write` exception. The canonical classifier becomes the sole docs-only owner; analyzer
applicability consumes its output and no workflow carries a second path list.

Permissions are job-local and minimal: classifier gets `contents: read`; analyzer gets
`contents: read` plus `security-events: write` and no PR write; gate gets `contents: read`,
`security-events: read`, and `pull-requests: write`; disarm keeps its isolated contents/PR write job
without checkout. Permission allowlists must be updated in both directions so deleted exceptions do
not remain as stale authority.

As defense in depth, classifier and gate decision modules execute from the exact base SHA while
diffing or querying the PR. Only the CodeQL analyzer checks out PR merge content with SARIF upload
permission. This does not establish trusted workflow provenance because `pull_request` loads the YAML
from the PR merge revision; that pre-existing repository-wide control-plane gap is contained under
INFRA-097. Label reuse is bound to equal base/head parents and tree, CodeQL tool identity, and
`/language:javascript-typescript` category; an old-base record sharing the same head SHA is rejected.

The recommendation preserves every consumer: develop/main PRs still receive `review-gate`; code PRs
still receive CodeQL analysis; docs-only PRs still get N/A; label changes still re-evaluate; base pushes
still update standing analysis. Adversarial cases—classifier failure, analyzer failure, cancellation,
missing label-event analysis, real blocking alerts, and stale-head results—are fail-closed at the
`review-gate` verdict. On `develop`, that required context blocks merge. On `main`, existing policy
does not require `review-gate`; the isolated disarm remains the best-effort lever and retains its
documented race. Changing `protect-main` is a separate repository-policy decision and is not claimed here.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — PR Review Gate, push CodeQL, permissions, required context, and label events inspected
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None.

## Solution

Add a classifier job with a fail-closed `code` output. Remove `codeql.yml` path-filter ownership and
rewrite classifier tests to assert the PR analyzer consumes the canonical output with no second path
list. Run classifier and gate scripts from the exact base SHA, while explicitly fetching/diffing the
PR head. Move the PR CodeQL init/autobuild/analyze steps
into `review-gate.yml` behind that output and exclude label-only actions. Make the existing gate job
need both jobs and run when the workflow was not cancelled; preserve its withdrawal, collection,
decision, comment, and disarm behavior. Use separate concurrency suffixes for head-changing and
label-only actions.

On ordinary code PR events, the gate accepts analysis only when its analyzer prerequisite succeeded
and the analysis names that run's immutable merge SHA. On label-only events, it accepts only an
already processed CodeQL analysis whose merge base/head parents and tree match the current merge,
along with the expected tool and category.
Missing, failed, malformed, or stale results produce the existing `verdict-unavailable` BLOCK.

Make `codeql.yml` push-only and delete `recover-review-gate`, `actions: write`, rerun scripting, and
recovery comments. Update permission exceptions and documentation. Add parsed workflow tests proving
the dependency/conditions/concurrency and absence of recovery, plus decision regressions for docs,
failure, label reuse, and genuine findings.

## Affected Files

- `.github/workflows/review-gate.yml`
- `.github/workflows/codeql.yml`
- `scripts/harness/scan-workflow-permissions.mjs`
- `scripts/harness/classify-changed-paths.mjs`
- `scripts/harness/check-review-gate.mjs`
- `scripts/harness/__tests__/classify-changed-paths.test.mjs`
- `scripts/harness/__tests__/review-gate-workflow-order.test.mjs`
- `scripts/harness/__tests__/scan-workflow-permissions.test.mjs`
- related current harness documentation
- `.agents/tasks/INFRA-096-order-review-gate-after-codeql.md`

## Completion Criteria

- [x] TC-01: PR CodeQL analysis and `review-gate` are in one DAG with explicit `needs`; the gate runs after prerequisite failure but not after workflow cancellation, and `edited` re-evaluates a retargeted base.
- [x] TC-02: code, docs-only, classifier-failure, analyzer-failure, and label-only paths each preserve fail-closed/N-A semantics without rerunning CodeQL on labels; classifier/gate scripts load from base SHA as defense in depth while INFRA-097 explicitly owns PR-controlled workflow provenance; ordinary runs bind to their event merge SHA, label reuse accepts only equal base/head parents and tree, and same-head old-base, wrong-tool, and wrong-category records are rejected.
- [x] TC-03: `codeql.yml` remains push analysis owner and contains no PR recovery job, `actions: write`, or `gh run rerun` path.
- [x] TC-04: the required context remains named `review-gate`; analyzer, gate, and disarm use separate least-privilege jobs; develop remains merge-blocking while main's existing best-effort disarm limitation is stated; permission/required-check scans pass.
- [x] TC-05: focused tests, `pnpm harness:scan`, and `pnpm harness:verify-like-ci` pass; one real code PR head-analysis lane completes in one ordered attempt without recovery reruns.

## Test Plan

| TC-ID | Test Type                          | Tool / Approach                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Notes                                                                                                                                                                                                                                                                                                                                                                |
| ----- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Workflow contract                  | `scripts/harness/__tests__/review-gate-workflow-order.test.mjs` > `review-gate waits for same-workflow CodeQL (INFRA-096)` > `orders classify then analyze then the required review-gate context`; `handles base retargeting and separates label reevaluation from head analysis concurrency`                                                                                                                                                                                                                                                                                                                                                                          | Assert `needs`, `!cancelled()`, `edited`, exact job name, and concurrency lanes.                                                                                                                                                                                                                                                                                     |
| TC-02 | Adversarial matrix                 | `scripts/harness/__tests__/review-gate-workflow-order.test.mjs` > `review-gate waits for same-workflow CodeQL (INFRA-096)` > `loads governance scripts from base SHA and records the workflow-provenance containment`; `rejects same-head old-base, wrong-tool, and wrong-category analysis identities`; `executes the checked-in jq identity programs against regenerated and stale merges`; `collects alerts only from the selected immutable analysis identity`; `scripts/harness/__tests__/classify-changed-paths.test.mjs` > `the classifier owns the docs-only set`; `scripts/harness/__tests__/check-review-gate.test.mjs` > `not-applicable (no code changed)` | Assert bounded base-SHA defense in depth and INFRA-097 containment; execute the exact checked-in jq projections to bind ordinary runs to event SHA and label reuse to ordered base/head/tree; require result-count and per-instance SHA equality across the alert handoff; reject stale/malformed/unavailable records; no second path list or PR-sourced executable. |
| TC-03 | Permission/source contract         | `scripts/harness/__tests__/review-gate-workflow-order.test.mjs` > `review-gate waits for same-workflow CodeQL (INFRA-096)` > `keeps standalone CodeQL push-only and removes recovery authority`                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | No PR trigger, recovery job, rerun, or actions write.                                                                                                                                                                                                                                                                                                                |
| TC-04 | Security/required-check regression | `scripts/harness/__tests__/review-gate-workflow-order.test.mjs` > `review-gate waits for same-workflow CodeQL (INFRA-096)` > `keeps write permissions separated by job capability`; `scripts/harness/__tests__/scan-workflow-permissions.test.mjs` > `the real repository`; `scripts/harness/__tests__/ci-mirror-map.test.mjs` > `every required check on develop is answered for (anti-drift)`                                                                                                                                                                                                                                                                        | Analyzer holds only SARIF upload authority; gate holds only PR-comment write; disarm's contents/PR write remains isolated from checkout.                                                                                                                                                                                                                             |
| TC-05 | Engineering/live smoke             | **Test skipped:** this criterion is an aggregate root-verification and live GitHub workflow observation; wrapping the external Actions run in another automated test would not reproduce the hosted service.                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Record commands, counts, single-attempt/comment evidence.                                                                                                                                                                                                                                                                                                            |

## Tasks

- [x] `.agents/tasks/INFRA-096-order-review-gate-after-codeql.md`

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-14

**Status upgrade:** draft → review-ready
Independent guard confirmed valid frontmatter, a concrete PR #1718 race reproduction, official
GitHub workflow/CodeQL research that directly supports the chosen DAG, four alternatives with
trade-offs, a fail-closed adversarial matrix, completed architecture checklist, and five TC/Test
Plan rows with exact parity.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-14

**Status upgrade:** review-ready → approved
User approval, verbatim: “추천 우선순위 대로 전부 진행해서 완료해줘.” Independent proposal review
converged to `ENDORSE` after adding the classifier-owned docs-only SSOT, `edited` retarget handling,
job-local least privilege, current-merge label reuse, and the explicit limitation that develop is
required while main retains best-effort disarm.

### [GATE-IMPLEMENT] — ⛔ NON-COMPLIANCE | 2026-08-14

**Status remains:** approved
The first GATE-IMPLEMENT attempt correctly stopped because the GATE-APPROVAL entry summarized rather
than quoted the user's exact approval and the Tasks row still said the now-existing task was missing.
The approval entry now carries the verbatim statement and the exact active task path is checked.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-14

**Status upgrade:** approved → in-progress
The repaired approval quote and task projection satisfy ordering. The active task has TC-01 through
TC-05 one-to-one with a substantive Test Plan, and no implementation commit predates this gate.

### [RECOMMENDATION RE-REVIEW] — ✅ ENDORSE | 2026-08-14

Round A exposed two load-bearing trust defects in the first implementation: PR-controlled governance
scripts could self-classify the PR as docs-only, and label reuse was bound only to head SHA. Base-SHA
script loading was added as defense in depth and reuse was bound to current merge/tool/category.
Re-review then identified the deeper pre-existing fact that the workflow YAML remains PR-controlled;
that repository-wide problem is labelled containment under INFRA-097 / GitHub issue #1719 rather than
overclaimed here. Independent containment re-review returned `REVIEW VERDICT: ENDORSE`.

### Engineering evidence | 2026-08-14

- Focused workflow/harness regression: 8 files, 211 tests passed, exit 0.
- `pnpm harness:scan`: 108 passed, 2 skipped, exit 0.
- `pnpm harness:verify-like-ci`: 12/12 stages passed in 4m04.3s, exit 0. The dominant
  `harness-self-test` stage took 3m31.7s; typecheck took 6.2s.
- PR #1720 run 31736658324, attempt 1: `classify review applicability` success in 10s,
  `Analyze (javascript-typescript)` success in 3m17s, then `review-gate` success in 12s;
  `disarm-auto-merge` skipped. No recovery job or workflow rerun occurred.
- A separate `labeled` event fired when `disposition-containment` was applied before analysis existed;
  that label lane correctly failed closed and was superseded by the head lane. It is intentionally
  distinct from the removed first-fail/recovery ordering protocol.

### [GATE-VERIFY] — ✅ PASS | 2026-08-14

**Status upgrade:** in-progress → verifying
Independent verification reran seven relevant files / 171 tests and the full harness scan (109 passed,
1 skipped), both exit 0. The task is 5/5 complete with no blockers; recorded verify-like-ci is 12/12.
PR #1720's exact HEAD matched local HEAD, and run 31736658324 attempt 1 showed the required ordered
head lane: classify → Analyze → review-gate all success, disarm skipped, no recovery or rerun.

### [GATE-COMPLETE] — ❌ FAIL | 2026-08-14

**Status remains:** verifying
The first completion audit found no per-TC `[GATE-COMPLETE: TC-N]` entries. TC-01 through TC-04
also lacked exact file-plus-suite references, and TC-05 lacked either a test reference or an explicit
skip reason. The Test Plan and per-TC evidence below repair each listed defect before re-review.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-14

**Action:** `pnpm exec vitest run scripts/harness/__tests__/review-gate-workflow-order.test.mjs`
and the broader focused seven-file gate run.
**Observed result:** the parsed workflow suite proved explicit classify → Analyze → review-gate
ordering, cancellation exclusion, `edited` handling, and separate concurrency lanes; the focused
run passed 171 tests. **Exit code:** 0.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-14

**Action:** the same focused run executed `review-gate-workflow-order.test.mjs`,
`classify-changed-paths.test.mjs`, and `check-review-gate.test.mjs`.
**Observed result:** base-SHA loading and INFRA-097 containment were present; same-head old-base,
wrong-tool, wrong-category, unavailable, failed, and non-docs classifications were rejected
fail-closed while docs-only remained N/A. **Exit code:** 0.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-14

**Action:** `pnpm exec vitest run scripts/harness/__tests__/review-gate-workflow-order.test.mjs`
plus `pnpm harness:scan`.
**Observed result:** the standalone CodeQL workflow was push-only and the structural test found no
PR trigger, recovery job, `actions: write`, or `gh run rerun`; the independent scan passed 109 scans
with one intentional skip. **Exit code:** 0.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-14

**Action:** the focused run executed the workflow-order, workflow-permission, disarm, and
required-check mapping suites.
**Observed result:** analyzer, gate, and disarm permissions remained job-local; the required
`review-gate` context and develop merge-blocking mapping remained reachable; all 171 focused tests
passed. **Exit code:** 0.

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-08-14

**Action:** `pnpm harness:verify-like-ci` and live observation of PR #1720 run `31736658324`,
attempt 1, at implementation HEAD `72551fa8f`.
**Observed result:** local verification passed 12/12 stages in 4m04.3s; the hosted head lane ran
classify (10s) → Analyze (3m17s) → review-gate (12s), all success, with disarm skipped and no
recovery job or rerun. **Exit code:** 0 for the local command; GitHub run conclusion: success.

### [GATE-COMPLETE] — ❌ FAIL | 2026-08-14

**Status remains:** verifying
The second completion audit confirmed every per-TC criterion and test disposition, but found the
catalogue-required final summary entry absent. The summary below repairs that sole remaining defect.

### [GATE-COMPLETE] — ❌ FAIL | 2026-08-14

**Status remains:** verifying
The third completion audit found the final PASS summary substantively complete but missing the
mandatory `Status upgrade: verifying → done` line. This failed audit is retained as the ordering
record before the repaired PASS below.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-14

**Status upgrade:** verifying → done
TC-01 through TC-05 are checked and each has exact verification evidence plus an exact test
reference or explicit skip reason. The active task is 5/5 complete with no blockers, and the prior
GATE-VERIFY PASS is recorded. Status/folder transition and task archival remain the post-PASS handoff.

### [COMPLETION REOPENED] — 🔁 IN-PROGRESS | 2026-08-14

PR #1720 run `31738169221` exposed a post-gate implementation defect on final HEAD `ba667c237`.
CodeQL analyzed synthetic merge `596c61a5`; before the dependent gate queried the PR, GitHub had
regenerated the same two-parent/same-tree merge as `60b2c51f`. Literal current-SHA equality rejected
the successful analysis. The item returns to implementation with TC-02 reopened; prior completion
evidence remains historical and must be superseded by fresh verification.

### Reopened implementation evidence | 2026-08-14

- RED: the focused workflow contract failed because the workflow still required literal
  current-merge SHA equality and lacked event/equivalent-merge identity handling.
- GREEN: the workflow-order suite passed 9/9, including execution of the exact checked-in jq
  identity programs; the broader seven-file workflow/permission/decision regression passed
  170/170, exit 0. The selected analysis's `results_count` and every open/dismissed alert instance
  are now verified against the same SHA before the decision receives the open-alert list. A proposed new resolver script
  was removed before commit because base-SHA checkout cannot execute a file absent from the base;
  the API identity projection remains in the workflow control plane without PR-sourced executable code.
- `pnpm harness:scan` passed 109 scans with one intentional skip, exit 0.
- Fresh `pnpm harness:verify-like-ci` passed 12/12 in 4m16.4s, exit 0. The repository-contract
  tier accounted for 3m42.5s (110 files / 2,241 tests); the hermetic tier took 12.0s.
- Hosted final-head validation remains the next verification step; no completion claim is made here.
