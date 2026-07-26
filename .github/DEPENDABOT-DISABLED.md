# Dependabot is DISABLED — deliberately, by owner decision

**Do NOT re-create `.github/dependabot.yml` without explicit owner approval.**

Dependabot version updates were turned off on **2026-07-25** by removing `.github/dependabot.yml`.
The absence of that file is the mechanism: Dependabot does nothing without it.

## Why

Its PR stream repeatedly interrupted in-flight work. Individual major-version PRs arrived faster than
they could be triaged, several landed on `main` outside the `feature → develop → main` flow (leaving
`main` with dependency bumps `develop` lacked), and unbounded version ranges in regenerated lockfiles
twice crossed a major and broke the build (see `INFRA-044`, and the `brace-expansion` / `js-yaml`
override incidents).

## What did NOT change — dependency risk is still covered

Removing Dependabot removed **automated update PRs only**, not vulnerability detection:

- **`dependency audit` (osv-scanner) in `.github/workflows/ci.yml`** is a REQUIRED check and still scans
  the whole lockfile on every PR. Every advisory handled on 2026-07-25 —
  `builder-util-runtime` (credential leak), `postcss` (path traversal), `tar` (recursion DoS),
  `brace-expansion` — was caught by that job, not by Dependabot.
- **`Dependency Review`** still gates newly-introduced dependencies by vulnerability and license.
- **CodeQL** still runs; `SEC-003` tracks its alert backlog.
- **Repo-level Dependabot security updates were already `disabled`** before this change.

So the workflow is now: the scanners report, and a human or agent applies a **bounded** `pnpm.overrides`
entry deliberately — the practice that fixed every advisory this session.

## If you want it back

Re-enabling requires **explicit owner approval**, recorded in the PR that does it. Whoever re-enables it
must also address what made it disruptive in the first place:

1. `target-branch: develop` — never let it open PRs against `main`.
2. Group majors too, or `ignore` them entirely; ungrouped major PRs were the main source of noise.
3. Keep `open-pull-requests-limit` low.
4. Never accept a regenerated lockfile with an **unbounded** override range (`>=X` with no upper
   bound) — that is what crossed majors and broke builds twice.

Delete this file in the same PR that re-enables it, so the two states cannot both look current.
