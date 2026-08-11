---
title: 'INFRA-088: promotion novelty scans use the develop baseline'
status: in-progress
created: 2026-08-12
priority: high
urgency: now
area: .github/workflows, scripts/harness
depends_on: []
---

# INFRA-088: promotion novelty scans use the develop baseline

Spec: `.agents/spec-docs/active/INFRA-088-promotion-scan-baseline.md`

## Objective

Make the local and CI develop→main release gates compare promotion-local novelty against the exact
develop tree being promoted, while preserving `GITHUB_BASE_REF=main` for promotion-context gates.

## Plan

- [x] TC-01 — Red-prove and add the release-grade workflow's step-scoped
      `HARNESS_BASE_REF=origin/develop` declaration.
- [x] TC-02 — Red-prove and make the local promotion preflight pass its configured develop ref as
      `HARNESS_BASE_REF` to the release-gate child process.
- [x] TC-03 — Red-prove and align `check-document-authority.mjs` with the explicit override
      precedence while preserving ordinary PR resolution.
- [ ] TC-04 — Run the focused suites, complete release verification, and create a fresh sanctioned
      promotion without skipping the release gate.

## Test Plan

- Run the focused Vitest files for promotion preflight parity and document-authority base
  resolution after first observing each new regression assertion fail.
- Run `pnpm harness:test`, `pnpm harness:scan`, and the release gate required by the promotion path.
- Run `node scripts/harness/promote.mjs`; it must report `release gate PASSED locally` and create a
  promotion whose tree equals `origin/develop` without `--skip-release-gate`.

## Progress

### 2026-08-12

- PR #1690 reproduced the false-positive baseline against eleven historical rule sections.
- GATE-WRITE and GATE-APPROVAL passed for the develop-baseline design.
- RED: focused Vitest run failed exactly three new assertions (workflow baseline, local preflight
  child environment, document-authority override precedence).
- GREEN: the same focused run passed 31/31 tests after the minimal changes.
- Regression: `pnpm harness:scan` passed 107 scans and `pnpm harness:test` passed 173 files / 3,182
  tests. TC-04 remains pending until this fix lands on `develop` and the sanctioned promotion can
  exercise the real develop ref.
- PR #1691 landed the baseline fix on `develop`; an independent verifier confirmed identical source
  and target trees, preserved ancestry, and 9/9 required checks passing.
- The first real promotion attempt exposed a separate launch-boundary defect: the interactive shell
  resolved Volta's `pnpm` shim, but Node's exported child `PATH` did not, so `spawnSync('pnpm')`
  returned `ENOENT`. Running the identical gate directly with `HARNESS_BASE_REF=origin/develop`
  passed the full build, scan, test, release-suite, typecheck, and lint chain.
- RED/GREEN: the promotion test first failed when requiring `corepack pnpm`, then passed 9/9 after
  the runner used Node 22's Corepack entrypoint. This keeps pnpm pinned to packageManager 8.15.4
  while removing reliance on shell-only PATH mutation.

## Decisions

- Keep `GITHUB_BASE_REF=main` as event/promotion context and use the existing explicit
  `HARNESS_BASE_REF` seam only for diff-sensitive release verification.

## Blockers

- None.

## Result

Pending.
