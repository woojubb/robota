---
title: 'HARNESS-114: no metric answers whether a convergence loop earned its cost'
status: in-progress
created: 2026-08-19
priority: medium
urgency: soon
area: scripts/harness, .agents/evals
depends_on: [HARNESS-112]
---

# HARNESS-114: publish what a loop spent against what it finished

GitHub issue: https://github.com/woojubb/robota/issues/1875

## Objective

`.agents/evals/metrics.md` declares five metrics; every one measures correctness, autonomy, or process
compliance, and none relates what a loop spent to what it produced.

This repository has taken that number exactly once — `record-local-review.mjs:12` records 38 review rounds
across five PRs, 24 of them blocking, at 6-10 minutes of CI each — and that measurement produced the
local-review record and the pre-push refusal. It was taken by hand and there is still no way to take it
again.

Publish the derivable half as an explicit proxy, and say what it cannot see.

## Spec

`.agents/spec-docs/active/HARNESS-114-no-metric-answers-whether-a-loop-earned-its-cost.md`

## Plan

- [ ] TC-01: an empty corpus reports `NO DATA`, never `0%`.
- [ ] TC-02: a 4-run fixture with 2 non-converged terminals reports exactly `50%`.
- [ ] TC-03: the rounds figure equals `roundFindings.length`, against a fixture whose length differs from
      every other number in the record.
- [ ] TC-04: an OPEN run is excluded from the denominator and reported separately.
- [ ] TC-05: a malformed ledger line exits non-zero naming file and line; it is not dropped.
- [ ] TC-06: `metrics.md` states the metric, what it is a proxy for, what it cannot observe, and that it is
      advisory.
- [ ] TC-07: the reporter is `covered` under `measurement-provenance`.
- [ ] TC-08: `pnpm harness:scan` and `pnpm harness:test` exit 0.

## Test Plan

Unit tests drive the reporter against fixture corpora chosen so each assertion is exact rather than
bounded: a 4-run corpus for a percentage that can only be 50 if the denominator is right, and a record
whose `roundFindings` length differs from every other number in it so a reading taken from the wrong field
cannot pass. TC-01 and TC-04 protect the denominator in the two directions an empty or unfinished corpus
can corrupt it. Advisory by declaration — no blocking threshold is set, because the corpus starts empty
and a threshold taken from an article's assertion rather than from this repository's own runs is the
tautology `measurement-provenance.md` refuses.

## Progress
