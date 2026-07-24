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

## Test Plan

A deliberately-failing fixture PR proves each gate BLOCKS post-promotion; docs-only PR proves skip=pass.
