# Verification Pipeline Improvement Plan

## Status

Planning document. No implementation is authorized by this document alone.

## Objective

Redesign Robota's local hooks, harness verification, GitHub Actions CI, build pipeline, and release verification so routine commits, pushes, and pull requests validate only the changed behavior and its real dependencies while release-grade paths still run broad checks intentionally.

## Background

During the `3.0.0-beta.56` release preparation, pushing a branch that primarily contained version and changelog updates caused the pre-push hook to validate many package scopes. The hook used `origin/main` as the comparison base even though normal feature work is based on `develop`. That made the hook re-check a large set of already-integrated work.

The same concern exists in CI: the current workflow mixes full repository checks, changed-scope harness verification, build caching, coverage, security audit, and Node compatibility in one broad PR pipeline. The result is slow feedback and noisy failure surfaces.

The practical developer problem is repeated waiting. Every commit, push, or PR currently risks paying for broad checks that are unrelated to the current diff. The target workflow must reduce that repeated latency without removing checks that prove the modified behavior is still correct.

## Current State

### Local Hooks

| Hook                | Current behavior                                             | Problem                                            |
| ------------------- | ------------------------------------------------------------ | -------------------------------------------------- |
| `.husky/pre-commit` | Runs `lint-staged` on staged files                           | Mostly appropriate; limited to changed files       |
| `.husky/pre-push`   | Runs `harness:scan:dist` and `harness:verify` against `main` | Too broad for feature branches targeting `develop` |

### Harness

| Script                | Current behavior                                                                                | Problem                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `harness:verify`      | Maps changed files to workspace scopes, then runs build/test/lint/typecheck for selected scopes | Scope mapping exists, but base-ref and change classification need stronger policy             |
| `harness:scan`        | Runs repository-wide governance scans                                                           | Useful as a full gate, but too broad for every small local push                               |
| `harness:scan:dist`   | Requires `dist/` presence across buildable packages                                             | Useful for publish safety, but not always relevant to docs-only or planning-only changes      |
| scenario verification | Runs owner scenario checks for registered scopes                                                | Correct direction; should remain owner-scoped and explicitly broad only for release workflows |

### GitHub Actions

| Job             | Current behavior                                              | Problem                                                |
| --------------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| `build`         | Installs dependencies and builds all packages                 | Broad, even for docs-only or single-scope PRs          |
| `quality`       | Runs full typecheck, lint, harness scan, verify, tests, audit | Mixed responsibilities and noisy failure surface       |
| `compat-node18` | Runs broad Node 18 compatibility tests                        | Expensive when only a small or unrelated scope changed |

## Developer Feedback Goals

The primary goal is to reduce repeated waiting during normal development while preserving verification coverage for the changed behavior.

| Workflow moment    | Target behavior                                                                                  | Broad checks allowed by default?                        |
| ------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Commit             | Check only staged-file hygiene and cheap document/test-plan rules when relevant.                 | No                                                      |
| Push from feature  | Check changed scopes against the intended base and skip unrelated packages.                      | No                                                      |
| PR update          | Run affected package/app checks and dependents in parallel, with separate failure categories.    | Only when root/global impact requires it                |
| PR ready for merge | Keep stable required check names, but let the check plan decide the smallest safe execution set. | Only for release-grade or global-impact classifications |
| Develop-to-main PR | Run intentional release-grade verification because this is promotion, not routine development.   | Yes                                                     |
| npm publish        | Run full publish safety, dry-run publish, and release-grade verification before publishing.      | Yes                                                     |

Local hooks should optimize for short feedback and high signal. They must not repeatedly run the same full-repository build, lint, typecheck, test, dist, audit, and compatibility checks unless the current diff genuinely affects repository-wide behavior. CI remains the authoritative remote gate, but CI should also avoid serial broad checks when the affected set is small.

### Latency Budget Targets

These are engineering targets, not correctness exceptions:

| Path                        | Target elapsed time                                  | How to achieve it                                                             |
| --------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `pre-commit`                | Seconds                                              | `lint-staged` and staged-file-only checks.                                    |
| `pre-push` docs/task change | Seconds to low tens of seconds                       | Governance/document scans only; no package build/test/lint/typecheck.         |
| `pre-push` single package   | Low tens of seconds to a few minutes depending scope | Owner package checks only; no unrelated `dist` freshness or full repo scan.   |
| PR affected checks          | Parallel medium-duration jobs                        | Detect once, fan out affected build/test/typecheck/lint/scenario jobs.        |
| Release-grade verification  | May be slow                                          | Explicit command/workflow only, expected before publish or `develop -> main`. |

If a future implementation cannot meet these targets for a common change class, the check plan must show which retained check is responsible so the team can decide whether to optimize, cache, parallelize, or reclassify it.

## Prior Art Findings

- GitHub Actions supports branch and path filters, but skipped required workflows can remain pending; GitHub also limits path-filter diff evaluation, so path filters should not be the only correctness boundary.
- Nx's affected model combines Git history with a project graph and runs tasks only on changed projects plus dependents.
- Turborepo's affected mode compares base and head refs, requires enough Git history, and defaults to a `main...HEAD`-style comparison unless overridden.
- pnpm filtering supports selecting packages changed since a ref and can include dependents with selector syntax, but Robota already has harness-owned scope detection and should keep harness behavior explicit.

## Design Principles

1. Local hooks are a fast safety net, not the authoritative release gate.
2. CI must make failures easy to attribute by separating check categories.
3. Changed-scope detection must use the branch's intended base, not a hardcoded global default.
4. Release and `develop -> main` promotion checks may be broad, but broadness must be explicit and documented.
5. Source, test, docs, package manifest, changeset, lockfile, and root config changes need different verification intensity.
6. Reuse harness primitives for local hooks and CI; do not maintain separate path-filter logic in shell and YAML.
7. Full verification must remain available for release, publish, and suspected cross-package risk.
8. Reduction is only valid when a cheaper check still covers the changed behavior. Cost reduction must never mean unverified impact.
9. Routine commit, push, and PR paths should avoid repeating checks that already passed for unrelated scopes or prior integrated work.
10. Every check in a fast path must be explainable from the current diff: changed file, owning scope, dependent scope, or repository-level policy owner.

## Plan Validation

This plan was checked against the current `.husky/pre-push`, `.github/workflows/ci.yml`, root `package.json` scripts, and `scripts/harness/*` behavior.

### Validated Reductions

| Current broad step                                     | Validation result                                                                                      | Target placement                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `harness:scan:dist` on every pre-push                  | Too broad. It checks every buildable package before the changed package build has necessarily run.     | Move to release/publish-grade verification and explicit full checks.        |
| `harness:verify -- --base-ref origin/main` on pre-push | Too broad for feature branches because normal development targets `develop`.                           | Resolve branch-aware base ref, defaulting feature work to `origin/develop`. |
| Full repository `typecheck` on every PR                | Correct as a release-grade gate, noisy as the default PR gate.                                         | Affected scopes plus dependents in PR; full typecheck on release-grade.     |
| Full repository `lint` on every PR                     | Too broad for docs-only, task-only, or single-package changes.                                         | Affected scopes for package/app code; targeted document scans otherwise.    |
| Full repository `test --coverage` on every PR          | Coverage thresholds on partial affected tests can be misleading, while full tests are expensive.       | Affected tests without global coverage threshold; full coverage on L4.      |
| Node 18 compatibility on every PR                      | Useful but expensive, especially for docs-only or unrelated changes.                                   | Affected compatibility for runtime/package changes; full on L4.             |
| Full `harness:scan` on every PR quality job            | Mixes publish, docs, spec, dist, file-size, dependency, and consistency checks in one failure surface. | Split into targeted governance scans plus release-grade aggregate scan.     |
| `pnpm audit` on every PR regardless of dependency diff | Valuable but unrelated to docs/source-only diffs.                                                      | Run on lockfile/package dependency changes, scheduled runs, and release.    |

### Checks That Must Remain

| Change shape                         | Required retained checks                                                                                     | Reason                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Package or app source change         | Owner build, test, lint, typecheck. Include dependents when exported API or dependency graph impact applies. | Source behavior and emitted artifacts changed.                                  |
| Public entrypoint or package exports | Owner build/typecheck and dependent import-contract/typecheck checks.                                        | Downstream packages can break even if owner tests pass.                         |
| Package dependency metadata          | Owner build/typecheck and dependent checks.                                                                  | Runtime/type dependency graph changed.                                          |
| Version-only metadata                | Publish safety and manifest consistency only.                                                                | Source-heavy checks do not add signal when only fixed-version metadata changed. |
| Test-only change                     | Owner tests and lint. Typecheck if the test is inside TypeScript project inputs.                             | Test behavior changed, but package build is usually not affected.               |
| Package docs or README change        | Package docs/spec structure checks.                                                                          | Contract discoverability changed, not runtime behavior.                         |
| Docs app/content change              | Docs structure checks and docs build when the rendered docs app can be affected.                             | Documentation output is the changed artifact.                                   |
| `.agents/tasks` change               | Test-plan scan and relevant governance scans.                                                                | Task quality rules changed, not package runtime behavior.                       |
| `.agents/rules` or `.agents/skills`  | Consistency/governance scans and any mechanical rule checks.                                                 | Agent guidance changed and can affect future work quality.                      |
| Harness script change                | Harness unit tests, dry-run plan fixtures, and representative scoped verification.                           | The verifier itself changed.                                                    |
| GitHub workflow or hook change       | Shell/YAML syntax checks where available, harness dry-run plan tests, and representative CI-plan fixtures.   | Automation behavior changed.                                                    |
| Root TS/build/lint config            | Broaden to all affected packages, or all packages when ownership cannot be inferred.                         | Compiler/build semantics can affect many packages.                              |
| `pnpm-lock.yaml` change              | Dependency-aware affected checks; broaden when the impacted package set cannot be inferred reliably.         | Resolved dependency graph changed.                                              |
| Publish script or registry rule      | Publish safety, dry-run publish path, and release-grade verification before an actual publish.               | Installability and registry correctness are release-critical.                   |

### Current Implementation Gaps

The existing harness already has useful primitives, but the plan is not safe to implement by only changing `.husky/pre-push`.

- `classifyScopeChanges()` treats any package `package.json` change as a config change, so version-only edits currently trigger build/test/lint/typecheck. The new plan needs semantic package manifest diffing.
- Test files under `src/` currently count as source changes. The new plan must classify test files before source/API files so a colocated test does not force an unnecessary package build.
- `mapFilesToScopes()` maps package/app files but leaves root, workflow, hook, harness, and `.agents` changes outside normal package verification. The new plan needs repository-level change classes, not only workspace scopes.
- `detectChangedFiles()` uses working tree changes before Git diff. That is useful locally, but test fixtures and CI plan generation need an explicit changed-file input to make behavior deterministic.
- CI currently builds all packages before quality checks. Affected CI must make build artifacts available only for scopes that need them, while release-grade CI keeps the full build path.
- GitHub required checks should remain stable aggregate job names; path filters may be used internally for decisions, but skipped required workflows must not leave PRs pending.

## Proposed Verification Levels

| Level | Name                      | Trigger                                          | Purpose                                               | Expected cost |
| ----- | ------------------------- | ------------------------------------------------ | ----------------------------------------------------- | ------------- |
| L0    | Staged file hygiene       | pre-commit                                       | Format/lint staged files                              | Very low      |
| L1    | Fast local scoped verify  | pre-push on feature/develop branches             | Validate changed scopes against the correct base      | Low-medium    |
| L2    | PR affected verification  | pull request CI                                  | Validate affected scopes and dependents               | Medium        |
| L3    | Repository governance     | PR CI, release branch, manual command            | Run harness scans and repository policy checks        | Medium-high   |
| L4    | Release-grade full verify | publish, `develop -> main`, scheduled/manual run | Run broad build/test/typecheck/lint/scenario coverage | High          |

## Base Reference Policy

| Context                          | Default comparison base                         | Notes                                               |
| -------------------------------- | ----------------------------------------------- | --------------------------------------------------- |
| Feature branch targeting develop | `origin/develop`                                | Normal local and PR development path                |
| Develop branch push              | previous `origin/develop`                       | Validates what is newly being pushed to integration |
| Main branch push                 | previous `origin/main`                          | Protected; should rarely be used directly           |
| Develop-to-main promotion        | `origin/main` or explicit release-grade command | Broad verification is intentional in this case      |
| CI pull request                  | `origin/${{ github.base_ref }}`                 | Base comes from PR metadata                         |
| Manual override                  | `HARNESS_BASE_REF` or `--base-ref`              | Always wins over inferred defaults                  |

## Change Classification Policy

| Change type                      | Suggested local verification                                            | Suggested CI verification                                  |
| -------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| Source file                      | Build, test, lint, typecheck for owner scope                            | Owner scope plus dependents where dependency graph applies |
| Test file only                   | Test and lint for owner scope; build only if under source inputs        | Owner scope tests and lint                                 |
| Docs or changelog only           | No package build/test unless docs structure or package docs rules apply | Docs/harness governance only                               |
| Version-only package metadata    | Publish safety checks, no source-heavy per-package checks               | Publish safety and manifest validation                     |
| Dependency package metadata      | Owner scope typecheck/build and dependent scope checks                  | Dependency graph expansion                                 |
| Scripts/exports package metadata | Owner scope build/typecheck                                             | Owner scope plus dependent import contract checks          |
| Root config                      | Targeted global checks based on config owner                            | Repository governance and affected package checks          |
| Lockfile                         | Dependency graph aware affected checks                                  | Broader CI, possibly all packages when impact is unknown   |
| Harness scripts/workflows        | Harness tests and dry-run verification                                  | Harness tests plus limited representative package checks   |

## Proposed Architecture

### Harness Primitives

Add reusable harness primitives instead of embedding policy in `.husky` or workflow YAML:

- base-ref resolution;
- changed file collection;
- workspace scope ownership;
- dependency graph expansion;
- change classification;
- check plan generation;
- report generation for local and CI output.

The long-term command shape should be:

```bash
pnpm harness:plan -- --base-ref origin/develop --report-file .agents/evals/local-metrics/verify-plan.json
pnpm harness:verify -- --base-ref origin/develop
pnpm harness:verify -- --release --base-ref origin/main
```

### Local Hooks

Pre-push should:

1. resolve the correct base ref;
2. generate a scoped verification plan;
3. run fast checks for changed scopes;
4. skip unrelated package checks even if those packages have historical changes between `main` and `develop`;
5. print the command for release-grade verification when broad checks are skipped.

Pre-push should not:

- always compare against `origin/main`;
- run full release-grade checks for routine feature pushes;
- repeat full repository checks merely because a package was changed in an already-integrated branch;
- hide broad verification behind an implicit hook.

### GitHub Actions

Split CI into explicit jobs:

| Job                       | Responsibility                                                      |
| ------------------------- | ------------------------------------------------------------------- |
| `detect-changes`          | Compute changed files, affected scopes, and verification plan       |
| `repository-governance`   | Run harness scans that are not package build/test/lint heavy        |
| `affected-build`          | Build affected scopes or full set when root/build config changed    |
| `affected-test`           | Test affected scopes                                                |
| `affected-typecheck-lint` | Run typecheck and lint for affected scopes                          |
| `affected-scenarios`      | Run owner scenario verification for affected scenario-owning scopes |
| `compat-node18`           | Run affected compatibility checks, full only on release-grade paths |
| `security-audit`          | Run dependency audit as an independent job                          |
| `release-grade-verify`    | Manual or promotion-only full verification                          |

### Build and Cache Strategy

- Keep pnpm store caching.
- Cache package `dist/` only when the cache key reflects source, tsconfig, package manifests, and lockfile inputs.
- Avoid requiring full `dist/` freshness for docs-only changes.
- Treat publish and release verification differently from routine PR verification.

## Incremental Migration Strategy

Do not migrate local hooks, harness planning, CI splitting, and release verification in one large change. Each migration slice must be independently testable, must preserve the current full verification escape hatch, and must prove that reduced checks still cover the current diff.

| Slice | Change                                                                    | Behavior risk                          | Required proof before merge                                                                |
| ----- | ------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------ |
| M0    | Planning and documentation only                                           | None                                   | Document review, formatting check, task-plan scan.                                         |
| M1    | Add `harness:plan` dry-run/check-plan output without changing hooks/CI    | Low; observational only                | Unit fixtures for check-plan output; no local hook or CI behavior changes.                 |
| M2    | Extract base-ref resolution into a tested harness primitive               | Low; not yet wired into hooks          | Unit tests for feature/develop/main/PR/manual override contexts.                           |
| M3    | Add semantic change classification                                        | Medium; determines what can be skipped | Unit fixtures for docs, tasks, source, tests, package manifest, lockfile, and root config. |
| M4    | Add dependency graph expansion for affected dependents                    | Medium; prevents under-verification    | Unit fixtures proving consumers are included for API/dependency-impacting changes.         |
| M5    | Migrate local pre-push to scoped fast verification                        | Medium; changes developer workflow     | Dry-run hook scenarios plus disposable commit/push verification.                           |
| M6    | Split CI into detect-plan and affected check jobs                         | High; changes remote required checks   | Draft PR scenarios for representative diffs; stable aggregate required checks preserved.   |
| M7    | Move full scan/dist/audit/coverage/compat to explicit release-grade paths | Medium; changes when broad checks run  | Release-grade workflow dry-run/manual run and develop-to-main simulation PR.               |
| M8    | Remove obsolete broad duplicate steps                                     | Medium; removes old safety net         | Comparison report showing each removed step is covered by affected or release-grade paths. |

Each slice should be its own PR unless the change is purely documentation or a small test-only precursor. If a slice fails practical verification, revert or close only that slice without blocking the remaining migration plan.

## Verification Scenarios

Each migration slice must define executable scenarios before changing behavior. Scenarios should use the cheapest reliable mechanism first, then escalate to real GitHub PR validation only when hook or Actions behavior must be observed.

### Scenario Format

Every scenario should record:

- name and migration slice;
- fixture branch name;
- changed files or temporary commit shape;
- expected check plan;
- commands or PR action used to validate;
- observed result;
- cleanup action;
- whether the scenario is safe to automate later.

### Local Dry-Run Scenarios

| Scenario              | Fixture change                                     | Expected result                                                                  |
| --------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| docs-only             | Modify a package `README.md` or docs file          | Package build/test/lint/typecheck skipped; docs/spec governance selected.        |
| task-only             | Modify `.agents/tasks/*.md`                        | Task-plan/governance scan selected; package checks skipped.                      |
| single package source | Modify one package `src/**/*.ts`                   | Owner build/test/lint/typecheck selected; unrelated packages skipped.            |
| colocated test-only   | Modify `src/**/*.test.ts` without production files | Owner test/lint selected; build skipped unless TS project inputs require extra.  |
| version-only metadata | Modify only package `version` field                | Publish/manifest safety selected; source-heavy checks skipped.                   |
| dependency metadata   | Modify package dependency fields                   | Owner build/typecheck and dependent checks selected.                             |
| public export change  | Modify `src/index.ts` or package `exports`         | Owner and dependent import/typecheck checks selected.                            |
| root config           | Modify root TS/build/lint config                   | Broadened affected or full package verification selected according to owner map. |
| lockfile              | Modify `pnpm-lock.yaml`                            | Dependency-aware affected checks selected; full check if impact is unknown.      |
| harness script        | Modify `scripts/harness/**`                        | Harness unit tests and representative dry-run plan checks selected.              |
| workflow/hook         | Modify `.github/workflows/**` or `.husky/**`       | CI/hook plan tests and syntax validation selected.                               |

### Disposable Commit and PR Scenarios

Some behavior cannot be trusted from static unit tests alone. Hook execution, Git diff base selection, and GitHub Actions job fan-out should be validated with disposable branches.

Use this workflow only for verification branches:

1. Start from an updated `develop`.
2. Create a disposable branch such as `test/scoped-verification-docs-only` or `test/scoped-verification-single-package`.
3. Apply the smallest fixture change for one scenario.
4. Create a temporary commit with an explicit test-only message.
5. Run the local verification command or hook path.
6. Push the disposable branch when remote CI behavior must be observed.
7. Open a draft PR against `develop` only when GitHub Actions behavior is the thing being tested.
8. Record the resulting check plan, job selection, elapsed time, and any skipped broad checks.
9. Close the draft PR without merging.
10. Delete the disposable remote branch and return to the real feature branch.

Disposable PR scenarios must not target protected release flows unless the scenario is specifically validating `develop -> main` release-grade behavior. They must not be merged. They exist to verify automation behavior and should be cleaned up immediately after the observations are recorded.

### Required End-to-End Scenarios

| Migration slice | Required practical scenario                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| M1              | Generate a check plan from explicit changed-file fixtures without reading the working tree.                         |
| M2              | On a disposable feature branch, prove the inferred base is `origin/develop`, not `origin/main`.                     |
| M3              | Create temporary commits for docs-only, version-only metadata, test-only, and source changes; compare plans.        |
| M4              | Create a fixture where a shared package API changes; prove dependent scopes are selected.                           |
| M5              | Run the pre-push path for docs-only and single-package changes; confirm unrelated package checks do not run.        |
| M6              | Open draft PRs for docs-only, single-package source, root config, and lockfile scenarios; confirm CI job fan-out.   |
| M7              | Run or simulate release-grade verification and prove broad scan/dist/audit/coverage/compat checks still exist.      |
| M8              | Compare old broad steps to new affected/release-grade steps and document why each removed routine check is covered. |

Scenario results should be added to the task file before each slice is merged. If a scenario requires a temporary commit or draft PR, the task file should include the branch name, PR number if one was opened, observed check plan, cleanup status, and residual risk.

## TDD Plan

### Unit Tests

- Given a feature branch context, when no explicit base is supplied, then base resolution selects `origin/develop`.
- Given `HARNESS_BASE_REF`, when base resolution runs, then the explicit env base wins.
- Given a develop-to-main release context, when release mode is requested, then the plan uses `origin/main`.
- Given an explicit changed-file list fixture, when plan generation runs, then it does not read `git status`.
- Given only `CHANGELOG.md` changes, when a check plan is generated, then source-heavy checks are skipped.
- Given only a package `version` field changes, when a check plan is generated, then publish safety runs but build/test/lint are skipped.
- Given package `dependencies`, `peerDependencies`, `bin`, `main`, or `exports` changes, when a check plan is generated, then owner and dependent checks are selected.
- Given a colocated `src/**/*.test.ts` change, when a check plan is generated, then owner tests and lint run but owner build is not selected unless exported source files also changed.
- Given dependency fields change, when a check plan is generated, then dependent scopes are included.
- Given root TypeScript or build config changes, when a check plan is generated, then affected checks broaden according to the documented policy.
- Given `.agents/tasks/**` changes, when a check plan is generated, then task-plan/governance scans are selected and package build/test checks are skipped.
- Given harness script changes, when a check plan is generated, then harness unit tests and dry-run fixture checks are selected.
- Given a docs app/content change, when a check plan is generated, then docs validation/build checks are selected.

### Integration Tests

- Run `harness:verify -- --dry-run` for synthetic changed-file fixtures.
- Run `harness:plan -- --changed-file <path>` or equivalent fixture input for each change class without relying on the current worktree.
- Run a pre-push dry-run fixture that proves the hook does not hardcode `origin/main`.
- Run CI plan generation for representative PR shapes:
  - docs-only;
  - single package source change;
  - shared package source change;
  - release version/changelog changes;
  - root config change.

## Migration Plan

### Phase 1: Plan and Observability

- Add this plan.
- Add a harness plan command that reports what would run without executing checks.
- Add tests around current classification gaps.

### Phase 2: Local Hook Reduction

- Change pre-push to use harness base-ref resolution.
- Add a fast local mode for changed scopes.
- Keep an explicit release-grade command for broad checks.

### Phase 3: CI Split

- Add a `detect-changes` job.
- Split repository governance, affected verification, compatibility, and audit jobs.
- Keep full verification available as a manual or promotion-only workflow.

### Phase 4: Dependency Graph Expansion

- Add package dependency graph expansion to affected-scope planning.
- Include dependents for source/API-affecting package changes.
- Keep docs/version-only metadata scoped narrowly.

### Phase 5: Release Path

- Define the exact verification path for `develop -> main` and npm publish.
- Ensure release broadness is intentional, visible, and not accidentally applied to every feature push.

## Open Questions

- Should version-only package manifest changes be detected by JSON diff or by changeset context?
- Should CI keep coverage thresholds on affected tests only, or should coverage remain full-repo on release-grade paths?
- Should `harness:scan:dist` move out of pre-push and into release-grade verification only?
- Should compatibility checks run for affected scopes, all public packages, or only packages declaring Node 18 support?
- Should GitHub required checks be stable aggregate jobs to avoid pending checks when path filters skip work?

## References

- GitHub Actions workflow path and branch filters: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- Nx affected tasks: https://nx.dev/docs/features/ci-features/affected
- Turborepo affected run mode: https://turborepo.dev/docs/reference/run
- pnpm filtering selectors: https://pnpm.io/filtering
