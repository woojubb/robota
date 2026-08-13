---
title: 'INFRA-094: the advisory (non-blocking) patch-coverage job runs ~206s on every code PR and rebuilds all deps itself instead of reusing the build job dist — take it off the develop-PR critical path or make it reuse dist'
status: todo
created: 2026-08-14
priority: medium
urgency: soon
area: .github/workflows/ci.yml, scripts/harness/check-patch-coverage.mjs
depends_on: []
---

# INFRA-094: advisory patch-coverage off the PR critical path

## Problem

`patch-coverage (advisory)` is a non-blocking job — its result does not gate merges — yet it runs
~206s on every code-changing develop PR, and it performs its OWN `pnpm build:deps` (a full workspace
build) that duplicates the `build` job's work because the two do not share a dist artifact. It is
one of the four ~200s parallel jobs that set the develop-PR wall-clock floor at ~4 minutes, and it
adds Actions billing for advisory data that never blocks anything.

## Evidence (measured from PR #1709 / #1707 CI runs, 2026-08-14)

- `.github/workflows/ci.yml` `patch-coverage` job: `name: patch-coverage (advisory)`; `if:
!cancelled() && github.base_ref != 'main' && (needs.changes.result != 'success' ||
needs.changes.outputs.code == 'true')` — advisory, code-gated (correctly skips docs-only), but runs
  fully on every code PR.
- Step "Build workspace packages (affected suites import sibling dist)":
  `if: steps.detect.outputs.affected == 'true'` → `run: pnpm build:deps` — a second full dep build,
  independent of the `build` job's output (no shared/artifact-restored dist).
- Timing: patch-coverage = 206s (#1709), 208s (#1707) — comparable to `build` (200s) and `scans`
  (234s), all running in parallel.

## Direction

Pick one (owner decision), both reduce the develop-PR wall-clock floor:

- **(a) Move it off the per-PR critical path** — run patch-coverage on a schedule (nightly, like
  INFRA-042's mutation testing) or as a non-blocking post-merge job. Advisory coverage data does not
  need to be on the PR's wall-clock, and this removes ~206s + a redundant build from every code PR.
- **(b) Keep it per-PR but stop it rebuilding** — consume the `build` job's dist via
  `actions/upload-artifact`/`download-artifact` (the `quality` and binary-e2e steps already restore
  dist this way), so patch-coverage reuses the build instead of running its own `pnpm build:deps`.
  Cuts the job's time by the build share and removes the duplicate compile.

Coordinate with INFRA-046 ("promote advisory gates") — if that item's direction is to make advisory
gates blocking, that argues for (b); if it keeps them advisory, (a) is the cheaper win.

## Test Plan

- (a): patch-coverage no longer appears as a check on a code PR (or appears as a non-blocking
  scheduled run); develop-PR wall-clock floor drops by ~200s; a nightly run produces the coverage
  report.
- (b): the patch-coverage job's "Build workspace packages" step is replaced by a dist artifact
  restore; the job's wall-clock drops by the build share; coverage numbers are unchanged vs the
  current run on a sample PR.
- `pnpm harness:scan` (workflow-lint / ci-mirror scans) stays green.

## User Execution Test Scenarios

Not applicable — CI-configuration change with no user-facing product runtime behavior. Verification is
the CI-timing / check-presence comparison in the Test Plan (before vs after on a sample code PR, and
the nightly run for option a).
