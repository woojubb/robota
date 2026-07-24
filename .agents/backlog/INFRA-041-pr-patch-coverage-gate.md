---
title: 'INFRA-041: PR patch (diff) coverage gate — new/changed lines must be tested'
status: in-progress
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

## Outcome (v1 — advisory gate shipped)

Implemented as a **variant of Option A** — self-hosted and deterministic like `diff-cover`, but with
the lcov→diff mapping done in a Node checker (`scripts/harness/check-patch-coverage.mjs`) instead of
`pip install diff-cover`, so there is no Python dependency and the decision logic is unit-tested
in-repo (same seam pattern as `check-regression-red-proof.mjs`).

- **CI job**: `patch-coverage (advisory)` in `.github/workflows/ci.yml` — path-scoped
  (`needs: changes` + `code == 'true'`), plus a `--detect` pre-step that skips the build/test steps
  entirely unless the PR changes coverable package/app `src` lines. Coverage runs execute ONLY the
  affected packages' suites (bounded runtime).
- **Advisory v1**: the checker always exits 0 unless `PATCH_COVERAGE_ENFORCE=1`, and even enforced
  only `patch-coverage-below-target` fails (INCONCLUSIVE stays advisory — same contract as
  HARNESS-041's `regression-red-proof`). Target: `PATCH_COVERAGE_TARGET` (default 80).
- **Honesty**: a package whose coverage cannot be produced is NO-DATA (logged, verdict at best
  INCONCLUSIVE); a changed src file absent from lcov is UNINSTRUMENTED (also INCONCLUSIVE) — never a
  silent pass. Non-executable changed lines (types/comments) are excluded from the denominator, so
  type-only diffs are a clean no-op, per the Test Plan.
- **Plumbing**: root `vitest.config.ts` coverage reporter now includes `lcov`; per-package runs get
  lcov via CLI flags (`--coverage.reporter=lcov`), so the 30+ per-package vitest configs needed no
  edits. The hoisted root `@vitest/coverage-v8` resolves for per-package `pnpm --filter … exec vitest`
  runs (verified empirically).
- **Red/green proof (Test Plan executed)**: (1) maintained fixtures
  `scripts/harness/__tests__/fixtures/patch-coverage/{red,green}` driven end-to-end through the real
  CLI (`--fixture`) in `check-patch-coverage.test.mjs`, asserting the exit-code contract (red+enforce
  → exit 1; red advisory → exit 0; green enforced → exit 0); (2) a documented injected run on a real
  package: an untested function added to `packages/agent-process/src` → `0/6 (0.0%) →
patch-coverage-below-target` (enforce exit 1); adding a covering test → `6/6 (100%) →
patch-coverage-ok` (exit 0).

**Remaining (why still open)**: calibrate on real PRs, then flip to enforced/required
(`PATCH_COVERAGE_ENFORCE=1` + branch-protection required check). At flip time, decide whether
INCONCLUSIVE should also block (v1 keeps it advisory to match the regression-red-proof precedent).
