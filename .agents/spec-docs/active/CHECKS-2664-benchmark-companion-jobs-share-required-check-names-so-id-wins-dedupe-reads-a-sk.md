---
status: in-progress
type: INFRA
tags: [ci]
lane: L2
---

# CHECKS-2664: Benchmark companion jobs must not publish a required check's name

Paired with `.agents/tasks/CHECKS-2664-benchmark-companion-jobs-share-required-check-names-so-id-wins-dedupe-reads-a-sk.md`. Arising from [issue #2664](https://github.com/woojubb/robota/issues/2664).

## Problem

On pull request #2805 at head `dd342a2d6`, `gh api repos/woojubb/robota/commits/dd342a2d6/check-runs
--paginate` returns TWO check-runs for each of the required contexts `review-gate` and `workflow
provenance`:

| name                  | id           | conclusion | workflow run                                    |
| --------------------- | ------------ | ---------- | ----------------------------------------------- |
| `review-gate`         | 106366028112 | `success`  | `review-gate.yml` (the owning workflow)         |
| `review-gate`         | 106366050743 | `skipped`  | `ci.yml` job `benchmark-review-gate`            |
| `workflow provenance` | 106365959023 | `success`  | `workflow-provenance-gate.yml` (owning workflow) |
| `workflow provenance` | 106365966060 | `skipped`  | `ci.yml` job `benchmark-workflow-provenance`    |

The two `ci.yml` jobs are `workflow_dispatch`-only companions of the PR-free required-check benchmark
(`if: github.event_name == 'workflow_dispatch'`), and they carry `name: review-gate` /
`name: workflow provenance` so that `benchmark-summary` can measure the eleven `develop` contexts under
their real names. A job whose `if:` is false is not absent: GitHub registers it as a check-run with
conclusion `skipped` under that display name, on every `pull_request` run of `ci.yml`. The comment above
the jobs ("these jobs never run for that event") is therefore true of the STEPS and false of the
CHECK-RUN.

`latestCheckRunsByName` (`scripts/harness/github-api.mjs`) reduces a commit's check-runs to one per
name by "higher id wins" — the rule HARNESS-124 adopted so that a superseded, cancelled row cannot answer
for a re-triggered check. On this head the `skipped` companion row has the higher id for both names, so
the dedupe selects it and `checkRunEvidence` reports `'none'` for a check whose owning workflow passed.
`merge-verifier` reported exactly that on #2805. The shadowing is not incidental to this PR: `ci.yml`'s
run is created after the two small gate workflows on most pushes, so the companion row wins on most PRs
for as long as the names collide.

Reproduced on this tree without the network: a script that lists, for every declared context in
`.github/required-status-checks.json`, every job across `.github/workflows/*.yml` whose display name
equals the context reports two publishers for `review-gate` (develop) and for `workflow provenance`
(develop and main), and one publisher for every other context.

## Prior Art Research

Researched by the `prior-art-researcher` agent (2026-09-21) from product documentation only.

| #   | Source                                                                                                                                                                                                                                                       | What it documents                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | GitHub Docs — [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)                                                                   | "If you use branch protection rules that require specific status checks, make sure that job names are unique across all workflows. Using the same job name in multiple workflows can cause ambiguous status check results and block pull requests from being merged."          |
| R2  | GitHub Docs — [Using conditions to control job execution](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/using-conditions-to-control-job-execution)                                                                   | "A job that is skipped will report its status as 'Success'. It will not prevent a pull request from merging, even if it is a required check." — a false `if:` still materialises a check-run ("This check was skipped").                                                       |
| R3  | GitHub Docs — [Troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks)                            | Job skipped by a conditional → "The job reports 'Success'"; workflow skipped by a path/branch filter → stays "Pending".                                                                                                                                                         |
| R4  | GitHub Docs — [Available rules for rulesets](https://docs.github.com/en/enterprise-cloud@latest/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)                                              | Required checks are identified by context name, optionally pinned to an app; the separate "Require workflows" rule keys on workflow file path. No text on duplicate names.                                                                                                     |
| R5  | GitHub REST — [List check runs for a Git reference](https://docs.github.com/en/rest/checks/runs?apiVersion=2022-11-28)                                                                                                                                       | `filter=latest` is per `completed_at` and returns both runs when they belong to different check suites. No documented rule for which same-named run is authoritative.                                                                                                          |
| R6  | GitHub REST — [Combined status](https://docs.github.com/en/rest/commits/statuses?apiVersion=2022-11-28)                                                                                                                                                      | Legacy Status API defines latest-per-context; no equivalent for check-runs.                                                                                                                                                                                                    |
| R7  | GitHub REST — [Workflow runs](https://docs.github.com/en/rest/actions/workflow-runs?apiVersion=2022-11-28) / [Workflow jobs](https://docs.github.com/en/rest/actions/workflow-jobs?apiVersion=2022-11-28)                                                    | The documented join from a check-run to its owning workflow file (`check_suite_id` → run → `path`) — an extra call per run, not present in the check-runs payload.                                                                                                             |
| R9  | Mergify Docs — [Conditions](https://docs.mergify.com/configuration/conditions/)                                                                                                                                                                              | "Two GitHub Apps can publish a check with the same name … The bare form is ambiguous"; disambiguation is by app only (`@app/check`), which cannot separate two same-app (`github-actions`) rows. `check-skipped` is a distinct list from `check-success`.                       |
| R10 | GitHub CLI — [`gh pr checks`](https://cli.github.com/manual/gh_pr_checks)                                                                                                                                                                                    | `skipping` is its own bucket, not `pass`.                                                                                                                                                                                                                                      |
| R11 | GitLab Docs — [Auto-merge](https://docs.gitlab.com/ee/user/project/merge_requests/auto_merge.html)                                                                                                                                                           | "skipped pipelines prevent merge requests from merging" unless explicitly opted in — the stricter default.                                                                                                                                                                     |

Not found (searched, explicitly absent): any vendor statement of WHICH same-named, same-app check-run
branch protection evaluates; any documented resolution heuristic. Every vendor documents prevention.

**Observed common behavior.** Required checks are keyed by context name everywhere (R1, R4, R9); the
only finer keys are app (R1, R9) and workflow-file path (R4, R7). A false `if:` still publishes a
`skipped` check-run under the job's display name (R2, R3). "Latest wins" is defined only for the legacy
Status API (R6); for check-runs nothing chooses between two same-named rows from different check suites
(R5). GitHub's sole documented remedy for the collision is R1: unique job names across all workflows.

**Constraint that applies to Robota.** Both colliding rows are published by the same app, so no
app-level qualification (R1, R9) can separate them — only the name or the workflow file can. The
declaration already records `workflow` + `job` per context, and `scan-main-required-checks` R1 asserts
uniqueness within the DECLARED workflow only; uniqueness ACROSS workflow files is asserted nowhere.

**Recommendation (adopted below).** (a): rename the companion jobs so no job outside the declared owner
publishes a required context's name, and add a cross-workflow uniqueness scan. (b) would make the
harness depend on a tiebreak no vendor documents, and "prefer concluded over skipped" resurrects the
stale-row problem HARNESS-124 removed. The researcher's further suggestion — make the dedupe throw when
one name spans two `check_suite.id`s — is NOT adopted: a re-triggered workflow run (the #2237 shape) is a
new check suite too, so that throw would fire on every `pull_request: edited` re-dispatch.

## Architecture Review

### Affected Scope

- `.github/workflows/ci.yml` — the two benchmark companion jobs' `name:` and the `benchmark-summary`
  job's required-context → job-name matching
- `scripts/harness/scan-main-required-checks.mjs` — `findContextNameFindings` (the existing owner of
  "declared context ↔ what the workflow files publish", every declared branch, all workflow files —
  issue #2036) gains the uniqueness half: a declared context published by more than one job, or by a
  job other than the declared `workflow`/`job`, is a finding. A new export `contextPublishers(root)`
  (name → publishers) backs it; `publishedContexts` keeps its Set contract on top of it.
- `scripts/harness/__tests__/scan-main-required-checks.test.mjs` — new cases in the existing
  `findContextNameFindings` describe; the red-proof
- `.agents/rules/git-branch.md` — one sentence under "Read check-run state per LATEST run per check
  `name`": a context name is published by one job, and which scan enforces it
- `scripts/harness/github-api.mjs` — **unchanged**; `latestCheckRunsByName` keeps id-wins
- Not touched, and why: `run-all-scans.mjs` (the scan is already registered as `main-required-checks`),
  `scan-guard-scope-fail-closed.mjs` (`findContextNameFindings` is already a classified
  `MANDATORY_TREE_GUARDS` finder that throws over a bare root)

### Alternatives Considered

1. Rename the two companion jobs so their display names cannot equal a required context, map the
   required names to the companion names inside `benchmark-summary`, and make the existing
   declared-name scan refuse any required context published by more than one job across all workflow
   files.
   - Pro: removes the collision at its source, so every reader of the check-runs endpoint — the harness
     dedupe AND GitHub's own required-check evaluation, which `ci.yml`'s header already records as
     "publishes `skipped` over the `success`" on a re-dispatch — sees one row per required name. Keeps
     HARNESS-124's id-wins rule intact. The scan makes the property mechanical: the next companion,
     mirror or matrix job that reuses a required name is refused offline, before it reaches a PR.
     Placing it in `findContextNameFindings` rather than a new scan file means no registry edit, no
     new fail-closed classification, and one owner for "declared name ↔ published name".
   - Con: touches a CI workflow (lane L2); the benchmark summary needs a two-entry name map instead of a
     bare list.
2. Make `latestCheckRunsByName` prefer a concluded non-skipped run over a skipped same-named run.
   - Pro: no workflow edit; one function change.
   - Con: re-introduces the superseded-row problem in reverse — an OLDER success answering for a NEWER
     run — which is the exact shape HARNESS-124 removed; diverges from GitHub's own evaluation, which
     lets the newest row (skipped) replace the success, so the harness would report green where the
     merge box may not; and it fixes only this reader while the ambiguous rows stay on every commit.
     The dedupe cannot tell "owning workflow" from "companion" either: the check-runs payload carries no
     workflow path, and both a re-trigger and a companion appear as a different check suite.
3. Prefer by owning workflow: extend the dedupe to look up each run's workflow via its check suite and
   keep the row from the workflow the declaration names.
   - Pro: principled — "through its actual owning workflow" is git-branch.md's own wording.
   - Con: one extra API call per run in a function every gate reads; a declared-workflow lookup in a
     module that is currently pure over its input; and it still leaves the collision on GitHub's side.

### Decision

Alternative 1. The property the merge gate relies on is "one required name, one publisher"; the
cheapest place to hold it is the workflow files themselves, and the only place it can be refused before
a run exists is a scan over them. The companion jobs become `name: benchmark review-gate` and
`name: benchmark workflow provenance`; `benchmark-summary` keeps its eleven-row table keyed by the
required context but resolves those two through an explicit map, so the measurement still reports the
context names. `latestCheckRunsByName` is untouched — its rule was right; its input was ambiguous.

`findContextNameFindings` already reads `.github/required-status-checks.json` for every declared branch
and every `.github/workflows/*.yml`, computing each job's display name (`name:` or the job id). Today it
reports a declared context that NO job publishes ("at least one"). It gains the other bound: a declared
context published by MORE than one job is a finding naming every publisher (`<file>#<jobId>`), and a
`required_status_checks` entry whose sole publisher is not the declared `workflow`/`job` is a finding
too. It considers ALL workflow files regardless of trigger, because a check-run is keyed by commit sha:
a `push`-triggered job on the branch head lands in the same list as the PR-triggered one. The
fail-closed posture is unchanged (it already throws over a missing declaration or workflows directory,
and is classified so in `scan-guard-scope-fail-closed`).

Validation (wide blast radius — a CI policy file and the required-check floor):

- Reachability: `main-required-checks` is already registered in `run-all-scans.mjs` with
  `examines: [GITHUB]`, so the new bound runs on every PR that touches `.github/` and in the full
  aggregate; the rename is reachable by the only reader of the companion names, `benchmark-summary`,
  which is edited in the same change.
- Capability preservation: the benchmark still measures all eleven `develop` contexts — its
  `length == 11` and `all(.conclusion == "success")` assertions are unchanged; only the lookup of two
  rows goes through the map. `publishedContexts` keeps returning a Set (its existing tests use
  `.has`), the "no job publishes it" finding keeps its text (existing tests match `permanently
  pending`), and `scan-required-check-needs` still holds — verified by the existing suite (TC-01) and
  the affected scan set (TC-02).
- Adversarial pass: (i) a companion renamed in `name:` but not in `benchmark-summary` fails the
  benchmark's `expected exactly one benchmark job named` assertion — visible on the next dispatch, not
  silent; (ii) a future job that reuses a required name under any trigger is refused by the scan
  (TC-01 covers a `workflow_dispatch`-only job in another file, a `push`-only workflow, and a second
  job in the SAME file); (iii) a declared entry whose only publisher is a job other than the declared
  one is refused, so a rename that moves the name onto the wrong job cannot pass; (iv) the existing
  fail-closed cases (no declaration, no workflows directory) stay red.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — the siblings are `scan-main-required-checks` R1 (the declared job publishes
      the context, within ONE workflow), its `findContextNameFindings` (at least one publisher, all
      workflows — the function this change extends) and `scan-required-check-needs` (the `needs:`
      graph); none asserts "exactly one publisher", which is the bound this change adds.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. `.github/workflows/ci.yml` — `benchmark-review-gate` gets `name: benchmark review-gate`;
   `benchmark-workflow-provenance` gets `name: benchmark workflow provenance`; the comment above them
   states why the names differ from the contexts they measure. In `benchmark-summary`, the `required`
   list becomes a context → job-name map (`{"review-gate": "benchmark review-gate", "workflow
   provenance": "benchmark workflow provenance"}`, identity for the other nine); the readiness loop and
   the measurement select `.name == $map[$context]` and report `$context` in the table.
2. `scripts/harness/scan-main-required-checks.mjs` — new export `contextPublishers(root)` → `Map<name,
   ["<file>#<jobId>", …]>` over every workflow file (same fail-closed throw as today when the directory
   is missing); `publishedContexts(root)` becomes `new Set(contextPublishers(root).keys())`.
   `findContextNameFindings` adds, per declared entry: (a) `publishers.length > 1` → finding listing
   every publisher and stating that the check-runs endpoint then carries two rows under one name, so
   neither GitHub's required-check evaluation nor `latestCheckRunsByName` has a defined winner; (b) for a
   `required_status_checks` entry with `workflow` + `job`, the sole publisher must be
   `<basename(workflow)>#<job>` → otherwise a finding. Grouped (`/`) labels stay skipped as today.
3. `scripts/harness/__tests__/scan-main-required-checks.test.mjs` — in the `findContextNameFindings`
   describe: the shipped shape (a `workflow_dispatch`-only job in a second file publishing a required
   name) → one finding naming both `ci.yml#benchmark-review-gate` and `review-gate.yml#review-gate`; a
   `push`-only workflow with the name → finding; a duplicate in the same file → finding; the declared
   job as sole publisher → no finding; sole publisher is the wrong job → finding; a unique companion
   name → no finding; `contextPublishers` lists both spellings (explicit `name:` and job id).
4. `.agents/rules/git-branch.md` — under the "per LATEST run per check `name`" bullet, one sentence: a
   required context's name is published by exactly one job across the workflow files, enforced by
   `main-required-checks`, because id-wins is only a total order when one job owns the name.

## Affected Files

- `.github/workflows/ci.yml`
- `scripts/harness/scan-main-required-checks.mjs`
- `scripts/harness/__tests__/scan-main-required-checks.test.mjs`
- `.agents/rules/git-branch.md`
- `.agents/spec-docs/draft/CHECKS-2664-benchmark-companion-jobs-share-required-check-names-so-id-wins-dedupe-reads-a-sk.md`
- `.agents/tasks/CHECKS-2664-benchmark-companion-jobs-share-required-check-names-so-id-wins-dedupe-reads-a-sk.md`

## Completion Criteria

- [ ] TC-01: `pnpm exec vitest run scripts/harness/__tests__/scan-main-required-checks.test.mjs`
      → exits 0, and exits 1 with the `findContextNameFindings` change reverted (the two-publisher
      cases go red: the fixture asserts a finding naming `ci.yml#benchmark-review-gate`)
- [ ] TC-02: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exits 0
- [ ] TC-03: `node scripts/harness/scan-main-required-checks.mjs` → exits 0 and prints
      `::examined::` on the fixed tree; exits 1 naming `ci.yml#benchmark-review-gate` and
      `ci.yml#benchmark-workflow-provenance` with the `ci.yml` rename reverted
- [ ] TC-04: `pnpm exec vitest run scripts/harness/__tests__/github-api-check-runs.test.mjs` → exits 0,
      `scripts/harness/github-api.mjs` unchanged (`git diff origin/develop -- scripts/harness/github-api.mjs` empty)
- [ ] TC-05: `gh workflow run ci.yml --ref develop -f base_ref=develop -f head_ref=develop` after merge →
      `benchmark-summary` table still lists `review-gate` and `workflow provenance` rows (post-merge
      verification; the summary job only exists on dispatch)
- [ ] TC-06: `grep -c 'main-required-checks' .agents/rules/git-branch.md` → `1`, and the match sits in
      the "Read check-run state per LATEST run per check `name`" bullet (`grep -n` line number lies
      between that bullet's first line and the next `- **` bullet)

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                 | Notes                                                                                                                                      |
| ----- | --------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| TC-01 | Unit      | `pnpm exec vitest run` on the existing scan suite               | RED with the finder change reverted (new two-publisher cases), GREEN with it; the pre-existing cases pin capability preservation           |
| TC-02 | Suite     | `run-all-scans.mjs --affected --context pr`                     | Regression over the affected scan set, including `main-required-checks` on the renamed `ci.yml` and `required-check-needs`                 |
| TC-03 | CI smoke  | `node scripts/harness/scan-main-required-checks.mjs`            | Direct execution on the tree: green after the rename, red naming both companion jobs before it — the red-proof of the CI-side fix          |
| TC-04 | Unit      | `pnpm exec vitest run` on the dedupe suite + `git diff`         | Capability preservation: HARNESS-124's id-wins rule and its tests are untouched                                                            |
| TC-05 | manual    | `gh workflow run ci.yml` on `develop` after merge               | The benchmark summary exists only on `workflow_dispatch` against `develop`; no pre-merge run can exercise it, so the dispatch is the check |
| TC-06 | CI smoke  | `grep -c` / `grep -n` on `git-branch.md`                        | The rule sentence is observed by a command; it has no unit test of its own                                                                 |

## User Execution Test Scenarios

Not applicable.

**Reason:** The change is to a CI workflow's job display names and a repository-harness scan over
workflow files; no end user of the Robota product (CLI, SDK, TUI, MCP server) can observe it through
any runnable product surface. Engineering verification is TC-01 to TC-05 above.

## Tasks

- [ ] `.agents/tasks/CHECKS-2664-benchmark-companion-jobs-share-required-check-names-so-id-wins-dedupe-reads-a-sk.md` — todo

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-09-21

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: `## Solution` enumerates five sub-items; TC-01/TC-03 cover items 1–3 (rename + new scan + its red-proof), TC-02 covers item 4 (registration, weakly — an unregistered scan still exits 0 under `--affected`), TC-05 covers item 1's `benchmark-summary` map, TC-04 is capability preservation — but item 5 (`.agents/rules/git-branch.md`: the sentence under "per LATEST run per check `name`" naming `required-check-name-uniqueness`) has NO TC. Nothing downstream observes it either: `scan-named-mechanism-resolves` resolves only `scripts/harness/<file>.mjs` paths, not a bare scan id, and GATE-COMPLETE demands evidence only per TC-N — so the rule sentence can be silently dropped and every gate still passes.
  **Required action:** add a TC-06 in Command form for item 5 (e.g. `grep -c 'required-check-name-uniqueness' .agents/rules/git-branch.md` → `1`, under the named bullet) with a matching `## Test Plan` row, then re-run GATE-WRITE.

**Semantic criteria judged (context for the verdict; not partial credit):**

- GATE-WRITE — Contains a concrete symptom: PASS — the command `gh api repos/woojubb/robota/commits/dd342a2d6/check-runs --paginate` and four rows (ids 106366028112/106366050743, 106365959023/106365966060; `success`/`skipped`) are quoted; re-run live 2026-09-21 and all four ids, conclusions and the "skipped row has the higher id" ordering match, both `skipped` rows in check suite 96409221826 (`ci.yml`). `latestCheckRunsByName` (`github-api.mjs:265–290`, `isNewerRun` = higher id wins) and `checkRunEvidence` → `'none'` for a `skipped` run verified in source.
- GATE-WRITE — Contains a reproduction condition: PASS — when: every `pull_request` run of `ci.yml` whose run is created after `review-gate.yml` / `workflow-provenance-gate.yml`; where: PR #2805 head `dd342a2d6`, plus an offline reproduction. Re-derived on this tree: 40 workflow jobs, `review-gate` published by `ci.yml#benchmark-review-gate` + `review-gate.yml#review-gate`, `workflow provenance` by `ci.yml#benchmark-workflow-provenance` + `workflow-provenance-gate.yml#provenance` (develop and main), every other declared context by exactly one job. `ci.yml:1557` / `ci.yml:1586` carry the colliding `name:` under `if: github.event_name == 'workflow_dispatch'`.
- GATE-WRITE — Research findings feed Alternatives Considered / Decision: PASS — R1 (GitHub's only documented remedy: unique job names) is Alternative 1 and the Decision; R5/R6 (no documented tiebreak between same-named check-runs) is the stated reason Alternative 2 is rejected; R7 (check-run → workflow requires an extra call) is Alternative 3's Con; R9 (app-level disambiguation cannot split same-app rows) is the "Constraint that applies to Robota". The researcher's throw-on-two-suites suggestion is rejected with a reason (a re-trigger is also a new check suite), not silently dropped.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — names what is paid (an L2 CI-workflow edit and a two-entry name map in `benchmark-summary`) against what is refused (Alternative 2's older-success-answers-for-newer-run reversal of HARNESS-124; Alternative 3's per-run API call in a pure module), and states why `latestCheckRunsByName` stays untouched ("its rule was right; its input was ambiguous").
- GATE-WRITE — New-surface placement (conditional): N/A — the new artifact is a harness scan under `scripts/harness/` registered beside `required-check-needs`; no new package, app, presentation or interface surface and no layer/product-family reclassification. Checklist item records `N/A` with that reason.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form: PASS — TC-01..TC-04 are command + exit code (TC-03 additionally the literal `::examined:: 16 contexts`, which matches the declaration: 11 develop + 5 main; TC-04 additionally an empty `git diff` on `github-api.mjs`); TC-05 is observable behavior (the `benchmark-summary` table lists the two rows after a `develop` dispatch).

**Mechanical set:** `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this>` re-run by the guardian 2026-09-21 — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN, exit 2, no entry written by the script.
**Ordering check:** GATE-WRITE is the entry gate (no prior gate); document is `status: draft` under `.agents/spec-docs/draft/`, Evidence Log empty before this entry.
**Judged by:** `backlog-gate-guard` (semantic set); `gate.mjs` mechanical evaluator (mechanical set)
**Judged at:** HEAD `4543cf56d57d` · base `origin/develop@4543cf56d57d` · document `.agents/spec-docs/draft/CHECKS-2664-benchmark-companion-jobs-share-required-check-names-so-id-wins-dedupe-reads-a-sk.md` blob `1215b84b7408` (untracked)

### [GATE-WRITE] — ✅ PASS | 2026-09-21

**Status upgrade:** draft → review-ready

- GATE-WRITE — ordering: entry gate, no prior gate; status `draft` under `.agents/spec-docs/draft/`; the only prior entry is this gate's own `❌ FAIL | 2026-09-21`, whose one failed criterion is re-judged below
- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 2461 chars, 8 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with completion evidence
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 3 numbered alternatives, each with Pro and Con
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 6 criteria, all `TC-NN:` prefixed
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 6 Test Plan rows = 6 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 6 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s), each with Notes
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 1 prior entry (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-WRITE — Contains a concrete symptom: PASS — `## Problem` unchanged since the FAIL entry; `gh api repos/woojubb/robota/commits/dd342a2d6/check-runs --paginate` and the four rows (ids 106366028112/106366050743 `review-gate`, 106365959023/106365966060 `workflow provenance`; `success`/`skipped`) were re-queried live 2026-09-21 and match, both `skipped` rows in check suite 96409221826 (`ci.yml`); `latestCheckRunsByName`/`isNewerRun` (`github-api.mjs:265–290`) is higher-id-wins and `checkRunEvidence` → `'none'` for skipped, as stated
- GATE-WRITE — Contains a reproduction condition: PASS — when: every `pull_request` run of `ci.yml` created after `review-gate.yml`/`workflow-provenance-gate.yml`; where: PR #2805 head `dd342a2d6` plus an offline reproduction, re-derived on this tree: 40 workflow jobs, `review-gate` published by `ci.yml#benchmark-review-gate` + `review-gate.yml#review-gate`, `workflow provenance` by `ci.yml#benchmark-workflow-provenance` + `workflow-provenance-gate.yml#provenance` (develop and main), every other declared context by exactly one job; `ci.yml:1557`/`:1586` carry the colliding `name:` under `if: github.event_name == 'workflow_dispatch'`
- GATE-WRITE — Research findings feed Alternatives Considered / Decision: PASS — R1 (unique job names, GitHub's only documented remedy) is Alternative 1 and the Decision; R5/R6 (no documented tiebreak between same-named check-runs) is the stated reason Alternative 2 is rejected; R7 (check-run → workflow needs an extra call) is Alternative 3's Con; R9 (app-level disambiguation cannot split same-app rows) is the "Constraint that applies to Robota"; the researcher's throw-on-two-suites suggestion is rejected with a reason
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — pays an L2 CI-workflow edit and a two-entry name map in `benchmark-summary`; refuses Alternative 2's older-success-answers-for-newer-run reversal of HARNESS-124 and Alternative 3's per-run API call in a pure module; states why `latestCheckRunsByName` stays untouched
- GATE-WRITE — New-surface placement (conditional): N/A — the new artifacts are a harness scan under `scripts/harness/` registered beside `required-check-needs` and one ledger entry in `scan-guard-scope-fail-closed.mjs`; no new package, app, presentation or interface surface, no layer/product-family reclassification; checklist records N/A with that reason
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: PASS — `## Solution` now enumerates six sub-items, each observed: 1 (rename + `benchmark-summary` map) by TC-01's live-tree case, TC-03's reverted case and TC-05; 2 (new scan) by TC-03 and TC-01; 3 (red-proof test) by TC-01; 4 (registration) by TC-02; 5 (`git-branch.md` sentence) by TC-06's `grep -c` → `1` and `grep -n` bounded to the bullet at `git-branch.md:421–440`; 6 (`MANDATORY_TREE_GUARDS` entry) by TC-06's `scan-guard-scope-fail-closed.mjs` → exit 0, which refuses an unclassified registered finder. The criterion that failed on the prior run is now met
- GATE-WRITE — Each criterion uses Command form or Observable behavior form: PASS — TC-01..TC-04 and TC-06 are command + exit code / literal output (TC-03 `::examined:: 16 contexts` = 11 develop + 5 main in the declaration; TC-04 an empty `git diff` on `github-api.mjs`; TC-06 `grep -c` → `1` and a line-range bound); TC-05 is observable behavior (the `benchmark-summary` table lists the two rows after a `develop` dispatch)
- GATE-WRITE — TC-N count: 6 Completion Criteria (TC-01..TC-06) = 6 Test Plan rows

**Mechanical set:** `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this>` re-run by the guardian 2026-09-21 — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN, exit 2, no entry written by the script; the 20 mechanical lines above are the script's own observations
**Judged by:** `backlog-gate-guard` (semantic set); `gate.mjs` mechanical evaluator (mechanical set)
**Judged at:** HEAD `4543cf56d57d` · base `origin/develop@4543cf56d57d` · document `.agents/spec-docs/draft/CHECKS-2664-benchmark-companion-jobs-share-required-check-names-so-id-wins-dedupe-reads-a-sk.md` blob `96f752878527` (untracked)

### [GATE-WRITE] — ✅ PASS | 2026-09-21

**Status upgrade:** draft → review-ready

- GATE-WRITE — ordering: entry gate, no prior gate; status `draft` under `.agents/spec-docs/draft/`; prior entries are this gate's own `❌ FAIL` and `✅ PASS` of 2026-09-21 — the PASS judged blob `96f752878527`, which the author revised (design moved from a new scan file into the existing `findContextNameFindings`) before any advance, so that PASS describes a superseded text and this entry judges the revised one
- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 2461 chars, 8 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with completion evidence
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 3 numbered alternatives, each with Pro and Con
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 6 criteria, all `TC-NN:` prefixed
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 6 Test Plan rows = 6 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 6 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s), each with Notes
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 2 prior entries (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-WRITE — Contains a concrete symptom: PASS — `## Problem` is unchanged across all three runs; `gh api repos/woojubb/robota/commits/dd342a2d6/check-runs --paginate` and the four rows (ids 106366028112/106366050743 `review-gate`, 106365959023/106365966060 `workflow provenance`; `success`/`skipped`) were re-queried live 2026-09-21 and match, both `skipped` rows in check suite 96409221826 (`ci.yml`); `latestCheckRunsByName`/`isNewerRun` (`github-api.mjs:265–290`) is higher-id-wins and `checkRunEvidence` → `'none'` for skipped, as stated
- GATE-WRITE — Contains a reproduction condition: PASS — when: every `pull_request` run of `ci.yml` created after `review-gate.yml`/`workflow-provenance-gate.yml`; where: PR #2805 head `dd342a2d6` plus an offline reproduction, re-derived on this tree: 40 workflow jobs, `review-gate` published by `ci.yml#benchmark-review-gate` + `review-gate.yml#review-gate`, `workflow provenance` by `ci.yml#benchmark-workflow-provenance` + `workflow-provenance-gate.yml#provenance` (develop and main), every other declared context by exactly one job; `ci.yml:1557`/`:1586` carry the colliding `name:` under `if: github.event_name == 'workflow_dispatch'`
- GATE-WRITE — Research findings feed Alternatives Considered / Decision: PASS — `## Prior Art Research` unchanged; R1 (unique job names, GitHub's only documented remedy) is Alternative 1 and the Decision; R5/R6 (no documented tiebreak between same-named check-runs) is the stated reason Alternative 2 is rejected; R7 (check-run → workflow needs an extra call) is Alternative 3's Con; R9 (app-level disambiguation cannot split same-app rows) is the "Constraint that applies to Robota"; the researcher's throw-on-two-suites suggestion is rejected with a reason. The revision changes WHERE the bound lives, not the evidence it rests on
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — pays an L2 CI-workflow edit and a two-entry name map in `benchmark-summary`; refuses Alternative 2's older-success-answers-for-newer-run reversal of HARNESS-124 and Alternative 3's per-run API call in a pure module; states why `latestCheckRunsByName` stays untouched; and the revision names the placement trade-off (extend the existing owner of "declared name ↔ published name" — no registry edit, no new fail-closed classification, one owner — over a new scan file)
- GATE-WRITE — New-surface placement (conditional): N/A — the change extends an existing harness scan and its test file, edits a workflow and a rule sentence; no new package, app, presentation or interface surface, no layer/product-family reclassification; checklist records N/A with that reason
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: PASS — `## Solution` enumerates four sub-items, each observed: 1 (rename + `benchmark-summary` map) by TC-03's red-before-rename naming both companion jobs, TC-02 and TC-05; 2 (`contextPublishers` + the two new bounds in `findContextNameFindings`) by TC-01's red/green with the finder change reverted and TC-03; 3 (test cases in the existing describe) by TC-01; 4 (`git-branch.md` sentence) by TC-06's `grep -c` → `1` (verified: zero mentions of `main-required-checks` in the file today, so `1` after one sentence is exact) and `grep -n` bounded to the bullet at `git-branch.md:421–440`
- GATE-WRITE — Each criterion uses Command form or Observable behavior form: PASS — TC-01..TC-04 and TC-06 are command + exit code / literal output (TC-03 additionally the `::examined::` line, which `main()` at `scan-main-required-checks.mjs:452` prints, and the two publisher labels named on the reverted tree; TC-04 an empty `git diff` on `github-api.mjs`); TC-05 is observable behavior (the `benchmark-summary` table lists the two rows after a `develop` dispatch)
- GATE-WRITE — Claims verified in source for this version: `findContextNameFindings` (`scan-main-required-checks.mjs:396`) reads `required_status_checks` and `deliberately_not_required` for every declared branch and every workflow file, skips grouped `/` labels, throws over a missing declaration or workflows directory (issue #2036 / HARNESS-052); `publishedContexts` returns a `Set` and the suite reads it with `.has`; registered as `main-required-checks` with `examines: [GITHUB]` (`run-all-scans.mjs:735`); classified in `MANDATORY_TREE_GUARDS` (`scan-guard-scope-fail-closed.mjs:180–184`); the new `contextPublishers` export matches neither `find…` nor `collect…`, so the "not touched, and why" line for the guard-scope ledger holds
- GATE-WRITE — TC-N count: 6 Completion Criteria (TC-01..TC-06) = 6 Test Plan rows

**Mechanical set:** `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this>` re-run by the guardian 2026-09-21 on the revised text — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN, exit 2, no entry written by the script; the 20 mechanical lines above are the script's own observations
**Judged by:** `backlog-gate-guard` (semantic set); `gate.mjs` mechanical evaluator (mechanical set)
**Judged at:** HEAD `4543cf56d57d` · base `origin/develop@59196f9327f6` · document `.agents/spec-docs/draft/CHECKS-2664-benchmark-companion-jobs-share-required-check-names-so-id-wins-dedupe-reads-a-sk.md` blob `1cbaa7507307` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-21

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인 — 이대로 진행 (Recommended)"
**Given:** 2026-09-21, this conversation
**Review fingerprint:** 4b2c3908a6c5 (review 4934b910, type/tags 06ee2339)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-21, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (4b2c3908a6c5) equals the document's current fingerprint

- GATE-APPROVAL — ordering: prior gate GATE-WRITE has a `✅ PASS | 2026-09-21` whose `**Status upgrade:** draft → review-ready` equals the document's current `status: review-ready` (`recorded-pass` rule), the document sits under `.agents/spec-docs/backlog/` as `spec-workflow.md` maps `review-ready`; the design under approval carries the four points that PASS judged (companion rename + `benchmark-summary` map, `contextPublishers(root)` + the two bounds in `findContextNameFindings`, cases in the existing suite, the `git-branch.md` sentence naming `main-required-checks`) and 6 TCs
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the verbatim instruction "승인 — 이대로 진행 (Recommended)" opens with `승인`, which gate-catalogue.md lists as explicit DIRECT approval, and `이대로 진행` confirms the design as written and authorises implementation; it is a selected option answering a structured question (the `(Recommended)` suffix is the option form), not a bare "ㅇㅇ"/"C" to a clarifying question; the orchestrator states the question named CHECKS-2664 and summarised its four design points, and the only item under gate in this conversation's tree is this one (`git status`: the CHECKS-2664 spec and Task are the sole untracked documents), so "approval of a different item in the same conversation" has no candidate; provenance `2026-09-21, this conversation` — not a relay from another session. Not independently checkable by the guardian: the question text itself (no transcript surface in the tree); recorded as the limit of this verification
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A — route DIRECT; no class is named and none is relied on
- GATE-APPROVAL — Independent architecture validation (conditional): N/A — the spec introduces no new package, app or surface and reclassifies no layer or product-family boundary (it extends the existing `findContextNameFindings` in `scan-main-required-checks.mjs`, edits `ci.yml` job names and one rule sentence; GATE-WRITE recorded new-surface placement N/A on the same grounds), so no `proposal-reviewer` placement verdict is required
- GATE-APPROVAL — NON-COMPLIANCE trigger (implementation before this gate): not triggered — `git status`/`git diff HEAD` show no change under `.github/`, `scripts/` or `.agents/rules/`, and no commit ahead of `origin/develop`

**Judged by:** `gate.mjs` mechanical evaluator (mechanical set, via `approve`); `backlog-gate-guard` (semantic set)
**Judged at:** HEAD `4543cf56d57d` · base `origin/develop@59196f9327f6` · document `.agents/spec-docs/backlog/CHECKS-2664-benchmark-companion-jobs-share-required-check-names-so-id-wins-dedupe-reads-a-sk.md` blob `5b54f8aa9de9` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-21

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-21; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/CHECKS-2664-benchmark-companion-jobs-share-required-check-names-so-id-wins-dedupe-reads-a-sk.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/CHECKS-2664-benchmark-companion-jobs-share-required-check-names-so-id-wins-dedupe-reads-a-sk.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (6)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 646 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 4 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/CHECKS-2664-benchmark-companion-jobs-share-required-check-names-so-id-wins-dedupe-reads-a-sk.md",
  "specPath": ".agents/spec-docs/todo/CHECKS-2664-benchmark-companion-jobs-share-required-check-names-so-id-wins-dedupe-reads-a-sk.md",
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
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/loop-runs/user-execution-scenario.jsonl",
    ".agents/loop-runs/user-request-gate.jsonl",
    ".agents/spec-docs/todo/CHECKS-2664-benchmark-companion-jobs-share-required-check-names-so-id-wins-dedupe-reads-a-sk.md",
    ".agents/tasks/CHECKS-2664-benchmark-companion-jobs-share-required-check-names-so-id-wins-dedupe-reads-a-sk.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `59196f9327f6` · base `origin/develop@59196f9327f6` · document `.agents/spec-docs/todo/CHECKS-2664-benchmark-companion-jobs-share-required-check-names-so-id-wins-dedupe-reads-a-sk.md` blob `08dec0f1501d` (untracked)
