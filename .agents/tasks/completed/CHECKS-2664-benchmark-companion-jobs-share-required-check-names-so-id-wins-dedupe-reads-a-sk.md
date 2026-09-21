---
title: "CHECKS-2664: Benchmark companion jobs share required check names, so id-wins dedupe reads a skipped row over the owning workflow's pass"
issue: https://github.com/woojubb/robota/issues/2664
status: done
created: 2026-09-21
priority: medium
urgency: soon
area: harness/ci
depends_on: []
completed: 2026-09-22
---

# CHECKS-2664: Benchmark companion jobs share required check names, so id-wins dedupe reads a skipped row over the owning workflow's pass

Spec: `.agents/spec-docs/done/CHECKS-2664-benchmark-companion-jobs-share-required-check-names-so-id-wins-dedupe-reads-a-sk.md`

## Objective

The required contexts `review-gate` and `workflow provenance` are each published by two jobs on every
pull-request head: the owning workflow (`review-gate.yml`, `workflow-provenance-gate.yml`) and a
`workflow_dispatch`-only benchmark companion in `ci.yml` that shares the display name and therefore
registers a `skipped` check-run on the `pull_request` event. `latestCheckRunsByName` (id-wins,
HARNESS-124) resolves both names to the `skipped` row, so `checkRunEvidence` reports `'none'` for a
check that passed — observed by `merge-verifier` on PR #2805 at `dd342a2d6`. Make every declared
required context the name of exactly one job across all workflow files, and refuse the next collision
mechanically. Plan: paired spec `CHECKS-2664` (lane L2). Registered on the umbrella issue at
https://github.com/woojubb/robota/issues/2664#issuecomment-5762394051 (no new issue).

## Plan

- [x] `.github/workflows/ci.yml`: `benchmark-review-gate` → `name: benchmark review-gate`,
      `benchmark-workflow-provenance` → `name: benchmark workflow provenance`; `benchmark-summary`
      resolves the eleven contexts through a context → job-name map
- [x] `scripts/harness/scan-main-required-checks.mjs`: `contextPublishers(root)` export;
      `findContextNameFindings` reports a declared context with more than one publisher, and a
      `required_status_checks` entry whose sole publisher is not the declared `workflow`/`job`
- [x] `scripts/harness/__tests__/scan-main-required-checks.test.mjs`: two-publisher cases (other file,
      `push`-only workflow, same file), wrong-job case, unique-companion case, `contextPublishers` shape;
      `github-actions-maintenance.test.mjs` re-pinned to the companion names and the summary map
- [x] `.agents/rules/git-branch.md`: one sentence under the "per LATEST run per check `name`" bullet
- [x] TC-01 — `pnpm exec vitest run scripts/harness/__tests__/scan-main-required-checks.test.mjs` green,
      and red with the finder change reverted
- [x] TC-02 — `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` exits 0
- [x] TC-03 — `node scripts/harness/scan-main-required-checks.mjs` exits 0 on the fixed tree; exits 1 naming
      `ci.yml#benchmark-review-gate` and `ci.yml#benchmark-workflow-provenance` with the rename reverted
- [x] TC-04 — `pnpm exec vitest run scripts/harness/__tests__/github-api-check-runs.test.mjs` exits 0 and
      `git diff origin/develop -- scripts/harness/github-api.mjs` is empty
- [x] TC-05 — `gh workflow run ci.yml --ref develop -f base_ref=develop -f head_ref=develop` once the
      change is on `develop`: the `benchmark-summary` table lists `review-gate` and `workflow provenance` rows
- [x] TC-06 — `grep -c 'main-required-checks' .agents/rules/git-branch.md` → `1`, inside the named bullet

## Test Plan

Owned by the spec's `## Test Plan` table (TC-01 to TC-06): the existing vitest suite for
`scan-main-required-checks` gains the red-proof cases (a `workflow_dispatch`-only job in a second file,
a `push`-only workflow and a same-file duplicate each publishing a required name; a sole publisher that
is not the declared job); direct execution of the scan on the tree is red before the `ci.yml` rename
and green after it; the dedupe suite plus an empty `git diff` pin that `latestCheckRunsByName` is
untouched; the affected scan set is the regression run; the benchmark dispatch on `develop` after
merge is the one check no pre-merge run can perform.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** The change is to CI job display names and a repository-harness scan over workflow files. Its only observers are repository maintainers reading a pull request's check-runs list on GitHub and contributors running `pnpm harness:scan`; no end user of the Robota product (CLI, SDK, TUI, MCP server) can observe it through any runnable product surface.

## Completion Criteria

- [x] TC-01: `pnpm exec vitest run scripts/harness/__tests__/scan-main-required-checks.test.mjs` → exit 0 (52), red before the finder change
- [x] TC-02: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exit 0
- [x] TC-03: `node scripts/harness/scan-main-required-checks.mjs` → exit 0 on the fixed tree; exit 1 naming both companions before the rename
- [x] TC-04: `pnpm exec vitest run scripts/harness/__tests__/github-api-check-runs.test.mjs` → exit 0; `github-api.mjs` unchanged
- [x] TC-05: benchmark dispatch on `develop` (run 35622979521) — both companions success; the summary map resolved all eleven contexts
- [x] TC-06: `grep -c 'main-required-checks' .agents/rules/git-branch.md` → `1`, inside the named bullet

## Result

Delivered by https://github.com/woojubb/robota/pull/2811, landed on `develop` as
`1c02d9777d54c20c0dd3a72a66f9f16404a4d953` (squash, 2026-09-21T15:57:41Z; MERGE VERIFIED PASS by
`merge-verifier`). Registration and completion record on the umbrella:
https://github.com/woojubb/robota/issues/2664#issuecomment-5762394051 and
https://github.com/woojubb/robota/issues/2664#issuecomment-5763797879. TC-05 ran after landing (run
35622979521): both companions `success`, the summary map resolved all eleven contexts and reported
`review-gate` / `workflow provenance` rows; the summary job's final assertion failed only on
`commitlint`'s degenerate `develop..develop` range, a pre-existing benchmark property registered at
https://github.com/woojubb/robota/issues/2680#issuecomment-5763788803.
