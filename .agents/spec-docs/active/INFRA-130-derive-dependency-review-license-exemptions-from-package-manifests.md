---
status: in-progress
type: INFRA
tags: [ci, security, dependencies]
---

# INFRA-130: derive dependency-review license exemptions from package manifests

## Problem

`.github/workflows/dependency-review.yml` deliberately excludes
`AGPL-3.0-only OR LicenseRef-Commercial` from its global `allow-licenses`: admitting those leaves
globally would also admit an unrelated third-party package. Robota's own packages therefore need
name-scoped PURL exemptions under `allow-dependencies-licenses`.

That list is hand-written. Issue #2014 measured 56 matching manifests and two listed names. On
2026-08-22 the gap has grown: `packages/**/package.json` contains 77 manifests, 76 carry the exact
dual-license expression, and the remaining private `@robota-sdk/agent-cli-web` manifest has no
license field. The workflow still lists two `@robota-sdk` PURLs, but
`@robota-sdk/agent-provider` no longer exists, so effective current coverage is 1 of 76.

The defect surfaces when dependency review sees a newly added dependency on any other first-party
package. It is easy to miss on ordinary `develop` PRs because many edges already exist in the base,
then fails a promotion whose `main` base exposes many accumulated edges at once. Promotion PR #2013
reproduced this first-party failure. Promotion PR #1895 also failed the same license gate, but its
actual incompatible entries were the separately owned `@img/sharp-win32-*` exemptions later handled
by INFRA-115; it demonstrates the maintenance shape, not this first-party reproduction. Adding today's
missing names would preserve the same defect for the next package addition or rename.

## Prior Art Research

- GitHub Dependency Review Action v5 separates the repository-wide license policy from
  package-specific exceptions. `allow-licenses` accepts SPDX identifiers globally, while
  `allow-dependencies-licenses` accepts comma-separated Package URLs and exempts only those package
  identities. [Dependency Review Action configuration](https://github.com/actions/dependency-review-action#configuration)
- GitHub Actions supports computing a value in one step through `$GITHUB_OUTPUT` and consuming it as
  `steps.<id>.outputs.<name>` in a later step. This is the supported bridge from checked-out manifest
  data to an action input. [GitHub Actions workflow commands](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#setting-an-output-parameter)
- The Package URL npm definition uses `pkg:npm/<namespace>/<name>`; version is optional and a scoped
  package's leading `@` is percent-encoded. `@robota-sdk/agent-core` therefore becomes the
  any-version PURL `pkg:npm/%40robota-sdk/agent-core`.
  [Package URL npm definition](https://github.com/package-url/purl-spec/blob/main/docs/types/definitions/npm-definition.md)
- npm owns `name` and SPDX-expression `license` in `package.json`. SPDX permits an `OR` choice and a
  project-defined `LicenseRef-*`, making the exact expression
  `AGPL-3.0-only OR LicenseRef-Commercial` a valid manifest selector.
  [npm package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/),
  [SPDX license expressions](https://spdx.github.io/spdx-spec/v3.0.1/annexes/spdx-license-expressions/)
- pnpm workspace membership can include nested package patterns. Robota already uses both
  `packages/*` and `packages/dag-nodes/*`, so a one-level directory assumption is invalid.
  [pnpm workspace settings](https://pnpm.io/settings#packages)

The common pattern is to keep the global license policy narrow and derive package-specific
exceptions from authoritative package metadata. For Robota, the checked-out package manifests are
the ownership and license source; a GitHub Actions step output adapts them to the action's PURL input.

## Architecture Review

### Affected Scope

- `scripts/harness/generate-dependency-review-license-exemptions.mjs` — new deterministic,
  fail-closed manifest-to-PURL generator and GitHub output writer.
- `scripts/harness/__tests__/dependency-review-license-exemptions.test.mjs` — new generator and live
  workflow contract tests.
- `.github/workflows/dependency-review.yml` — generate first-party exemptions after checkout, consume
  the step output, retain explicit `sharp` exemptions, and trigger when the generator or workflow
  changes.
- No package runtime or public API changes; no package `docs/SPEC.md` section changes.

### Alternatives Considered

1. **Derive first-party PURLs from checked-out manifests on every dependency-review run.**
   - Pro: package metadata remains the single source of truth; additions, removals, renames, and
     nested packages update the input immediately.
   - Con: the generator is security-relevant workflow code and must be deterministic, tested, and
     fail closed.
2. **Commit a generated configuration/list and add a drift scan.**
   - Pro: reviewers can see the complete expanded list without executing the generator.
   - Con: introduces a second generated artifact and a regeneration obligation; correctness still
     depends on a separate drift gate always running.
3. **Keep the hand-written list and add a coverage assertion.**
   - Pro: minimal workflow change and mechanical detection of omissions.
   - Con: preserves duplicate manual maintenance and fixes detection rather than the cause.
4. **Add the Robota dual-license leaves to global `allow-licenses`.**
   - Pro: no package discovery is needed.
   - Con: accepts unrelated third-party AGPL/custom-commercial packages and violates the license
     boundary this gate exists to enforce.

### Decision

Choose alternative 1. Recursively discover package manifests under `packages/` without following
symlinked directories, parse every discovered manifest, select only the exact Robota dual-license
expression, require each selected package to have a canonical `@robota-sdk/<name>` identity, reject
duplicates, sort canonical versionless npm PURLs, and fail if the selected population is empty. Write
the comma-separated set to `$GITHUB_OUTPUT`; the workflow appends the separately maintained `sharp`
PURLs in the action input.

The design preserves the existing security boundary: neither AGPL nor `LicenseRef-Commercial` enters
the global allow-list, and the generator cannot exempt an arbitrary scope. Existing `sharp` exemptions
stay static because they represent third-party platform packaging, not Robota ownership.

Validation before approval:

- **Finding depth:** an independent depth triage returned `DEPTH: LOCAL` and `0 FOUNDATIONAL of 1`.
  The defect is the workflow's duplication of manifest-owned name/license facts without derivation or
  a completeness guard; runtime derivation removes that defect at its owner rather than patching the
  current names. No independent second cause belongs in this Task.
- **Independent proposal review:** `REVIEW VERDICT: ENDORSE` on 2026-08-22 after one revision. The
  revision made symlink non-traversal an adversarial fixture contract and made the live expected
  population independent of the production generator instead of freezing the dated count of 76.
- **Reachability:** the generator runs after `actions/checkout`, writes one step output, and the
  immediately following `actions/dependency-review-action@v5` consumes that exact output.
- **Capability preservation:** `allow-licenses`, `allow-ghsas`, severity/scope policy, the complete
  static `sharp` exception family, and failure commenting remain unchanged.
- **Adversarial pass:** malformed JSON, unreadable manifests, a selected manifest with a missing or
  non-`@robota-sdk` name, duplicate names, an empty selection, nested packages, ordering drift, and
  a generator/workflow edit that would otherwise miss the workflow path filter all receive explicit
  tests or fail-closed behavior. A hermetic fixture places malformed manifest content behind a
  symlinked directory so the test fails if discovery ever follows pnpm-style symlinks.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — existing dependency-review scope test and the workflow's license-policy
      owners were inspected; no second dependency-review workflow or first-party exemption owner exists
- [x] 대안 최소 2개 검토 완료 (4개)
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

1. Add an import-safe Node ESM module that recursively enumerates real directories beneath
   `packages/` without traversing symbolic links, parses every discovered `package.json`, and derives
   sorted PURLs for manifests whose `license` exactly equals
   `AGPL-3.0-only OR LicenseRef-Commercial`.
2. Validate the selected npm names, uniqueness, non-empty result, and `$GITHUB_OUTPUT`; report every
   failure to stderr and exit non-zero without emitting a partial exemption set.
3. Add a workflow step with a stable `id` before dependency review and consume its output as the
   first entry of `allow-dependencies-licenses`; keep all `@img/sharp-*` entries explicit.
4. Extend workflow paths so manifest, generator, and workflow changes exercise dependency review.
5. Pin the generator behavior and workflow wiring with hermetic fixtures plus live-tree contract
   assertions.

## Affected Files

- `scripts/harness/generate-dependency-review-license-exemptions.mjs` (new)
- `scripts/harness/__tests__/dependency-review-license-exemptions.test.mjs` (new)
- `.github/workflows/dependency-review.yml`
- `.agents/tasks/INFRA-130-derive-dependency-review-license-exemptions-from-package-manifests.md`

## Completion Criteria

- [ ] TC-01: the generator emits one stable sorted canonical PURL for every current manifest whose
      license is exactly `AGPL-3.0-only OR LicenseRef-Commercial`, including nested packages, and
      excludes manifests with no matching license. The live test derives the expected population from
      the tree; 76 is a dated 2026-08-22 measurement, not a fixed assertion.
- [ ] TC-02: malformed/unreadable manifests, missing or non-`@robota-sdk` selected names, duplicate
      identities, a missing GitHub output target, and an empty selected population each exit non-zero
      without emitting a partial allow-list; symlinked directories are not traversed, proven with a
      malformed target manifest that would fail if followed.
- [ ] TC-03: dependency review consumes the generated first-party PURLs while the global license list,
      security inputs, and explicit `sharp` PURLs remain unchanged; no hard-coded `@robota-sdk` PURL
      remains in the workflow.
- [ ] TC-04: changes to any package manifest, the generator, or the dependency-review workflow itself
      trigger the workflow.
- [ ] TC-05: focused tests, actionlint, harness scans, and CI-equivalent verification exit 0.

## Test Plan

| TC-ID | Test Type             | Tool / Approach                                                           | Notes |
| ----- | --------------------- | ------------------------------------------------------------------------- | ----- |
| TC-01 | CI pipeline unit test | Vitest fixtures plus live-tree manifest/PURL coverage assertion           |       |
| TC-02 | CI pipeline unit test | Vitest temp-directory, symlink-boundary, and spawned-CLI failure cases    |       |
| TC-03 | CI contract test      | Parse/assert the live dependency-review workflow and run actionlint       |       |
| TC-04 | CI contract test      | Assert workflow `paths` cover manifests, generator, and the workflow file |       |
| TC-05 | CI pipeline smoke     | `pnpm harness:test`, `pnpm harness:scan`, `pnpm harness:verify-like-ci`   |       |

## Tasks

- [ ] `.agents/tasks/INFRA-130-derive-dependency-review-license-exemptions-from-package-manifests.md`
      — todo; created during issue #2014 conversion before implementation

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-22

**Status upgrade:** draft → review-ready

- Frontmatter block: the file begins with a closed YAML frontmatter block.
- Frontmatter status: `status: draft` is present, matching the entry-gate input state and `draft/` location.
- Frontmatter type: `type: INFRA` is one of the catalogue's 11 allowed values.
- Frontmatter tags: `tags: [ci, security, dependencies]` is present.
- Problem symptom: the document quantifies effective coverage as 1 of 76 and identifies the stale `@robota-sdk/agent-provider` exemption.
- Problem reproduction: it identifies dependency-review edges on ordinary and promotion PRs and cites promotion PRs #1895 and #2013 as reproductions.
- Problem completeness: the section is concrete and contains no `TBD`, `TODO`, or vague single-sentence placeholder.
- Prior Art Research presence: `## Prior Art Research` is present.
- Prior Art Research substantiation: it cites GitHub Dependency Review Action, GitHub Actions workflow-command, Package URL, npm/SPDX, and pnpm documentation.
- Prior Art Research waiver: N/A because the required research is present and substantiated; no waiver is needed.
- Research-to-decision trace: the alternatives and decision apply the documented package-specific PURL, step-output, scoped-name, SPDX-expression, and nested-workspace findings.
- Architecture checklist: all four checklist items are checked `[x]`.
- Sibling scan: checked with evidence that the existing dependency-review scope test and workflow policy owners were inspected and no second owner was found.
- Alternatives: four alternatives each state at least one pro and one con.
- Decision trade-off: the decision chooses manifest derivation for metadata SSOT and automatic lifecycle coverage while accepting a tested, fail-closed security-relevant generator.
- New-surface placement: N/A; this changes an internal harness generator and an existing CI workflow input, and introduces no package, app, presentation/public interface surface, layer reclassification, or product-family boundary.
- Completion Criteria identifiers: all five items use unique sequential `TC-01` through `TC-05` prefixes.
- Completion Criteria coverage: the five criteria cover derivation, fail-closed validation, workflow policy wiring, trigger coverage, and verification respectively.
- Completion Criteria observability: every criterion names an emitted value, exit status, preserved workflow property, trigger condition, or verification exit code.
- Completion Criteria wording: none uses the forbidden phrases `works correctly`, `no errors`, `implemented`, or `displays correctly`.
- Test Plan presence: `## Test Plan` is present.
- Test Plan cardinality: five non-empty rows map one-to-one to the five Completion Criteria (`TC-01`–`TC-05`).
- Test Plan detail: every row has a non-empty Test Type and Tool / Approach and none contains `TBD`.
- Manual-test justification: N/A because no Test Plan row uses `manual`.
- Tasks structure: `## Tasks` is present with the required task-file placeholder.
- Evidence structure: `## Evidence Log` was present and empty before this first GATE-WRITE entry.
- Body structure: no `## Status` or `## Classification` body section is present.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-22

**Status upgrade:** review-ready → approved

- Explicit approval: the user stated verbatim, “다 승인함.”
- Approval scope: the statement directly answers the immediately preceding request to approve the
  INFRA-130 design and authorize implementation, so it is unambiguous and specific to this document.
- Post-approval integrity: at gate evaluation, the document remained at the merged
  `a8927abdb` version with `status: review-ready`, `type: INFRA`, unchanged tags, and no working-tree
  modification to this document or its Architecture Review.
- Independent architecture validation: N/A; GATE-WRITE records that this internal harness generator
  and existing workflow input introduce no new package, app, presentation/public interface surface,
  layer reclassification, or product-family boundary.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-22

**Status upgrade:** approved → in-progress

- Ordering check: GATE-APPROVAL has a recorded PASS dated 2026-08-22; the spec has
  `status: approved` and is located under `.agents/spec-docs/todo/`, matching the required input state.
- Task artifact: `.agents/tasks/INFRA-130-derive-dependency-review-license-exemptions-from-package-manifests.md`
  exists.
- Spec task pointer: `## Tasks` records the exact active task-file path.
- TC-01 task coverage: the task plan specifies the exact manifest population, canonical PURL encoding,
  deterministic generation, nested discovery, exact-license selection, and live-tree coverage tests.
- TC-02 task coverage: the task plan and Test Plan specify fail-closed validation tests for malformed or
  unreadable manifests, invalid or duplicate names, empty selection, and symlink non-traversal.
- TC-03 task coverage: the task plan specifies workflow output wiring while preserving the global
  license policy and explicit `sharp` exemptions, with contract tests for those properties.
- TC-04 task coverage: the task plan's workflow wiring and contract-test work includes the manifest,
  generator, and workflow path-trigger contract defined by the spec.
- TC-05 task coverage: the task plan explicitly requires focused generator/workflow tests, actionlint,
  harness scans, and CI-equivalent verification.
- Test Plan: the task file contains a substantive `## Test Plan` section covering unit, workflow
  contract, actionlint, harness-test, harness-scan, and CI-equivalent verification (well over 50 chars).
