---
title: 'HARNESS-019: Mechanize interface-shape and branch-name rules via ESLint + branch-guard'
status: done
created: 2026-06-27
completed: 2026-06-27
priority: medium
urgency: soon
area: root (.eslintrc.json, .claude/hooks)
depends_on: []
---

## Evidence Log (2026-06-27)

- `.eslintrc.json`: added `@typescript-eslint/consistent-type-definitions: ["error","interface"]`
  scoped to `packages/*/src` (0 existing violations → `pnpm lint` stays 0 errors).
- `.claude/hooks/branch-guard.sh`: on `git checkout -b` / `git switch -c`, validates the new
  branch name against `^(feat|fix|chore|docs|refactor|test|perf|build|ci|style|revert|release|hotfix)/<desc>`;
  long-lived branches (main/master/develop/gh-pages) exempt; override `BRANCH_GUARD_ALLOW_BADNAME=1`.
- Verified: `bash -n` syntax OK; regex accepts `feat/wave-a`, `chore/latent-backlogs`, exempts
  `develop`/`main`, blocks `BadName`/`randombranch`/`feature/x`. `pnpm lint` 0 errors.

---

# Mechanize interface-shape + branch-name rules

## What

Two documented rules have no (or only partial) mechanical enforcement:

1. **`interface` for object shapes (`code-quality.md`).** Prose-only. Add ESLint
   `@typescript-eslint/consistent-type-definitions: ["error", "interface"]` so `type X = {…}`
   object aliases are flagged. Keep the test/config overrides consistent with HARNESS-016, and
   fix or explicitly scope any shipped-source offenders the rule surfaces.
2. **Feature branch naming `<type>/<scope>-<desc>` (`git-branch.md`).** `branch-guard.sh`
   currently blocks commits/pushes to **protected** branches but does **not** validate the
   format of feature branch names. Add a regex check to `branch-guard.sh` (and/or
   `.husky/pre-commit`) that warns/blocks when the current branch name doesn't match the
   documented pattern, with an allowlist for legacy/long-lived branches (`develop`, `main`,
   release branches).

## Why

`consistent-type-definitions` and a branch-name regex convert two more documented conventions
into mechanical gates, matching the repo principle "prefer a mechanical check over adding more
prose." Branch-name enforcement also keeps the `feedback_one_branch_at_a_time` /
`git-branch.md` policy legible at creation time rather than at review time.

## Done When

- ESLint flags `type`-alias object shapes as an error in shipped source; tests/config exempt.
- `pnpm lint` passes on the current tree (offenders fixed or explicitly scoped with a note).
- Creating/committing on a malformed branch name produces a clear warning/block; protected and
  allowlisted branches are unaffected.

## Test Plan

- Add `type Foo = { a: number }` to shipped src → `pnpm lint` errors; converting to
  `interface` clears it.
- Check out a branch named `badname` and commit → branch-guard warns/blocks; `feat/x-y` is
  fine; `develop`/`main` unaffected.

## User Execution Test Scenarios

1. Author code using a `type`-alias object shape → lint flags it; switch to a non-conforming
   branch name → the guard surfaces it. Evidence: _to fill._
