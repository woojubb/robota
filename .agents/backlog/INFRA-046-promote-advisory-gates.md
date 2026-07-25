---
title: 'INFRA-046: promote advisory CI gates (regression-red-proof, patch-coverage) to blocking'
status: todo
created: 2026-07-25
priority: medium
urgency: later
area: .github/workflows/ci.yml, repo rulesets
depends_on: []
---

# INFRA-046: advisory→required gate promotion

## Problem

Two quality floors run advisory-only by design (v1 rollout): `regression-red-proof` (HARNESS-041) and
`patch-coverage` (INFRA-041). Advisory gates that stay advisory forever become noise.

## What

Define + apply the promotion criteria: after N=10 code-PRs each with zero false-positive verdicts
(evaluated from the jobs' logged decisions), flip `REGRESSION_RED_PROOF_ENFORCE=1` /
`PATCH_COVERAGE_ENFORCE=1` and add the job(s) to the develop ruleset's required checks (they are
`changes`-gated, so docs-only PRs skip=pass, same as tui-e2e). Record the false-positive tally in the PR.

## Promotion Audit 2026-07-25 — NOT PROMOTED (neither flag flipped)

Evidence window: the 40 most recently merged `develop` PRs (#1340–#1379). `patch-coverage` landed in
#1329 and `regression-red-proof` in #1272, so both gates existed for every PR in the window.

**Method.** The advisory check-run conclusion is worthless as evidence — both scripts `process.exit(0)`
unconditionally in v1, so all 54 job runs report SUCCESS regardless of verdict. Each job's _log_ was
pulled (`gh api repos/woojubb/robota/actions/jobs/<id>/logs`) and the logged verdict line read
directly. 27 of the 40 PRs were code PRs (the other 13 were docs-only and correctly `SKIPPED` by the
`changes` gate). No log contained an `orchestration error`, `detect error`, `dirty-tree`, or
`run-error` — nothing was masked.

### `regression-red-proof` — 0 of 10 qualifying PRs (blocked on N, not on quality)

| Logged decision                                      | PRs                                                                                                                     | Count |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----- |
| `SKIPPED: range has no `fix:` commit`                | #1342 #1343 #1344 #1346 #1347 #1348 #1350 #1351 #1353 #1354 #1357 #1358 #1359 #1360 #1361 #1364 #1368 #1370 #1374 #1376 | 20    |
| `SKIPPED: no same-package (source+test) pair`        | #1352 #1363 #1365 #1375 #1377 #1378 #1379                                                                               | 7     |
| `red-proof-ok` / `accidental-green` / `inconclusive` | —                                                                                                                       | **0** |

Every skip was verified honest: the 20 "no `fix:` commit" PRs are all `feat:`/`refactor:`/`chore:`/
`ci:`/`test:`; of the 7 "no pair" PRs, six touch **zero** `packages/**` or `apps/**` files at all, and
#1375 (`fix(agent-transport)`) changed `headless-runner.ts` with no accompanying test file — a correct
negative, not a missed pair. **Zero false positives, but also zero substantive verdicts.** The gate's
core logic (reverse-apply the fix, require the test to go RED) has never once executed on a real PR.
Promoting it now would make a required check out of a code path with no production evidence.

Remaining to qualify: **10** PRs that reach a real verdict, i.e. `fix:` PRs carrying a same-package
source+test pair. At the observed rate (0 in 40 merges) this will not accumulate passively — see the
blocker below.

### `patch-coverage` — 16 qualifying PRs (N met) but **not** zero false positives

| Verdict                          | PRs                                                                     | Count |
| -------------------------------- | ----------------------------------------------------------------------- | ----- |
| `patch-coverage-ok`              | #1346 #1350 #1351 #1353 #1357 #1358 #1359 #1360 #1370 #1374 #1375 #1376 | 12    |
| `inconclusive-no-data`           | #1347 #1361                                                             | 2     |
| `patch-coverage-below-target`    | #1344 #1348                                                             | **2** |
| no coverable src changes (no-op) | #1343 #1352 #1354 #1363 #1364 #1365 #1368 #1377 #1378 #1379             | 10    |

`inconclusive-no-data` never blocks under `PATCH_COVERAGE_ENFORCE=1` (only `BELOW_TARGET` exits 1), so
#1347/#1361 are not promotion blockers. The two BELOW-TARGET verdicts are, and both were adjudicated:

- **#1344 `feat(docs)` — 0/56 (0.0%) — FALSE POSITIVE.** Every missed file is a React `.tsx` component
  in `apps/docs`, which has **zero** test files under `src` (`find apps/docs/src -name '*.test.*'` → 0).
  The check's own contract says a package whose coverage data cannot be produced must be
  `INCONCLUSIVE` with an explicit NO-DATA log; instead an all-zero-hit lcov for a suite-less app is
  misread as "you failed to test your changed lines". Under enforcement this would have blocked an
  inline-styles→Tailwind conversion with no remedy short of standing up a component-test stack.
- **#1348 `feat(cmd-004)` — 124/159 (78.0%) — TRUE POSITIVE (borderline).** `agent-transport-gui` does
  have coverage infra (4 suites; `ui-intent-state.ts` 42/42, protocol files 100%/96%). The shortfall is
  real: `SessionSurface.tsx` 0/20 and `useSessionClient.ts` 0/11 are genuinely unexercised render
  surfaces. It misses the 80% target by 2 points, i.e. blocking would have been defensible but harsh.

One confirmed false positive is one more than the criterion allows. **Do not flip
`PATCH_COVERAGE_ENFORCE`.**

### Blockers to clear before re-running this audit

1. **`patch-coverage` must not charge a PR for a package that has no test suite.** When a package/app
   contributes only all-zero-hit lcov records and owns no test files, classify it `UNINSTRUMENTED`/
   NO-DATA (→ `INCONCLUSIVE`, advisory) instead of folding those lines into the BELOW-TARGET total.
   This is the #1344 defect and it is in `scripts/harness/check-patch-coverage.mjs`.
2. **Decide the React-UI policy** (#1348 class): either exclude `.tsx` render surfaces from the patch
   denominator, or stand up component-test infra for the GUI packages. Promotion is unsafe until one
   of the two is chosen, or every UI PR pays a coverage tax it cannot discharge.
3. **`regression-red-proof` needs real verdicts.** Consider back-testing it over historical `fix:` PRs
   that _did_ ship a source+test pair (replay the checker against those merge-bases) rather than
   waiting for 10 to accrue organically — the current merge pattern produces roughly none.

Re-run this audit after (1)–(3); promote only the gate whose own criterion is then met — the two flags
are independent and do not have to flip together.

## Test Plan

A deliberately-failing fixture PR proves each gate BLOCKS post-promotion; docs-only PR proves skip=pass.

Post-promotion verification (not yet executed — nothing was promoted):

1. **Blocking proof.** Open a PR against `develop` whose head commit is `fix(<pkg>): …` and which edits
   one `packages/<pkg>/src` file plus a test that passes with the source change reverse-applied. With
   `REGRESSION_RED_PROOF_ENFORCE=1` the job must log `accidental-green` and exit 1. For patch coverage,
   add an uncovered exported function to a package that has tests; the job must log
   `patch-coverage-below-target` and exit 1. In both cases the PR's merge button must be blocked, which
   only holds once the checks are in the ruleset (see below).
2. **skip=pass proof.** A docs-only PR must show both jobs `SKIPPED` and stay mergeable — GitHub counts
   a skipped required check as satisfied, the same arrangement `tui-e2e` already relies on.

## Owner Action (required only when a flag is actually flipped)

Flipping the env flag alone does **not** block a merge — the job must also be listed in the `develop`
ruleset's required checks. That call needs repo-admin scope and was deliberately not attempted, since
this audit promoted nothing. When a gate does qualify, add its check name
(`regression-red-proof (advisory)` / `patch-coverage (advisory)`, renamed without the `(advisory)`
suffix if the flag is flipped) to the ruleset:

```bash
gh api repos/woojubb/robota/rulesets --jq '.[] | "\(.id)\t\(.name)"'   # find the protect-develop id
gh api repos/woojubb/robota/rulesets/<id> > ruleset.json                # capture current state first
# edit the required_status_checks rule's required_status_checks[] array, then:
gh api -X PUT repos/woojubb/robota/rulesets/<id> --input ruleset.json
```
