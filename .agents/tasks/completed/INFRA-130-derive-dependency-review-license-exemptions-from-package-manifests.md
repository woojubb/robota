---
title: 'INFRA-130: derive dependency-review license exemptions from package manifests'
issue: https://github.com/woojubb/robota/issues/2014
status: done
created: 2026-08-22
completed: 2026-08-22
priority: medium
urgency: soon
area: .github/workflows/dependency-review.yml, scripts/harness
depends_on: []
---

# INFRA-130: derive dependency-review license exemptions from package manifests

## Objective

The dependency-review workflow keeps first-party dual-license exemptions as a hand-written PURL
list. The current tree contains 76 package manifests with
`AGPL-3.0-only OR LicenseRef-Commercial`, while only one of the two listed `@robota-sdk` names still
exists. Derive the complete first-party exemption set from package manifests so additions, removals,
renames, and nested packages cannot leave the rare promotion gate with a silent coverage gap.

Source: https://github.com/woojubb/robota/issues/2014

## Plan

- [x] Specify the exact manifest population, PURL encoding, and fail-closed validation behavior.
- [x] Add regression tests that fail against the current hand-written workflow shape.
- [x] Generate sorted first-party PURLs from the checked-out package manifests.
- [x] Wire the generated step output into dependency-review without broadening the global license
      allow-list or the separately owned `sharp` exemptions.
- [x] Run targeted workflow/generator tests, actionlint, harness scans, and CI-equivalent verification.

## Recommendation Gate

- Finding depth (2026-08-22): `DEPTH: LOCAL`; `DEPTH: 0 FOUNDATIONAL of 1`. The reviewed root
  cause is the workflow's duplication of manifest-owned facts without derivation or completeness
  enforcement. No separate cause requires another Task.
- Proposal review (2026-08-22): `REVIEW VERDICT: ENDORSE` after one revision. The revision added a
  malformed-target symlink fixture and made the live expected population independent of the production
  generator instead of freezing the dated count of 76.

## Test Plan

- Unit-test nested discovery, symlink-directory non-traversal with a malformed target fixture,
  exact-license selection, scoped-name PURL encoding, stable ordering, duplicate detection, malformed
  manifests, invalid names, and an empty selected population.
- Contract-test the live workflow: the generator step precedes dependency review, its output is
  consumed by `allow-dependencies-licenses`, hard-coded `@robota-sdk` PURLs are absent, and static
  `sharp` exemptions remain.
- Run `pnpm harness:test`, `pnpm harness:scan`, actionlint, and `pnpm harness:verify-like-ci`.

## User Execution Test Scenarios

Not applicable — this is an internal CI license-policy gate and does not change a runnable Robota
product surface. Its observable contract is exercised by workflow and harness tests in the Test Plan.

## Result

- Added `scripts/harness/generate-dependency-review-license-exemptions.mjs`, deriving sorted,
  versionless npm PURLs from the complete exact-license manifest population without following
  symlinked directories and failing closed on malformed inputs or output configuration.
- Wired the generated `$GITHUB_OUTPUT` value into `.github/workflows/dependency-review.yml` before
  dependency review while preserving the global policy and all 14 explicit `sharp` PURLs.
- Added 19 generator/output/workflow contract tests in
  `scripts/harness/__tests__/generate-dependency-review-license-exemptions.test.mjs`.
- Verification evidence: focused Vitest 19/19; actionlint 1.7.7 with shellcheck 0.11.0 exited 0;
  `pnpm harness:test` passed 4,711 live plus 1,142 hermetic tests; `pnpm harness:scan` passed 136
  scans with one declared skip; `pnpm harness:verify-like-ci` passed all 12 mirrored stages.
