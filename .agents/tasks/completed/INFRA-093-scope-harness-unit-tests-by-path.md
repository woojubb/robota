---
title: 'INFRA-093: scope harness self-tests by canonical changed-path capability'
status: done
created: 2026-08-14
completed: 2026-08-14
priority: medium
urgency: soon
area: .github/workflows/ci.yml, scripts/harness
depends_on: []
---

# INFRA-093: scope the harness unit-test suite by path

**Spec:** [completed design](../../spec-docs/done/INFRA-093-scope-harness-unit-tests-by-path.md)

## Plan

- [x] TC-01 — Split harness tests into fail-closed repository-contract and proven-hermetic tiers.
- [x] TC-02 — Add the canonical harness-owner capability and failure matrix.
- [x] TC-03 — Gate only the hermetic tier in required CI while contracts and scans stay present.
- [x] TC-04 — Reuse the same applicability result in pre-push and verify-like-CI.
- [x] TC-05 — Run focused, full harness, scan, and CI-equivalent verification and record evidence.

## Progress

### 2026-08-14

- Replaced the unsafe narrow path-gate premise after auditing the 180-file suite: live-repository
  contract tests remain always-on and only stripped-root-proven hermetic tests may be skipped.
- Final recommendation independently endorsed and approved before implementation.
- TDD RED recorded: classifier contract failed 16 tests, the missing tier owner failed its suite to
  load, and CI/local mirror contracts failed 4 tests before production changes.
- Implemented one harness-owner predicate and fail-closed `harness` output, complete disjoint tiers,
  stripped-repository admission, and matching CI/pre-push/verify-like-CI gates.
- Targeted GREEN: 9 files / 265 tests. A stripped-root discovery run admitted only the 72 of 181
  files that passed without live repository owners; the final hermetic guard passed those 72 files /
  1,052 tests together.
- Final GREEN: `pnpm harness:test`, `pnpm harness:scan` (108 passed, 2 skipped), and
  `pnpm harness:verify-like-ci` all exited 0. The CI-equivalent run passed all 12 locally
  reproducible stages through package regression tests and the real TUI PTY suite.

## Blockers

None.

## Problem

The `scans` CI job previously ran the entire harness self-test suite unconditionally on every
`develop`-targeting PR. Audit showed that most tests are live-repository contracts and must remain
always-on, while a smaller hermetic subset can safely be gated. The defect was the absence of a
machine-proven boundary and a shared changed-path capability, not that every harness test could be
skipped for product changes.

## Evidence (measured from PR #1709 / #1711 / #1712 CI runs, 2026-08-14)

- `.github/workflows/ci.yml` `scans` job: `if: github.base_ref != 'main'` (runs on ALL develop PRs,
  including docs-only) → step "Harness scan test suite": `run: pnpm harness:test`
  (`= vitest run scripts/harness/__tests__ --pool=threads --maxWorkers=2`). No path filter, no
  `needs: changes`.
- The suite grew to 181 files during implementation. Stripped-repository execution proved 72
  hermetic and classified the remaining 109 as repository contracts.
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

Split the suite into an always-on repository-contract tier and an explicit hermetic allowlist proven
by execution in a stripped temporary repository. Add one canonical `harness` path signal and use it
in CI, pre-push, and verify-like-CI to gate only the hermetic tier. Keep `harness:scan` and the
contract tier always-on, keep the release gate full, and run fail-closed whenever classification is
missing or fails.

## Test Plan

- A product-only PR skips only the proven-hermetic tier; repository contracts and scans still run.
- A PR touching a canonical harness owner runs both tiers.
- A PR where the classifier fails runs the hermetic tier too (fail-safe).
- `pnpm harness:scan` (the ci-mirror / workflow-lint scans) stays green.

## User Execution Test Scenarios

Not applicable — CI-configuration / harness change with no user-facing product runtime behavior.
Verification is the CI-timing and skip/run assertions in the Test Plan (measured against a product-only
PR vs a harness-touching PR).
