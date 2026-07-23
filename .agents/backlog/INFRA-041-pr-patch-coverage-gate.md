---
title: 'INFRA-041: PR patch (diff) coverage gate — new/changed lines must be tested'
status: todo
created: 2026-07-22
priority: medium
urgency: soon
area: .github/workflows, vitest config
depends_on: []
---

# PR patch (diff) coverage gate

## Problem

CI enforces a **global** 80% line-coverage threshold (the `compat-node18` job:
`--coverage.thresholds.lines=80`), but that has a real hole: a PR can add untested lines and still pass as
long as the whole repo stays above 80%. This is the same class as the accidental-green problem
([tdd-and-planning.md](../rules/tdd-and-planning.md) "Prove the regression test RED") — a change whose new code
is not actually exercised by tests. A **patch/diff coverage** gate closes it: the lines a PR adds/changes must
themselves be covered.

Not a "just add a workflow" — it changes the test/coverage contract and needs coverage plumbing (see below),
so it goes through the gate rather than being rushed into CI.

## What (design — pick one at IMPLEMENT)

**Plumbing needed either way:** the root/per-package vitest coverage config currently reports
`['text','json','html']` — **no lcov**. Add `lcov` to `coverage.reporter` so a machine-readable report exists.

- **Option A — `diff-cover` (self-hosted, no external service; matches the osv-binary pattern).** A PR job:
  run coverage across packages → emit per-package `coverage/lcov.info` → merge (`lcov-result-merger
'packages/*/coverage/lcov.info' merged.info`) → `diff-cover merged.info --compare-branch=origin/<base>
--fail-under=<X>`. Python3 + `pip install diff-cover` are available on `ubuntu-latest`.
- **Option B — Codecov patch status (reuse the existing codecov setup).** `deploy.yml` already uploads to
  codecov post-merge; add a PR coverage-upload job + `codecov.yml` with `coverage.status.patch.target: <X>%`.
  Codecov computes the diff mapping and posts a `codecov/patch` status. Needs `CODECOV_TOKEN` (or tokenless
  for this public repo).

Recommendation: **Option A** (no external dependency, deterministic, self-hosted — consistent with the repo's
osv-scanner-binary approach), unless the codecov PR integration is wanted for the UI.

## Threshold

Start at a pragmatic patch target (e.g. 80% of changed lines), advisory first (non-required status) for a few
PRs to calibrate the false-positive rate, then promote to a required check.

## Test Plan

- A fixture PR that adds an untested function → the gate FAILS on the diff; adding a test for it → PASSES.
- Docs/config-only PRs (no coverable lines) → the gate is a no-op, not a false failure.

## User Execution Test Scenarios

- Not applicable (CI gate; the fixture PR above is the maintained proof).
- Evidence: the fixture red/green run.
