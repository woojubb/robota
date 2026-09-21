---
status: in-progress
type: INFRA
lane: L2
issue: 2804
tags: [ci]
---

# INFRA-2804: Gate coverage for `integration/**` bases

## Problem

**Symptom.** A pull request whose base is an `integration/**` branch runs no repository CI. Measured on
PR #2803 (`feat/mcp-001-typed-control-plane` → `integration/agreement-014`), the complete check list is:

```
Cloudflare Pages: robota        pass
Cloudflare Pages: robota-docs   pass
Cloudflare Pages: robota-www    pass
Claude review                   skipping
```

Three deploy previews and one skipped job. No `format-check`, no `scans`, no `regression-red-proof`, no
build, no test, no secret scan, no dependency review.

**Reproduction condition.** Open any pull request against a branch matching `integration/*`. Every
workflow in `.github/workflows/` restricts `pull_request` to `main` and/or `develop`:

| workflow                       | trigger               | `branches:`       |
| ------------------------------ | --------------------- | ----------------- |
| `ci.yml`                       | `pull_request`        | `[main, develop]` |
| `dependency-review.yml`        | `pull_request`        | `[main, develop]` |
| `gitleaks.yml`                 | `pull_request`        | `[main, develop]` |
| `review-gate.yml`              | `pull_request`        | `[main, develop]` |
| `workflow-provenance-gate.yml` | `pull_request_target` | `[main, develop]` |
| `codeql.yml`                   | `push`                | `[main, develop]` |
| `scans-full.yml`               | `push`                | `[develop]`       |

No pattern matches `integration/**`, so none dispatches.

**Why it is not merely missing coverage.** `.claude/hooks/merge-gate.sh:19` states its first question as
"Is CI green? `mergeStateStatus == CLEAN`", and enforces it at line 183. GitHub reports `CLEAN` when no
required check is failing — which includes the case where no check exists. Measured on the same PR:

```
mergeStateStatus: CLEAN
mergeable: MERGEABLE
checks: 4
```

So the gate's CI question is answered `CLEAN` by a pull request that ran no gate. The hook's own header
(line 6) says "An unknown state is not a clean one"; here an EMPTY state is being read as a clean one.
The child PR's checks page looks like a healthy green page, and nothing reports the absence.

**Blast radius.** The AGREEMENT coordination model stacks child PRs onto an integration branch. Under the
current configuration every child lands unverified, and verification first occurs at the
`integration/* → develop` pull request — by which time many children have merged, so a failure there must
be bisected across the whole stack rather than attributed to the child that introduced it.

This is the same shape as issue #2798 (a protection rule targeting no ref, so its required checks enforce
nothing) and belongs to the class HARNESS-052 tracks (a check reporting success over work it did not do).

## Prior Art Research

### References consulted

| #   | Source                                                                                                                                                                                                                            | Type          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| R1  | [GitHub Docs — Events that trigger workflows (`pull_request`)](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)                                                                  | Product docs  |
| R2  | [GitHub Docs — Workflow syntax, filter pattern cheat sheet](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#filter-pattern-cheat-sheet)                                                        | API reference |
| R3  | [GitHub Docs — Troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks) | Product docs  |
| R4  | [GitHub Docs — Creating rulesets for a repository](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository)                               | Product docs  |
| R6  | [GitHub Docs — Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)                                         | Product docs  |
| R7  | [GitLab Docs — Merge trains](https://docs.gitlab.com/ci/pipelines/merge_trains/)                                                                                                                                                  | Product docs  |
| R8  | [GitLab Docs — `workflow` keyword](https://docs.gitlab.com/ci/yaml/workflow/)                                                                                                                                                     | CI reference  |
| R9  | [Buildkite Docs — Branch configuration](https://buildkite.com/docs/pipelines/configure/workflows/branch-configuration)                                                                                                            | Product docs  |
| R11 | [Graphite Docs — Stacking and CI](https://graphite.com/docs/stacking-and-ci)                                                                                                                                                      | Product docs  |
| R12 | [Graphite Docs — Merge Queue](https://graphite.com/docs/graphite-merge-queue)                                                                                                                                                     | Product docs  |
| R13 | [Gerrit Docs — Intro to Gerrit for users](https://gerrit-review.googlesource.com/Documentation/intro-user.html)                                                                                                                   | Product docs  |

Not verified: CircleCI's canonical configuration reference returned HTTP 404 to the researcher, so the
CircleCI comparison rests on a vendor support article alone and is not relied on below.

### Observed common behaviour

**Glob-widened base filters are the documented idiom, not a workaround.** GitHub documents `branches` on
`pull_request` as matching the base branch, and its own worked example is a long-lived branch family:
`'releases/**'` — "A branch whose name starts with `releases/`, like `releases/10`" (R1, R2). Buildkite
(`'main features/*'`, R9) and GitLab (`workflow:rules`, R8) express the same scoping the same way. No
vendor documents a dedicated mechanism for "integration branch CI"; they all document widening the
pattern.

**On the vacuous-green question the vendors are sharper than expected, and it changes this design.**
GitHub's troubleshooting page (R3) lists branch filtering as a documented cause of checks that "stay in a
'Pending' state and block merging", with the remedy "Avoid requiring workflows that can be skipped". The
load-bearing detail: that blocking behaviour materialises **only when the check is required on that base**,
and required-ness comes from a ruleset targeting the base — ruleset targets being themselves `fnmatch`
patterns, e.g. `qa/**/*` (R4). Where no ruleset targets the base, GitHub documents no state at all for a
check that never dispatched: there is nothing to be pending, and a zero-check PR is simply mergeable.
GitLab documents the mirror image — a merge request that "displays `Checking pipeline status.` but the
message never goes away" (R8). Both vendors treat a missing check as stuck, never as a pass.

**Stacked-PR tooling verifies per entry; the landing-point queue is an addition, not a replacement.**
GitHub's merge queue requires PRs to pass branch-protection checks _before_ queue entry (R6); GitLab's
merge trains run a merged-results pipeline per merge request (R7); Gerrit reviews each change in a series
individually (R13). Graphite runs CI on every stack entry by default, and its reduction feature is opt-in,
bounded by stack position, and fails open — "If the request to our API is malformed or errors for any
reason, we will not skip CI" (R11). Its merge-queue fast-forward skips a re-run only when a green already
exists for that exact commit (R12), which is the opposite of the situation here. No tool documents
"verify only at the landing point."

**Cost.** Graphite is the only vendor with published cost guidance and argues against pre-optimising:
"Organizations with fewer than 10 stackers are unlikely to see any difference in CI wait times or runs"
(R11). No comparable reference found recommending that CI be disabled on intermediate stack entries by
default.

### Constraints that apply to Robota

**The repository already chose widening, in the adjacent lane, for this exact reason.**
`.github/workflows/claude-code-review.yml` carries no `branches:` filter at all, with the rationale inline:

> Every PR base is deliberate: multi-backlog initiatives merge child PRs into a stable integration base
> before the final develop PR. Filtering to main/develop left those children with no reviewer at all
> (INFRA-098).

The reviewer lane solved this problem this way; the CI lane did not follow. This spec closes that gap
rather than inventing an approach.

Second: `ci.yml` subscribes `edited` deliberately (INFRA-055), because retargeting a pull request's base
fires `edited` and not `synchronize`. Widening must touch `branches:` only and leave `types:` intact, or a
child retargeted from `integration/<name>` to `develop` would not re-dispatch the now-in-scope pipeline.

Third: `scan-ci-concurrency-footprint` freezes the job count of every workflow a pull request can trigger.
Widening the base filter does not change the per-PR job count, but it multiplies the number of pull
requests that dispatch it. R11 is the applicable prior art for bounding that later, with data, if it
becomes measurable.

### Recommendation

Widen the filters to `integration/**` — the documented idiom (R1, R2) and the repository's own INFRA-098
precedent — but treat it as necessary and not sufficient. Under R3, "no checks ran" is distinguishable
from "checks passed" only when a rule requires a named check on that base. Two coupled changes are
therefore indicated: (a) the workflow filters gain `integration/**`, and (b) a ruleset targeting
`integration/**` requires the same check names `main`/`develop` require. Where (b) is out of scope, the
local merge gate must assert a non-empty, name-matched required-check set rather than "no check failed".

Merge queues and merge trains are explicitly the wrong instrument here (R6, R7): both presuppose per-pull-request
verification, so neither would have produced a single check on the measured pull request.

**Rejected alternative, recorded:** a dedicated "integration CI" workflow duplicating `ci.yml`'s jobs. No
vendor documents it, it doubles the frozen job-count surface, and the two definitions would drift.

## Architecture Review

### Affected Scope

- `.github/workflows/ci.yml` — trigger filter only
- `.github/workflows/gitleaks.yml` — trigger filter only
- `.github/workflows/dependency-review.yml` — trigger filter only
- `.github/workflows/workflow-provenance-gate.yml` — trigger filter only
- `.claude/hooks/merge-gate.sh` — distinguish "checks passed" from "there were no checks"

No package source changes. No job bodies change.

**Sibling scan.** The four workflows above are the `pull_request`-triggered gates; `codeql.yml`,
`scans-full.yml` and `security-scheduled.yml` are `push`-triggered and are a different axis, examined under
Alternatives below rather than skipped silently.

### Alternatives Considered

1. **Widen the `pull_request` branch filters to include `integration/**`.**
   - Pro: the documented GitHub Actions mechanism for this exact question (R1, R2), and the repository's
     own INFRA-098 precedent in the reviewer lane. No job bodies change, because `ci.yml` already splits
     its jobs on `base_ref == 'main'` (promotion-only) versus `!= 'main'` (the normal gate) — an
     `integration/*` base takes the normal path and the promotion jobs skip on their existing conditions.
   - Con: CI minutes per child pull request, against a shared account concurrency budget.

2. **Leave CI as is; require a local verification receipt on child PRs, and have `merge-gate` refuse a
   vacuous CLEAN when the base matches `integration/**`.**
   - Pro: no CI cost, and it closes the silence.
   - Con: moves a machine-checked gate to an agent-produced artifact, the direction this repository has
     repeatedly moved away from. A receipt attests that commands were run, not that they were run on the
     merge result — which is the property CI has and a receipt structurally cannot.

3. **Declare integration branches explicitly out of gate scope and make `merge-gate` say so out loud.**
   - Pro: cheapest, and removes the silence, which is the worst property of the current state.
   - Con: leaves children genuinely unverified. It makes the hole legible instead of closing it.

4. **Stop stacking: target child pull requests at `develop` directly.**
   - Pro: full CI immediately, with no configuration change at all.
   - Con: abandons the AGREEMENT coordination model, whose purpose is to land a multi-PR migration as one
     reviewable unit. Prior art is against it: every stacking tool surveyed verifies per entry rather than
     abandoning the stack (R6, R7, R11, R13).

### Decision

**Alternative 1, plus the `merge-gate` half of alternative 3.**

Alternative 1 closes the hole for the four `pull_request` gates. The decisive fact is that it needs no job-body edits,
and this was enumerated rather than assumed — all 20 jobs in `ci.yml`, parsed as YAML:

| condition                                     | count | behaviour on an `integration/*` base                      |
| --------------------------------------------- | ----- | --------------------------------------------------------- |
| `base_ref == 'main'`                          | 4     | skip — promotion-only, unreachable from a non-`main` base |
| `base_ref != 'main'` (with or without guards) | 12    | **run** — this is the coverage being restored             |
| `github.event_name == 'workflow_dispatch'`    | 3     | skip — benchmark jobs                                     |
| no condition (`changes`)                      | 1     | run — the path-filter job the others depend on            |

There is no job that both lacks a `base_ref` condition and assumes a `develop`/`main` base, which is the
only way widening a trigger could silently enable work that was never meant to run here. `base_ref`
resolves to `integration/agreement-014`, and the jobs interpolate it as `origin/${{ github.base_ref }}` —
a valid ref.

Alternative 1 is also what the repository already decided in the adjacent lane. `claude-code-review.yml` dropped its
base filter for exactly this reason under INFRA-098 — "Filtering to main/develop left those children with
no reviewer at all." The reviewer lane closed this hole; the CI lane did not follow. This is that follow.

The `merge-gate` change is kept even though alternative 1 makes the vacuous-CLEAN case rarer, because alternative 1 does not make
it impossible: any future base pattern with no matching workflow reproduces it, and a gate that cannot
distinguish an empty result from a passing one is a defect independent of which branches currently have
coverage. Closing only alternative 1 would leave the detector broken and rely on configuration never drifting again —
which is precisely the assumption that produced this issue.

**The half this change cannot deliver, stated rather than glossed.** Prior art (R3, R4) establishes that
GitHub distinguishes "no checks ran" from "checks passed" only when a **ruleset targeting that base**
requires a named check; absent one, a zero-check pull request is simply mergeable and no state is
reported. The complete fix is therefore two coupled parts: the workflow filters here, and a ruleset
targeting `integration/**` requiring the same check names `main`/`develop` require. **The ruleset is a
repository protection setting, not code in this repository, and is outside this agent's authority** — the
owner's delegation covers merges into `develop`, explicitly not protection changes. It is recorded on
issue #2804 for the owner, and issue #2798 (a protection rule targeting no ref) is evidence that this
second half needs attention on its own terms. The `merge-gate` change is what makes this change useful in
the meantime: it is the local stand-in for the required-check assertion GitHub would make, and it is why
alternative 1 without the ruleset is still worth landing rather than waiting.

**Delivery mode:** `single`

One delivery. The four trigger filters and the `merge-gate.sh` refusal are a single coherent
change: widening the filters without the gate change leaves the vacuous-CLEAN detector broken,
and the gate change without the filters refuses child pull requests it has no way to make pass.
Splitting them would ship a half that is worse than either whole.

**Deliberately excluded from this change, each with its reason:**

- `codeql.yml` — `push`-triggered, not a PR gate. Adding integration branches changes the code-scanning
  topology and is coupled to `review-gate.yml`'s code-scanning half; that pairing deserves its own
  decision rather than being carried along by a branch-filter edit.
- `review-gate.yml` — its code-scanning half compares the PR's merge ref against the base branch's
  analysis. With `codeql.yml` not analysing integration branches, the base side would not exist, so
  enabling it here would add a check that cannot reach a verdict — re-creating this issue's own defect one
  layer down. Blocked on the `codeql.yml` decision.
- `scans-full.yml` — `push`-triggered on `develop`, and currently RED there (issue #2756). Adding
  integration branches would block every child PR on a pre-existing failure unrelated to it.
- `security-scheduled.yml` — a scheduled posture scan, `push`/`schedule`-triggered with no pull-request
  contract at all. It is not a PR gate in any base, so this change neither reaches it nor should.

These four are recorded on issue #2804 as follow-up rather than left unmentioned.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — four workflow files plus one hook; no package source
- [x] Sibling scan 완료 — all 15 files in `.github/workflows/` classified by trigger; the 6 that carry a
      `pull_request`/`pull_request_target` trigger are the subject, the 3 `push`-triggered ones are addressed explicitly under
      Alternatives rather than skipped, and the remaining 6 are `workflow_dispatch`/release-only
      (`live-provider-smoke`, `mutation-nightly`, `ruleset-drift`, `release-bun-binaries`,
      `release-desktop-app`, `release-tag-on-version-bump`), which no pull request base can reach
- [x] 대안 최소 2개 검토 완료 — four alternatives (1–4)
- [x] 결정 근거 문서화 완료 — alternative 1 plus the `merge-gate` half of alternative 3, with the exclusion reasons recorded

## Fallback & Degradation Declaration

None.

The `merge-gate` change moves in the opposite direction: it removes an implicit fallback in which an
absent CI result degrades silently into a passing one.

## Solution

1. Add `integration/**` to the `branches:` list of the `pull_request` trigger in `ci.yml`,
   `gitleaks.yml` and `dependency-review.yml`, and of the `pull_request_target` trigger in
   `workflow-provenance-gate.yml`. No job body changes.
2. In `.claude/hooks/merge-gate.sh`, before accepting `mergeStateStatus == CLEAN`, read the PR's check
   count and refuse when no repository gate check is present, naming the condition. A `CLEAN` state
   backed by zero gate checks is reported as the distinct condition it is, not as green.

## Affected Files

- `.github/workflows/ci.yml`
- `.github/workflows/gitleaks.yml`
- `.github/workflows/dependency-review.yml`
- `.github/workflows/workflow-provenance-gate.yml`
- `.claude/hooks/merge-gate.sh`
- `.agents/tasks/INFRA-2804-gate-workflows-do-not-cover-integration-bases-so-stacked-child-prs-receive-no-ci.md`

## Completion Criteria

- [ ] TC-01: `node -e` over `.github/workflows/ci.yml` parsed as YAML shows `on.pull_request.branches`
      containing exactly `main`, `develop` and `integration/**` — the filter is widened, not replaced
- [ ] TC-02: the same assertion holds for `gitleaks.yml`, `dependency-review.yml` (`on.pull_request.branches`)
      and `workflow-provenance-gate.yml` (`on.pull_request_target.branches`)
- [ ] TC-03: `grep -c "base_ref == 'main'" .github/workflows/ci.yml` is unchanged from the pre-change
      count, and no job's `if:` condition is modified — proved by
      `git diff origin/develop...HEAD -- .github/workflows/ci.yml` touching only the `branches:` list
- [ ] TC-04: on a pull request whose base is `integration/**`, `gh pr checks <n>` lists the `ci.yml` gate
      jobs (at minimum `format-check`, `scans` and `build`) rather than deploy previews alone — verified
      on the live PR #2803 after this change lands
- [ ] TC-05: on the same pull request, no job whose condition is `base_ref == 'main'` reports a
      conclusion other than skipped
- [ ] TC-06: `.claude/hooks/merge-gate.sh` refuses a PR whose `mergeStateStatus` is `CLEAN` but which
      carries zero repository gate checks, printing a message that names the zero-check condition and does
      NOT print the word `CLEAN` as an accepted state — exercised against a recorded fixture
- [ ] TC-07: `.claude/hooks/merge-gate.sh` still accepts a PR with `CLEAN` status and passing gate checks
      — the new refusal does not block the normal path
- [ ] TC-09: the `types:` list of every widened trigger is byte-identical to its pre-change value —
      INFRA-055 subscribes `edited` because retargeting a base fires `edited`, not `synchronize`, so a
      child retargeted from `integration/<name>` to `develop` must still re-dispatch
- [ ] TC-08: `bash -n .claude/hooks/merge-gate.sh` exits 0 and
      `node scripts/harness/run-all-scans.mjs --affected --context pr` reports no NEW failure relative to
      the base

## Test Plan

Strategy derived from `type: INFRA` + `tags: [ci]` → CI pipeline smoke test, plus command-form assertions
over the workflow files (mechanically checkable, so `manual` rows are avoided).

| TC-ID | Test Type        | Tool / Approach                                                   | Notes                                                                                                |
| ----- | ---------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| TC-01 | config assertion | `node` + `yaml` parse of `ci.yml`, assert the branches array      | Parsed, not grepped: a grep would pass on a commented-out line                                       |
| TC-02 | config assertion | same, over the three remaining workflow files                     |                                                                                                      |
| TC-03 | diff assertion   | `git diff origin/develop...HEAD -- .github/workflows/ci.yml`      | Proves the change is trigger-only; the whole safety argument rests on job conditions being untouched |
| TC-04 | CI smoke         | `gh pr checks 2803` after the change lands on `develop`           | The real observable — the issue is defined by what the checks page shows                             |
| TC-05 | CI smoke         | `gh pr checks 2803` + job conclusions                             | Guards the one risk of widening a trigger: a promotion-only job running off a non-promotion base     |
| TC-06 | unit (shell)     | fixture-driven invocation of `merge-gate.sh` with a zero-check PR | Recorded `gh` output fixture; the hook must refuse                                                   |
| TC-07 | unit (shell)     | same harness, with a passing-checks PR                            | Red-proof partner for TC-06: without it TC-06 passes trivially by refusing everything                |
| TC-09 | diff assertion   | `git diff origin/develop...HEAD` over the four workflows, asserting no `types:` line changes | Cheap to get wrong silently: a rewritten trigger block that drops `edited` breaks base-retargeting with no visible failure |
| TC-08 | lint / scan      | `bash -n` + `run-all-scans.mjs --affected --context pr`           | Two base-state scans are already red (#2797, SECRET-2664); the criterion is no NEW failure, not zero |

## Tasks

- [ ] `.agents/tasks/INFRA-2804-gate-workflows-do-not-cover-integration-bases-so-stacked-child-prs-receive-no-ci.md` — populated

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-09-21

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 0 numbered alternative(s), 2 required
  **Required action:** add alternatives

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `40d72b9b4943` · base `origin/develop@40d72b9b4943` · document `.agents/spec-docs/draft/INFRA-2804-gate-coverage-for-integration-bases.md` blob `d88ad2681ea9` (untracked)

### [GATE-WRITE] — ❌ FAIL | 2026-09-21

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — Decision references the trade-off that drove the choice: the Decision names its
  trade-off and stakes it on an enumeration it presents as machine-derived ("this was enumerated
  rather than assumed — all 20 jobs in `ci.yml`, parsed as YAML"), but that table is not the parse.
  Its rows sum to 21 against its own stated total of 20, and the load-bearing row is wrong:
  `base_ref != 'main'` is recorded as 13, and a YAML parse of `.github/workflows/ci.yml` at HEAD
  `40d72b9b4943` returns **12** — `build`, `quality`, `scans`, `dependency-audit`, `format-check`,
  `actionlint`, `commitlint`, `examples-typecheck`, `windows-shell`, `tui-e2e`,
  `regression-red-proof`, `patch-coverage`. The other three rows verify exactly (`base_ref == 'main'`
  = 4: `main-pr-source-guard`, `promotion-ancestry`, `promotion-closes`, `release-grade-verify`;
  `workflow_dispatch` = 3; no condition = 1 — `changes`), and 4+12+3+1 = 20. The Decision's
  CONCLUSION survives the corrected count — no job both lacks a `base_ref` condition and assumes a
  `develop`/`main` base — but the evidence offered for the decisive fact does not match the tree it
  claims to have been parsed from.
  **Required action:** correct the `base_ref != 'main'` row to 12 so the table sums to the 20 jobs it
  names, and re-run GATE-WRITE. No design change is implied — this is a correction to the Decision's
  enumeration only.

**Semantic criteria checked (6 PASS, 1 FAIL) — `backlog-gate-guard`, L2:**

- Problem — contains a concrete symptom: PASS. Names PR #2803
  (`feat/mcp-001-typed-control-plane` → `integration/agreement-014`) and its exact check list.
  Verified live: `gh pr view 2803` returns `mergeStateStatus: CLEAN`, `mergeable: MERGEABLE`, 4 checks
  — `Claude review` SKIPPED plus the three `Cloudflare Pages` successes, with no `format-check`,
  `scans`, `build` or `regression-red-proof`. The quoted output matches the repository state.
- Problem — contains a reproduction condition: PASS. "Open any pull request against a branch matching
  `integration/*`", with the mechanism given as a 7-row trigger table. Every row verified against
  `.github/workflows/`: `ci.yml`, `dependency-review.yml`, `gitleaks.yml`, `review-gate.yml`
  `pull_request: [main, develop]`; `workflow-provenance-gate.yml` `pull_request_target: [main,
  develop]`; `codeql.yml` `push: [main, develop]`; `scans-full.yml` `push: [develop]`. No pattern
  matches `integration/**`. The supporting hook citations also verify: `merge-gate.sh:19` is
  "1. Is CI green? `mergeStateStatus == CLEAN`.", line 183 is `if [[ "$STATE" != "CLEAN" ]]`, and
  line 6 reads "An unknown state is not a clean one".
- Prior Art Research — findings feed Alternatives Considered / Decision: PASS. R1/R2 (GitHub's
  `releases/**` base-filter idiom) are the ground for alternative 1; R3/R4 produce the spec's
  non-obvious half — that "no checks ran" is distinguishable from "checks passed" only under a ruleset
  targeting the base — which is carried into the Decision as a declared out-of-scope dependency rather
  than assumed away; R6/R7/R11/R13 are what alternative 4 is rejected ON; R11 bounds the cost
  argument. Recommendation is derived, not asserted, and the one unverifiable source (CircleCI, HTTP
  404) is named and explicitly not relied on. Issues cited as corroboration all exist and match:
  #2798 (`protect-develop` targets no ref), #2756 (scans-full red on develop), #2797.
- Architecture Review — new-surface placement (conditional): **N/A.** The change introduces no
  package, app, presentation or interface surface and reclassifies no layer or product-family
  boundary. Affected Scope is four existing `.github/workflows/` trigger filters plus one existing
  hook, with "No package source changes. No job bodies change." The conditional does not arm.
- Completion Criteria — at least 1 criterion per distinct feature or sub-item: PASS. Solution item 1
  (widen four trigger filters) → TC-01, TC-02, plus TC-03/TC-09 for the "trigger-only" and
  `types:`-preservation constraints the Constraints section raises; Solution item 2
  (`merge-gate.sh` zero-check refusal) → TC-06 with TC-07 as its red-proof partner; the live
  observable → TC-04, TC-05; repo-level regression → TC-08. No sub-item is uncovered.
- Completion Criteria — each criterion uses Command form or Observable behavior form: PASS. TC-01/02
  `node` YAML parse assertions on a named key; TC-03/TC-09 `git diff origin/develop...HEAD` over named
  paths; TC-04/TC-05 `gh pr checks 2803` with named jobs and named conclusions; TC-06/TC-07
  fixture-driven `merge-gate.sh` invocations with a stated observable (refuses / still accepts);
  TC-08 `bash -n` exit 0 plus `run-all-scans.mjs --affected --context pr` with an explicit
  no-NEW-failure baseline. None relies on vague language.

**Observations (not criteria this guardian owns, recorded so they are not lost):** the Architecture
Review Checklist still labels the alternatives "(A–D)" and the decision "A plus the `merge-gate` half
of C", while § Alternatives Considered and § Decision now use 1–4 — residue of the earlier bounded
renumbering correction; and the same checklist says "all 9 workflow files inspected" where
`.github/workflows/` holds 15 files (9 is the CI/gate subset, the other 6 being release and
`workflow_dispatch`-only workflows). Both are mechanical-criterion surfaces judged PASS by `gate.mjs`
and neither decides this verdict.

**Judged by:** `backlog-gate-guard` — semantic criteria only (mechanical set judged by `gate.mjs`: 20 PASS, 0 FAIL)
**Judged at:** HEAD `40d72b9b4943` · base `origin/develop@40d72b9b4943` · document `.agents/spec-docs/draft/INFRA-2804-gate-coverage-for-integration-bases.md` blob `fcd78c2f9f14` (untracked)

### [GATE-WRITE] — ✅ PASS | 2026-09-21

**Status upgrade:** draft → review-ready

- GATE-WRITE — Problem contains a concrete symptom: PR #2803
  (`feat/mcp-001-typed-control-plane` → `integration/agreement-014`) with its complete check list.
  Re-verified live this run: `gh pr view 2803` returns `mergeStateStatus: CLEAN`,
  `mergeable: MERGEABLE`, and exactly 4 checks — `Claude review` SKIPPED plus `Cloudflare Pages:
  robota` / `robota-docs` / `robota-www` SUCCESS. No `format-check`, `scans`, `build` or
  `regression-red-proof`, as the document states.
- GATE-WRITE — Problem contains a reproduction condition: "Open any pull request against a branch
  matching `integration/*`", with the mechanism given as a 7-row trigger table. Re-verified by parsing
  every file in `.github/workflows/` as YAML: `ci.yml`, `dependency-review.yml`, `gitleaks.yml`,
  `review-gate.yml` carry `pull_request` with `branches: [main, develop]`;
  `workflow-provenance-gate.yml` carries `pull_request_target` with the same; `codeql.yml` `push:
  [main, develop]`; `scans-full.yml` `push: [develop]`. No pattern matches `integration/**`. Hook
  citations verified: `merge-gate.sh:19` = "1. Is CI green? `mergeStateStatus == CLEAN`.", line 183 =
  `if [[ "$STATE" != "CLEAN" ]]`, line 6 = "An unknown state is not a clean one".
- GATE-WRITE — Research findings feed Alternatives Considered / Decision: R1/R2 (GitHub's documented
  `releases/**` base-filter idiom) ground alternative 1; R3/R4 produce the finding that "no checks ran"
  is distinguishable from "checks passed" only under a ruleset targeting the base, which the Decision
  carries as a declared out-of-authority dependency instead of assuming away; R6/R7/R11/R13 are the
  grounds alternative 4 is rejected on; R11 bounds the cost argument. The recommendation is derived,
  not asserted, and the one unreachable source (CircleCI, HTTP 404) is named and excluded by the
  document itself. Corroborating issues verified to exist with matching subjects: #2798, #2756, #2797,
  #2804.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS on re-judgement. The
  Decision selects alternative 1 plus the `merge-gate` half of alternative 3 and names what each buys
  and costs — alternative 1's con is CI minutes against a shared concurrency budget; the `merge-gate`
  half is kept although alternative 1 makes vacuous-CLEAN rarer, because "a gate that cannot
  distinguish an empty result from a passing one is a defect independent of which branches currently
  have coverage"; alternative 3's own con (children left unverified) is why only its detector half is
  taken. The decisive fact ("it needs no job-body edits") is now backed by an enumeration that matches
  the tree: an independent YAML parse of `.github/workflows/ci.yml` at HEAD `40d72b9b4943` returns 20
  jobs — `base_ref == 'main'` 4, `base_ref != 'main'` **12**, `workflow_dispatch` 3, unconditioned 1 —
  and 4+12+3+1 = 20, the total the sentence claims. This is the criterion that FAILed on the previous
  run (the row read 13, and the rows summed to 21); the corrected row is 12 and reproduces exactly.
  The conclusion it supports also re-verifies: `changes` is the only unconditioned job and it is the
  path-filter job, so no job both lacks a `base_ref` condition and assumes a `develop`/`main` base.
- GATE-WRITE — New-surface placement (conditional): **N/A.** The spec introduces no package, app,
  presentation or interface surface and reclassifies no layer or product-family boundary. Affected
  Scope is four existing `.github/workflows/` trigger filters plus one existing hook, with "No package
  source changes. No job bodies change." The conditional does not arm, so no mirrored-layer naming or
  shared-contract reuse argument is required.
- GATE-WRITE — At least 1 Completion Criterion per distinct feature or sub-item: Solution item 1
  (widen four trigger filters) → TC-01, TC-02, with TC-03 and TC-09 covering the two constraints the
  Constraints section raises (trigger-only edit; `types:` preserved for INFRA-055 base-retargeting);
  Solution item 2 (`merge-gate.sh` zero-check refusal) → TC-06, with TC-07 as its red-proof partner;
  the live observable → TC-04, TC-05; repository-level regression → TC-08. No sub-item is uncovered.
- GATE-WRITE — Each Completion Criterion uses Command or Observable behavior form: TC-01/TC-02 are
  `node` YAML-parse assertions on a named key; TC-03/TC-09 are `git diff origin/develop...HEAD`
  assertions over named paths; TC-04/TC-05 are `gh pr checks 2803` with named jobs and named
  conclusions; TC-06/TC-07 are fixture-driven `merge-gate.sh` invocations with stated observables;
  TC-08 is `bash -n` exit 0 plus `run-all-scans.mjs --affected --context pr` against an explicit
  no-NEW-failure baseline. None relies on vague language.

**Correction boundedness (re-run):** the two prior FAIL entries remain in place; the log is
append-only. Comparing the document against the copy read on the previous run, the only changes are
the Decision table's `base_ref != 'main'` row (13 → 12) and the two Architecture Review Checklist
lines. § Problem, § Prior Art Research, § Solution, § Affected Files, § Completion Criteria,
§ Test Plan and § Tasks are unchanged.

**Verification of the two corrected observations (both on mechanical criteria; recorded because the
new text makes checkable claims):** `.github/workflows/` holds 15 files, as the checklist now says.
The 6 named as unreachable are present under exactly those names and none carries a `pull_request` or
`pull_request_target` trigger — `live-provider-smoke.yml`, `mutation-nightly.yml`, `ruleset-drift.yml`
are `workflow_dispatch` only; `release-bun-binaries.yml` and `release-desktop-app.yml` are `push` on
tags `v*` plus `workflow_dispatch`; `release-tag-on-version-bump.yml` is `push` on `branches: [main]`
plus `workflow_dispatch`. The load-bearing claim "which no pull request base can reach" therefore
holds exactly for all 6. The alternatives now read 1–4 and the Decision reference reads "alternative 1
plus the `merge-gate` half of alternative 3", consistent with § Alternatives Considered.

**Residual observation, not verdict-deciding (mechanical Sibling-scan surface, not a semantic
criterion this guardian owns):** the checklist calls the remaining 9 "the 9 that can gate a pull
request", but only 6 of them have a `pull_request`/`pull_request_target` trigger; `codeql.yml`,
`scans-full.yml` and `security-scheduled.yml` are `push`-triggered and produce no check on a pull
request. The same sentence discloses that 3 of the 9 are `push`-triggered, so the trigger facts are
not misstated — only the collective label is loose. Relatedly, of those 3 the Decision's exclusion
list gives an explicit reason for `codeql.yml` and `scans-full.yml` (and for `review-gate.yml`, which
is PR-triggered); `security-scheduled.yml` is named only in the § Affected Scope sibling-scan
paragraph as "a different axis".

**Judged by:** `backlog-gate-guard` — semantic criteria only (mechanical set judged by `gate.mjs`: 20 PASS, 0 FAIL)
**Judged at:** HEAD `40d72b9b4943` · base `origin/develop@40d72b9b4943` · document `.agents/spec-docs/draft/INFRA-2804-gate-coverage-for-integration-bases.md` blob `e22ba5d82527` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-21

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인함"
**Given:** 2026-09-21, this conversation
**Review fingerprint:** 94ba113cf82b (review acd5ee8b, type/tags 06ee2339)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-21, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (94ba113cf82b) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `40d72b9b4943` · base `origin/develop@40d72b9b4943` · document `.agents/spec-docs/backlog/INFRA-2804-gate-coverage-for-integration-bases.md` blob `bddd6ccdcdb0` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-21

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인함"
**Given:** 2026-09-21, this conversation
**Review fingerprint:** 94ba113cf82b (review acd5ee8b, type/tags 06ee2339)

**Ordering check (run before any criterion):** prior gate GATE-WRITE shows `✅ PASS` in this log with
`**Status upgrade:** draft → review-ready`; the prior-gate map declares this row's re-run rule as
`recorded-pass`, and its condition holds — `Y` (`review-ready`) equals the document's current
`status: review-ready`. The last GATE-WRITE entry is that PASS, so the default last-entry rule is
satisfied too. Expected input state also matches: `status: review-ready` ↔
`.agents/spec-docs/backlog/` per `spec-workflow.md` § Spec-Document Status and Lifecycle Folders.

- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS.
  The recorded instruction is "승인함" — the catalogue's own listed DIRECT form ("승인"), an
  unconditioned approval verb, not an answer to a clarifying question ("ㅇㅇ"/"응"), not silence. The
  standing entry carries the `**Review fingerprint:**` field, which only `gate.mjs approve` writes
  (`gate-operations.mjs` § REVIEW UNCHANGED SINCE APPROVAL, `reviewFingerprint`), so the route,
  instruction and date are a tool-written record rather than prose composed after the fact. That it
  was directed at THIS document was tested three ways rather than taken: (a) the design summary put
  to the owner immediately before the reply is a faithful abstract of this document — measured
  symptom (PR #2803 shows four checks, none a repository gate, at `mergeStateStatus: CLEAN`) = §
  Problem; the two changes (widen the base filters of `ci.yml`, `gitleaks.yml`,
  `dependency-review.yml`, `workflow-provenance-gate.yml`; make `merge-gate.sh` distinguish "checks
  passed" from "there were no checks") = § Solution items 1–2 and § Affected Files; the four
  deliberate exclusions with reasons (`codeql.yml`, `review-gate.yml`, `scans-full.yml`,
  `security-scheduled.yml`) = § Decision; and both flagged trade-offs (CI minutes against the shared
  concurrency budget = alternative 1's con; the GitHub-ruleset half being outside the agent's
  authority = § Decision "The half this change cannot deliver") — no summary element is absent from
  the document and no § Decision element is absent from the summary; (b) no competing item was in
  flight — the worktree's entire untracked set is this spec and its paired Task
  (`.agents/tasks/INFRA-2804-…md`), and the branch is `ci/gate-coverage-for-integration-bases`, so
  "approval of a different item in the same conversation" has no candidate; (c) the review approved
  is still the review in front of this guardian — recomputed `reviewFingerprint` over the current
  document returns `94ba113cf82b (review acd5ee8b, type/tags 06ee2339)`, identical to the recorded
  value. Boundary of what was verifiable, stated rather than glossed: the conversation transcript is
  not readable from here, so "the user said it" rests on the mechanical criterion `gate.mjs` already
  judged from the `approve` invocation; what this guardian judged is the content and direction of
  the recorded instruction, and nothing in the tree contradicts it. Not a relay: the instruction was
  given in, and recorded by `approve` during, this document's own pipeline conversation — not
  reported from another session or document.
- GATE-APPROVAL — The item is inside the class as the registry defines it: **N/A — Route CLASS is
  not the route taken.** The standing entry records its approval-route field as `DIRECT` and carries no
  `**Class:**` field, so no delegated class is claimed and there is no registry boundary for this
  guardian to evaluate the item against; the criterion has no subject. Checked that the N/A is not
  covering an available shortcut: the registry (`backlog-execution.md` § Delegated Approval Classes)
  holds exactly two rows, `LANE-L0-L1` and `BACKLOG-ZERO-MIGRATION`, both registered 2026-08-28.
  This document declares `lane: L2` in frontmatter, outside `LANE-L0-L1`'s scope; and its Affected
  Files are CI workflows plus a git hook, which that section's "Never inside any class" list
  excludes from every row however worded (item 3: "Repository-wide policy files — lint
  configuration, CI workflows, git hooks, workspace topology"). DIRECT was therefore the only
  available route, and it is the route taken. This is the semantic member of the same CLASS set
  `gate.mjs` recorded as not-applicable on its three mechanical members.
- GATE-APPROVAL — Independent architecture validation (conditional): **N/A — the conditional does
  not arm.** Arming condition per `spec-workflow.md` § New-Surface Architecture Placement: the
  change introduces a new package, app, or presentation/interface surface, or reclassifies a
  layer / product-family boundary. Determined against the tree, not from the document's own claim:
  all five paths in § Affected Files exist at HEAD `40d72b9b4943` —
  `.github/workflows/{ci,gitleaks,dependency-review,workflow-provenance-gate}.yml` and
  `.claude/hooks/merge-gate.sh` — so every touched artifact is pre-existing; `git diff --stat
  origin/develop -- packages apps scripts .github .claude/hooks/merge-gate.sh` is empty, so no new
  module has been created either; and § Solution confines the work to adding `integration/**` to a
  `branches:` list in four existing triggers plus a check-count assertion in one existing hook, with
  "No package source changes. No job bodies change." No new surface, no layer or product-family
  reclassification. No `proposal-reviewer` endorsement or `architecture-audit-fanout`
  structure-channel result is therefore required, and none is present in this log — the absence is
  correct, not overlooked. Consistent with the GATE-WRITE PASS entry, which judged the paired
  new-surface criterion N/A on these same facts.

**NON-COMPLIANCE trigger checked (implementation started before this gate ran):** not tripped. The
branch carries zero commits beyond its base (`git log --oneline origin/develop..HEAD` = 0; HEAD =
`origin/develop` = `40d72b9b4943`); `git status --porcelain` shows only the untracked spec/Task pair
plus two auto-generated `.agents/evals/lessons/` files, none of them a path in § Affected Files; and
the work itself has demonstrably not happened — no file in `.github/workflows/` contains the token
`integration/`, and `.claude/hooks/merge-gate.sh` still reads `if [[ "$STATE" != "CLEAN" ]]` at line
183 with no zero-check refusal.

**Judged by:** `backlog-gate-guard` — semantic criteria only (mechanical set judged by `gate.mjs`: 6 PASS, 0 FAIL)
**Judged at:** HEAD `40d72b9b4943` · base `origin/develop@40d72b9b4943` · document `.agents/spec-docs/backlog/INFRA-2804-gate-coverage-for-integration-bases.md` blob `9c54991c8208` (untracked)

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-21

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names 0/9 TC ids and carries 7 checkbox task(s)
  **Required action:** one task per TC-N
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task Test Plan/Testing section is 0 chars (absent)
  **Required action:** write a ≥50-char test plan in the Task

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `40d72b9b4943` · base `origin/develop@40d72b9b4943` · document `.agents/spec-docs/todo/INFRA-2804-gate-workflows-do-not-cover-integration-bases-so-stacked-child-prs-receive-no-ci.md` blob `f69a478856c3` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-21

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-21; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-2804-gate-workflows-do-not-cover-integration-bases-so-stacked-child-prs-receive-no-ci.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-2804-gate-workflows-do-not-cover-integration-bases-so-stacked-child-prs-receive-no-ci.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (9)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 1934 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/INFRA-2804-gate-workflows-do-not-cover-integration-bases-so-stacked-child-prs-receive-no-ci.md",
  "specPath": ".agents/spec-docs/todo/INFRA-2804-gate-workflows-do-not-cover-integration-bases-so-stacked-child-prs-receive-no-ci.md",
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
      "value": "TC-09"
    },
    {
      "kind": "tc-id",
      "value": "TC-08"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/INFRA-2804-gate-workflows-do-not-cover-integration-bases-so-stacked-child-prs-receive-no-ci.md",
    ".agents/tasks/INFRA-2804-gate-workflows-do-not-cover-integration-bases-so-stacked-child-prs-receive-no-ci.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `40d72b9b4943` · base `origin/develop@40d72b9b4943` · document `.agents/spec-docs/todo/INFRA-2804-gate-workflows-do-not-cover-integration-bases-so-stacked-child-prs-receive-no-ci.md` blob `004808853731` (untracked)
