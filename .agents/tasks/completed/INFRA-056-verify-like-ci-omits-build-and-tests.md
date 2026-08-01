---
id: INFRA-056
title: verify-like-ci is named as the CI mirror but runs neither build nor the package tests
status: done
priority: high
type: INFRA
created: 2026-07-26
completed: 2026-07-26
---

## Problem

`pnpm harness:verify-like-ci` is referred to across the harness — in rules, in skills, and in the
prompts that dispatch implementation agents — as **the** CI-equivalent verification entry point: the
one command that reproduces what CI asserts. Its five stages were:

| Stage                  | What it actually ran                                  |
| ---------------------- | ----------------------------------------------------- |
| `harness-self-test`    | `pnpm harness:test` — the **harness scan** test suite |
| `format-check`         | prettier over changed files                           |
| `scan-suite`           | the scan suite on a built tree                        |
| `scan-suite-dist-free` | the scan suite on a dist-free worktree                |
| `typecheck`            | `pnpm typecheck`                                      |

**It ran neither `pnpm build` nor any package's test suite.** CI runs both — `build` and `quality`
are required status checks. So the command every agent is told is "the CI mirror" omitted the two
gates most likely to catch a functional regression, and `harness-self-test`'s name invited the
reading that package tests were covered when only the harness's own tests were.

## How it surfaced

A `HARNESS-049` increment proposed replacing four hardcoded verification commands in a skill with a
pointer to "the project's CI-equivalent verification entry point" — a change that reads as a
strengthening, since it removes duplicated command names. An independent `proposal-reviewer` caught
that it was a **loss**: the four commands included the package test suite, and the entry point did
not. The gate would have silently stopped running tests.

## Decision — option 1: make the name true

Rejected option 2 (rename + a separate full-CI entry point). The decisive argument is not diff size,
it is single-source-of-truth: every skill deliberately routes through the neutral phrase "the
project's CI-equivalent verification entry point" rather than a command name, so a second entry point
puts the strength of every gate in the hands of whichever name each skill author picked — and the
weaker, faster one wins. The name had to become true instead.

**"CI-equivalent" means `protect-develop`**, the ruleset a feature branch's PR must satisfy. A
promotion to `main` is a different gate: `protect-main`'s substantive required context is
`release-grade verification`, whose entry point is the pre-existing `pnpm harness:verify:release`.
Both statements are now in `git-branch.md`.

### Stages added

| Stage                | Mirrors                                              | Gated on (CI's own condition)                      |
| -------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| `build`              | `ci.yml → build` (+ the in-job builds of two others) | plan needs dist, OR code changed, OR dist absent   |
| `affected-verify`    | `ci.yml → quality → Verify affected quality checks`  | always (self-scoping; 0.6s no-op when nothing hit) |
| `binary-e2e`         | `ci.yml → quality → Binary e2e`                      | plan needs dist                                    |
| `commitlint`         | `ci.yml → commitlint`                                | always                                             |
| `examples-typecheck` | `ci.yml → examples-typecheck`                        | `changes.code == true`                             |
| `tui-e2e`            | `ci.yml → tui-e2e`                                   | `changes.code == true`                             |

Stage order was changed so every dist-free stage runs first: a prettier violation or a bad commit
subject now surfaces in seconds rather than behind the minutes-long build and PTY suites.

`security audit` and `windows-shell` are declared **NOT_MIRRORED** with a reason and a manual
command, and printed in every summary — loudly when the diff touches a manifest or the lockfile. An
entry point that quietly drops a required check is this item's own defect.

### Fail-opens found and fixed on the way

- **`detectChangedFiles` returned early on a dirty tree** and never consulted the base-ref diff. CI
  never takes that path (it checks out clean), so the divergence was silent and in the UNDER-counting
  direction: one dirty untracked scratch file made a branch full of package-source commits plan zero
  scopes and exit 0. `affected-verify` would have inherited it. It now returns the UNION, and a dirty
  tree no longer excuses base-ref resolution.
- **`--only` still printed "PASS — all N CI-mirroring stage(s) passed"**, so `--only format-check`
  produced a full CI-equivalence claim from one prettier run. A partial run now prints
  `PARTIAL — this is NOT a CI-equivalent result` and names the stages it skipped.
- **The build predicate was duplicated.** `PACKAGE_DIST_CHECKS` / `planRequiresPackageDist` now have
  one implementation in `check-plan.mjs`, pinned by test to the literal `ci.yml` still inlines.

## Anti-drift mechanism

`.github/required-status-checks.json` (the INFRA-055 declaration) gained a `branches.develop` entry.
`scripts/harness/ci-mirror-map.mjs` declares the stage↔job↔**step** map, and
`__tests__/ci-mirror-map.test.mjs` asserts offline that:

1. every required context is mirrored by a stage or declared un-mirrorable with a reason;
2. every command-executing **step** of every mirrored job is claimed by a stage or declared CI
   plumbing with a reason;
3. no stage claims a context, job or step `ci.yml` does not have.

The pin is deliberately step-level. A context-level pin is satisfied by mapping `quality →
affected-verify` while `quality`'s other two run-steps go unmirrored — it would certify coverage that
does not exist, which is this item's defect wearing a test.

`scan-main-required-checks.mjs --live` now reconciles **both** branches against their live rulesets
(`RECONCILED_BRANCHES`), so the declaration cannot silently fall behind `protect-develop` either.
`.github/workflows/ruleset-drift.yml` already invokes it, so no workflow change was needed.

## Evidence

**Red/green, on one tree.** `DEFAULT_KILL_GRACE_MS` in `packages/agent-process` changed 2000 → 2500:
type-clean, builds, and fails that package's own test — the functional regression CI's `quality` job
rejects.

- Pre-fix entry point (`origin/develop`, tree stashed to exactly that state + the regression):
  `PASS — all 5 CI-mirroring stage(s) passed.` in 23s.
- Fixed entry point, identical tree:
  `FAIL — affected-verify — 1 affected scope(s): packages/agent-process`.

**The anti-drift test fires.** Deleting the `affected-verify` stage turns
`ci-mirror-map.test.mjs` RED with: _"ci.yml's REQUIRED job `quality` runs step(s) that no
verify-like-ci stage reproduces: Verify affected quality checks."_

**Live reconciliation fires.** A bogus context added to `branches.develop` is reported as
_"declares it required on `develop`, but the LIVE ruleset does not require it."_

**`detectChangedFiles` red-first.** The three new union/fail-closed tests failed against the
pre-fix helper and pass after.

## Cost, measured on a 16-core Linux dev box

| Branch shape                                        | Before | After     |
| --------------------------------------------------- | ------ | --------- |
| markdown-only                                       | ~20s   | ~20s      |
| any other (incl. `scripts/harness`, `package.json`) | ~20s   | **3m40s** |

Breakdown of the added time: `pnpm build` 1m37-1m45s (not incremental), `tui-e2e` 1m33s,
`examples-typecheck` 1.4s, `affected-verify` proportional to the affected packages' suites.

**This is a real finding, not a footnote.** `classify-changed-paths` classifies any non-markdown path
as CODE, so a harness-only branch pays the full 3m40s. The mitigation is the ordering (cheap stages
fail first) and the fact that any such branch had to build anyway. The hollowing risk lives in
`--only`, which is why the PARTIAL wording was added in the same change.

## Follow-ups (not blockers)

- `ci.yml`'s "Detect build requirement" step still inlines `checksRequiringPackageDist` in a heredoc
  instead of importing `planRequiresPackageDist`. Pinned by test; the call-site swap needs a
  workflow-file owner.
- `scan-dist-freshness.mjs` checks dist **presence**, not freshness, so a stale `dist` still passes
  it. The `build` stage now covers this in practice; a content-hash stamp is the real fix.
- `.agents/specs/harness-composition-design.md` (lines ~101-107) records "the repo's CI-equivalent
  entry point has no test and no build stage" as measured fact. That is now false and needs the
  specs owner.

## References

- `scripts/harness/verify-like-ci.mjs`, `scripts/harness/ci-mirror-map.mjs`
- `scripts/harness/__tests__/ci-mirror-map.test.mjs` (the anti-drift pin)
- `.github/required-status-checks.json` → `branches.develop`
- `.agents/rules/git-branch.md`, `.agents/rules/verification.md`
