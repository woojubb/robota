# Scoped Verification Hooks and CI

## What

Reduce local hook and CI verification cost by running checks against the actual affected scopes and the correct merge base instead of repeatedly validating unrelated packages during commits, pushes, and pull requests.

## Why

Large integration and release work showed that the current push and CI verification path can be too broad. A branch containing many package version or changelog updates caused hook verification to run build, test, lint, typecheck, and scenario checks for many packages that were not meaningfully affected by the current task.

The result is slow feedback, noisy output, long waits on routine work, and a higher chance that unrelated existing warnings distract from the change being pushed.

This backlog item is explicitly about developer feedback latency as well as correctness. Normal development should not repeatedly wait for full repository build, lint, typecheck, test, dist, audit, and compatibility checks when the current diff only affects one package, a task document, package version metadata, or docs.

## Current Findings

- `.husky/pre-push` always runs:
  - `pnpm harness:scan:dist`
  - `pnpm harness:verify -- --base-ref origin/main`
- Using `origin/main` as the default pre-push base is too broad for normal feature branches that target `develop`.
- `scripts/harness/verify-change.mjs` already has scope detection and per-scope classification, but package manifest and config changes can still expand verification heavily.
- `.github/workflows/ci.yml` currently runs broad repository checks:
  - full build cache setup,
  - full typecheck,
  - full lint,
  - full harness scan,
  - full test with coverage,
  - Node 18 compatibility tests.

## Research Required

Before implementation, review common CI and hook strategies for large TypeScript monorepos and coding assistant projects. The research should cover:

- affected-package detection using changed files and package dependency graphs;
- local pre-push vs CI responsibilities;
- fast local checks vs authoritative CI checks;
- matrix splitting by package group or check type;
- release branch and develop-to-main promotion behavior;
- how to avoid hiding real breakage while reducing irrelevant checks.

Initial planning lives in `.agents/specs/verification-pipeline-plan.md`.

## Scope

- Redesign `.husky/pre-push` so it uses a branch-appropriate base ref.
- Keep local hooks fast enough for frequent pushes.
- Keep commit, push, and PR update feedback focused on the modified files, owning scopes, and real dependent scopes.
- Migrate behavior in small independently testable slices instead of changing hooks, CI, and release gates all at once.
- Preserve an explicit way to run full verification before release.
- Split CI jobs so independent checks can run in parallel and report separately.
- Consider affected-scope CI jobs for build, test, lint, and typecheck.
- Ensure scenario verification runs only for owner scopes and relevant source/config/scenario changes unless explicitly requested.
- Document when to use local scoped verification, full harness scan, and release-level verification.

## Non-Goals

- Do not remove the ability to run full verification.
- Do not suppress failures from scopes that are actually affected.
- Do not make CI depend only on local hooks.
- Do not hardcode one branch topology into reusable harness scripts.

## Acceptance Criteria

- [ ] Pre-push verification uses the correct comparison base for feature branches targeting `develop`.
- [ ] Develop-to-main promotion and release flows have a documented verification mode that is intentionally broad.
- [ ] Package-only metadata changes do not unnecessarily run source-heavy checks unless dependency or publish safety rules require them.
- [ ] Routine commit/push/PR checks avoid repeated full-repository work when the current diff has a narrow affected set.
- [ ] Fast-path output explains which changed files or policy owners caused each retained check to run.
- [ ] Each migration slice has unit or dry-run scenarios before behavior changes are merged.
- [ ] Hook and GitHub Actions behavior is verified with disposable commit/PR scenarios where static tests are insufficient.
- [ ] Disposable verification branches and draft PRs are closed or deleted after observations are recorded.
- [ ] CI jobs are split so failures identify the check category and affected scope more clearly.
- [ ] Affected-scope detection is covered by unit tests for source, test, docs, package manifest, changeset, and root config changes.
- [ ] Documentation explains which command developers should run for fast local checks and which command is release-grade.

## Risks & Mitigations

| Risk                                  | Mitigation                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| Scoped checks miss cross-package bugs | Include dependency graph expansion for packages that consume changed packages |
| Release verification becomes too weak | Keep a separate full verification path for release and main promotion         |
| CI becomes harder to understand       | Name jobs by check type and scope set; write concise docs                     |
| Hook behavior diverges from CI        | Reuse harness primitives for both local hooks and CI commands                 |

## Promotion Path

1. Move or link this item to `.agents/tasks/INFRA-BL-010-scoped-verification-hooks.md`.
2. Research current monorepo CI patterns and compare with existing harness capabilities.
3. Update harness docs and tests before changing hook behavior.
