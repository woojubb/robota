# Dependabot is DISABLED — deliberately, by owner decision

**Do NOT re-create `.github/dependabot.yml` without explicit owner approval.**

Dependabot version updates were turned off on **2026-07-25** by removing `.github/dependabot.yml`.
The absence of that file is the mechanism: Dependabot does nothing without it.

## Why

Its PR stream repeatedly interrupted in-flight work. Individual major-version PRs arrived faster than
they could be triaged, several landed on `main` outside the `feature → develop → main` flow (leaving
`main` with dependency bumps `develop` lacked), and unbounded version ranges in regenerated lockfiles
twice crossed a major and broke the build (see the `brace-expansion` / `js-yaml`
override incidents).

## What did NOT change — secret scanning and code analysis

Removing Dependabot removed **automated update PRs only**:

- **`security` in `.github/workflows/ci.yml`** is a required context (see
  `.github/required-status-checks.json`). It passes when the **Secret Scan** (gitleaks,
  `.github/workflows/gitleaks.yml`) over the pull request's commits passes.
- **CodeQL** analyzes pushes to `develop` and `main`; it is not a required context.
- No CI job scans the lockfile for known dependency vulnerabilities.
- **Repo-level Dependabot security updates were already `disabled`** before this change.

So a dependency advisory is handled by a human or agent applying a **bounded** `pnpm.overrides`
entry deliberately (see the root `package.json`).

## If you want it back

Re-enabling requires **explicit owner approval**, recorded in the PR that does it. Whoever re-enables it
must also address what made it disruptive in the first place:

1. `target-branch: develop` — never let it open PRs against `main`.
2. Group majors too, or `ignore` them entirely; ungrouped major PRs were the main source of noise.
3. Keep `open-pull-requests-limit` low.
4. Never accept a regenerated lockfile with an **unbounded** override range (`>=X` with no upper
   bound) — that is what crossed majors and broke builds twice.

Delete this file in the same PR that re-enables it, so the two states cannot both look current.
