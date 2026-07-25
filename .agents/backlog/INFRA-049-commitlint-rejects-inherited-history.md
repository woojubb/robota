---
title: 'INFRA-049: commitlint fails any PR that merges another branch, judging inherited commits'
status: todo
created: 2026-07-26
priority: medium
urgency: soon
area: .github/workflows/ci.yml, commitlint.config.js
depends_on: []
---

# INFRA-049: commitlint judges commits the PR did not author

## Problem

The `commitlint` job runs `commitlint --from origin/<base> --to HEAD`. For a normal feature PR that is
exactly right. But for a PR that **merges another branch**, the range includes every commit that branch
carries — commits the PR author never wrote and cannot rewrite.

Observed on **#1415** (`main` → `develop` back-merge, 2026-07-26): the job failed on

- Dependabot commit **bodies** (`Bumps [lucide-react](https://github.com/…) from 0.525.0 to 1.26.0.`),
- and an already-merged repo commit whose subject is 126 chars
  (`refactor(harness): HARNESS-DIET-003 remainder — …  (#1302)`).

Both are **already on `main`**, i.e. already merged and unchangeable. Locally
`commitlint --from origin/develop --to HEAD` exits **0** on the same branch — CI sees a different set
because it fetches the base with `--depth=50`, so this also reproduces the "green locally, red in CI"
class HARNESS-045 exists to catch.

The failure is structural: **any** `main → develop` sync, and any PR that merges a long-lived branch,
will hit it. Rewriting inherited history to satisfy a lint is not an option.

## What

Pick one (they are not exclusive):

1. **Scope the range to the PR's own commits.** Use the merge-base and exclude commits reachable from
   the merged-in branch — e.g. lint `--from <merge-base>` while skipping second-parent history, or lint
   only the commits GitHub attributes to the PR (`gh pr view --json commits`).
2. **Ignore commits the repo cannot author.** `commitlint` supports `ignores` — exempt merge commits and
   bot-authored commits (`Bumps [...]` bodies come from Dependabot). Note the config already disables
   `body-max-line-length` / `footer-max-line-length` for a related reason, so this is consistent with
   existing intent.
3. **Fetch enough history** that CI and local agree (`--depth` is currently 50) — necessary regardless,
   since a shallow base is what made the two disagree.

Whichever is chosen, keep the gate meaningful for commits the PR **does** author: the point is to stop
judging inherited history, not to weaken the rule.

## Test Plan

Red-first: a branch that merges another branch containing a >100-char subject must FAIL under today's
config and PASS after the fix, while a PR whose **own** commit has a >100-char subject must still FAIL.
Verify CI and local `commitlint` agree on the same branch (the HARNESS-045 mirror should cover it).
