# INFRA-BL-010 Scoped Verification Hooks

- **Status**: in-progress
- **Created**: 2026-05-01
- **Branch**: chore/scoped-verification-hooks
- **Scope**: .husky, .github/workflows, scripts/harness, .agents/backlog

## Objective

Reduce local commit, pre-push, PR, and CI verification latency by making checks scope-aware, base-ref-aware, and clearly separated between fast local feedback and release-grade verification.

## Plan

- [x] Capture the problem and desired direction in backlog.
- [x] Inspect current pre-push, harness verify, and CI workflow behavior.
- [x] Create a planning document that discusses hooks, CI, build, actions, and harness verification together.
- [x] Research common monorepo CI/hook strategies and compare them with the current harness.
- [x] Define and validate the target verification matrix and branch-base policy.
- [x] Add incremental migration slices and scenario verification requirements to the plan.
- [x] Complete M1: add fixture-driven `harness:plan` observability without changing hooks or CI.
- [x] Complete M2: extract tested base-ref resolution before changing pre-push.
- [x] Complete M3: add semantic package/test/repository change classification.
- [x] Complete M4: add workspace dependent expansion for public entrypoint and dependency-impacting changes.
- [x] Complete M5: migrate pre-push to scoped fast verification.
- [x] Complete M6-M8: split PR CI fast path from release-grade verification and keep full release verification explicit.
- [x] Run targeted verification and document the new workflow.

## Progress

### 2026-05-01

- Created branch `chore/scoped-verification-hooks` from updated `develop`.
- Confirmed `.husky/pre-push` always uses `origin/main` as the `harness:verify` base.
- Confirmed `scripts/harness/verify-change.mjs` already has changed-file scope detection and classification.
- Confirmed `.github/workflows/ci.yml` runs broad repository-level typecheck, lint, harness scan, and tests.
- Added backlog item for scoped hooks and CI verification.
- Added `.agents/specs/verification-pipeline-plan.md` as the cross-cutting planning document for local hooks, harness verification, GitHub Actions CI, build, and release verification.
- Validated the plan against current hook, CI, package script, dist freshness, publish safety, and harness classification behavior.
- Added explicit validated reductions, required retained checks, and current implementation gaps to the plan.
- Added developer feedback latency as an explicit planning goal for commit, push, and PR update workflows.
- Added slice-by-slice migration requirements and scenario verification rules, including disposable commit/PR validation for hook and GitHub Actions behavior.
- Fixed a stale `parseScopeArgs` default-value test so current harness tests have a clean baseline.
- Added `pnpm harness:plan` with explicit `--changed-file` fixture input and JSON/Markdown report support.
- Added unit tests for fixture parsing, changed owner scope plan generation, root/policy file visibility, and summary rendering.
- Extracted `resolveBaseRef` as a tested harness primitive and connected `detectChangedFiles` to it without changing hook or CI behavior.
- Added semantic package manifest classification for version-only, dependency, public surface, script/build, publish metadata, and unknown package manifest changes.
- Changed colocated `src/**/*.test.ts` classification so test-only changes no longer trigger package build by being mistaken for production source.
- Added workspace dependency discovery and dependent-scope typecheck expansion for public entrypoint and dependency-impacting changes.
- Refactored `harness:verify` to execute the shared verification plan, including executable repository-level checks.
- Replaced `.husky/pre-push` with `pnpm harness:pre-push`, which resolves the branch base, prints the plan, runs affected verification, and points release work to `pnpm harness:verify:release`.
- Split PR CI into affected verification and dependency audit fast paths, with release-grade full verification and Node 18 compatibility limited to `main`-targeted promotion PRs.

## Scenario Results

### M1 Plan Observability

- **Scenario**: explicit changed-file fixture for one package source file plus one task document.
- **Command**: `pnpm harness:plan -- --changed-file packages/agent-core/src/index.ts --changed-file .agents/tasks/example.md`
- **Observed plan**: selected `packages/agent-core` checks `build`, `test`, `lint`, and `typecheck`; kept `.agents/tasks/example.md` visible under repository checks.
- **Hook/CI impact**: none. Existing `.husky` and GitHub Actions behavior was not changed in M1.
- **Cleanup**: no disposable branch or PR required for this observational slice.

### M2 Base Ref Resolution

- **Scenario**: pure base-ref decision fixtures for explicit override, `HARNESS_BASE_REF`, GitHub PR base, feature branch default, main fallback, and no available refs.
- **Command**: `pnpm exec vitest run scripts/harness/__tests__/harness-scripts.test.mjs`
- **Observed result**: explicit/manual override wins; PR context prefers `origin/${GITHUB_BASE_REF}`; feature branch default prefers `origin/develop`; `main` is only a fallback when develop refs are unavailable.
- **Hook/CI impact**: none. The pre-push hook still has its existing command until the M5 slice.
- **Cleanup**: no disposable branch or PR required for this primitive extraction.

### M3 Semantic Change Classification

- **Scenario**: unit fixtures for version-only package metadata, dependency metadata, public surface metadata, production source files, and colocated test files.
- **Command**: `pnpm exec vitest run scripts/harness/__tests__/harness-scripts.test.mjs scripts/harness/__tests__/check-plan.test.mjs`
- **Observed result**: version-only metadata skips source-heavy package checks and selects publish safety; dependency metadata selects build/typecheck without test/lint; colocated test files skip build.
- **Cleanup**: no disposable branch or PR required.

### M4 Dependent Expansion

- **Scenario**: public entrypoint change in `packages/agent-core`.
- **Command**: `pnpm harness:plan -- --changed-file packages/agent-core/src/index.ts`
- **Observed result**: owner package selects build/test/lint/typecheck and dependent workspaces select typecheck.
- **Cleanup**: no disposable branch or PR required.

### M5 Scoped Pre-Push

- **Scenario**: run the actual pre-push entrypoint on this branch's current docs/harness/workflow changes.
- **Command**: `pnpm harness:pre-push`
- **Observed result**: base resolved to `origin/develop`; no full `dist` freshness, full build, full lint, full typecheck, or full test ran. The hook executed harness tests, consistency scan, and test-plan scan because the current diff changes harness/workflow/task files.
- **Cleanup**: no disposable branch or PR required for local hook verification.

### M6-M8 CI and Release-Grade Split

- **Scenario**: local plan fixtures for task-only, single package source, harness script, and workflow changes.
- **Commands**:
  - `pnpm harness:plan -- --changed-file .agents/tasks/example.md`
  - `pnpm harness:plan -- --changed-file packages/agent-core/src/agent.ts`
  - `pnpm harness:plan -- --changed-file scripts/harness/shared.mjs`
  - `pnpm harness:plan -- --changed-file .github/workflows/ci.yml`
- **Observed result**: task-only selects `task-plan-scan`; single package source selects only owner package checks; harness/workflow changes select harness tests and consistency scan.
- **Remote CI note**: no disposable draft PR was opened in this slice. The workflow file was formatted and the same harness commands used by CI were exercised locally. A draft PR can still be used before merging if GitHub job fan-out needs live observation.
- **Cleanup**: no remote branch or PR was created.

## Test Plan

The implementation phase must start with unit tests for base-ref resolution, changed-file fixture input, semantic package manifest classification, test-only versus source/API classification, root-level change classes, and dependency graph expansion. Integration coverage must include dry-run harness plan fixtures for docs-only, single package source, shared package source, release version/changelog, root config, harness script, and workflow/hook changes.

Before changing hook or CI behavior, each migration slice must have a documented scenario. Static harness behavior should be verified with fixture-based dry runs. Hook execution, Git base-ref behavior, and GitHub Actions fan-out should additionally be verified with disposable branches, temporary commits, and draft PRs when needed. Those verification PRs must be closed without merging and their branches deleted after observations are recorded.

## Decisions

- Local push checks should be fast and relevant to the branch target.
- Routine commit, push, and PR update checks should not repeat full-repository work unless the current diff has repository-wide impact.
- Migration should proceed slice by slice; do not combine harness planning, local hook changes, CI splitting, and release-grade changes in one large behavioral PR.
- Release or develop-to-main promotion checks may remain broader, but they must be explicitly documented as release-grade verification.
- Harness primitives should be reused by hooks and CI instead of creating separate ad hoc path filters.
- Implementation should not start until the planning document is reviewed and the target verification levels are agreed.

## Blockers

None.

## Result

Implemented through M8 on branch `chore/scoped-verification-hooks`. Remaining risk is live GitHub Actions fan-out behavior, which requires a pushed branch or disposable draft PR to observe remotely.
