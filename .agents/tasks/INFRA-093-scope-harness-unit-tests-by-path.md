---
title: 'INFRA-093: the 179-file harness unit-test suite runs in full on every develop PR (~180s) even when no harness code changed — gate it on scripts/harness (and workflow/config) paths so product-only PRs skip it'
status: todo
created: 2026-08-14
priority: medium
urgency: soon
area: .github/workflows/ci.yml, scripts/harness
depends_on: []
---

# INFRA-093: scope the harness unit-test suite by path

## Problem

The `scans` CI job runs `pnpm harness:test` — the full 179-file unit suite that tests the CI harness
SCRIPTS themselves — unconditionally on every `develop`-targeting PR, with no `needs` and no path
gate. Measured at ~180s. It is a fixed cost paid on every product change and every docs change, even
though nothing under `scripts/harness/**` was touched. It is the single largest change-independent
time sink in the per-PR CI (26% of the promotion gate's 707s, and a big share of the `scans` job's
234s on develop PRs).

## Evidence (measured from PR #1709 / #1711 / #1712 CI runs, 2026-08-14)

- `.github/workflows/ci.yml` `scans` job: `if: github.base_ref != 'main'` (runs on ALL develop PRs,
  including docs-only) → step "Harness scan test suite": `run: pnpm harness:test`
  (`= vitest run scripts/harness/__tests__ --pool=threads --maxWorkers=2`). No path filter, no
  `needs: changes`.
- The suite is 179 test files under `scripts/harness/__tests__/` — they exercise the harness scripts
  (scan logic, promotion, gates), not product code.
- Timing: docs-only PR #1711's `scans` job = 232s; the same `pnpm harness:test` also accounts for
  ~181s of the promotion gate's 707s (`release-grade verification`) breakdown.
- A `changes` classifier job already exists (`classify-changed-paths.mjs`, outputs `code`/`product`/
  `tui`/`examples`) — the wiring to gate a job on changed paths is present; harness tests just are not
  gated by it.
- Prior decision to respect: HARNESS-021 rejected _per-scan_ test selection (choosing WHICH harness
  tests to run based on which scan changed) and kept "the suite runs in full". This task is a
  DIFFERENT, coarser axis — skip the ENTIRE suite only when NOTHING under the harness's own source
  changed — so it does not reopen HARNESS-021's per-scan-selection question.

## Direction

Add a `harness` path signal to the `changes` classifier (`scripts/harness/**`,
`.github/workflows/**`, `.agents/harness.config.json`, and the harness test dir itself) and gate the
`pnpm harness:test` step (and the harness-test portion of `release`) on it. When those paths are
unchanged, skip the ~180s suite; when they ARE changed, run it in full (preserving HARNESS-021).
Keep the harness SCAN step (`pnpm harness:scan`) always-on — it validates docs/tasks/rules and must
run on content changes. The gate must fail-safe: an unreadable/failed classifier runs the suite
(never silently skips), matching the repo's existing fail-safe classifier posture.

## Test Plan

- A product-only PR (no `scripts/harness/**` change) shows the harness-test step SKIPPED and the
  `scans` job wall-clock drops by ~180s; the harness scan step still runs.
- A PR touching `scripts/harness/**` runs the full harness-test suite (verify it is NOT skipped).
- A PR where the classifier fails runs the suite (fail-safe).
- `pnpm harness:scan` (the ci-mirror / workflow-lint scans) stays green.

## User Execution Test Scenarios

Not applicable — CI-configuration / harness change with no user-facing product runtime behavior.
Verification is the CI-timing and skip/run assertions in the Test Plan (measured against a product-only
PR vs a harness-touching PR).
