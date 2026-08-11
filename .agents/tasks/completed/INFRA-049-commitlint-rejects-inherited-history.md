---
title: 'INFRA-049: commitlint fails any PR that merges another branch, judging inherited commits'
status: done
created: 2026-07-26
completed: 2026-07-26
priority: medium
urgency: soon
area: .github/workflows/ci.yml
depends_on: []
---

# INFRA-049: commitlint judges commits the PR did not author

## Problem

The `commitlint` job ran `commitlint --from origin/<base> --to HEAD`. For a normal feature PR that is
exactly right. But for a PR that **merges another branch**, the range includes every commit that branch
carries — commits the PR author never wrote and cannot rewrite.

Observed on **#1415** (`main` → `develop` back-merge, 2026-07-26): the job failed on

- Dependabot commit **bodies** (`Bumps [lucide-react](https://github.com/…) from 0.525.0 to 1.26.0.`),
- and an already-merged repo commit whose subject is 126 chars
  (`refactor(harness): HARNESS-DIET-003 remainder — …  (#1302)`).

Both are **already on `main`**, i.e. already merged and unchangeable. Locally
`commitlint --from origin/develop --to HEAD` exits **0** on the same branch — CI saw a different set.

## Root cause (two distinct defects, both confirmed)

**1. The shallow base fetch silently corrupted the range.** The job checked out with `fetch-depth: 0`
— `actions/checkout` fetches `+refs/heads/*:refs/remotes/origin/*` at full depth, so `origin/<base>`
was already complete — and then ran `git fetch origin <base> --depth=50`. A `--depth` fetch **grafts
the whole repository** at that depth. Commits long since merged into the base then look unreachable
from it, so `origin/<base>..HEAD` re-emits them.

Evidence, same branch, same command:

| where                   | commits in range                    | commitlint errors |
| ----------------------- | ----------------------------------- | ----------------- |
| local (full clone)      | 109                                 | **0** (exit 0)    |
| CI (after `--depth=50`) | 97 (a different set, incl. `#1302`) | **26** (exit 1)   |

`e6ede7a06` (`… HARNESS-DIET-003 remainder … (#1302)`, 126 chars) is provably an ancestor of
`origin/develop` (`git merge-base --is-ancestor e6ede7a06 origin/develop` → true), so a complete clone
correctly excludes it. Only the graft put it back in range. This is exactly the "green locally, red in
CI" class HARNESS-045 exists to catch.

**2. Even with complete history, the range is not the PR's commits.** A `main → develop` back-merge
legitimately carries ~109 commits that are on `main` and not on `develop`. Today they happen to pass,
but any one of them with a long subject fails a PR whose author cannot rewrite it. Structural: every
back-merge, and every PR that merges a long-lived branch, hits it.

## Approach chosen

**Compute the range with git (`rev-list --first-parent`) and lint each resulting commit**, from the PR
head sha, with **no base fetch at all**. In `.github/workflows/ci.yml`:

```bash
range="origin/${BASE_REF}..${HEAD_SHA}"          # HEAD_SHA = github.event.pull_request.head.sha
for sha in $(git rev-list --first-parent "$range"); do
  git log -1 --format=%B "$sha" | pnpm exec commitlint --verbose || status=1
done
```

Three parts, each load-bearing:

- **No base fetch.** `checkout` already provides `origin/<base>` at full depth; the `--depth=50` fetch
  was redundant _and_ was the graft. Removing it is what makes CI and a local run evaluate the same
  commits — root cause 1, and the local/CI reconciliation the task required.
- **`--first-parent`.** Drops history merged IN from another branch (root cause 2) while keeping every
  commit the PR authored — including its own merge commits — on the linted path.
- **`--to <head.sha>` rather than `HEAD`.** On a `pull_request` event `HEAD` is GitHub's synthetic
  `refs/pull/N/merge`, whose **first** parent is the base branch. Walking first-parent from it
  traverses the base and lints **nothing** — the gate would have gone silently vacuous. Proven in
  test C below; this is the trap the obvious version of this fix falls into.

### Alternatives rejected

- **`commitlint --git-log-args=--first-parent`** (the in-tool equivalent, and the spelling
  commitlint's own `--help` gives as its example). **It does not work.** `@commitlint/read` splits the
  string with `parseArgs` and forwards it to `@conventional-changelog/git-client`, which only
  understands the camelCase `firstParent` key and — per the comment in its own source — "may silently
  ignore" everything else. Measured: `--git-log-args=--first-parent` → exit 1 (no effect);
  `--git-log-args=--firstParent` → exit 0 (works, by accident of the key name). A required CI gate
  must not hang off an undocumented camelCase coincidence that fails **silently** when it drifts.
- **`ignores` for merge/bot commits in `commitlint.config.js`** (backlog option 2). Rejected: it
  weakens the rule globally — Dependabot's own PRs would stop being checked — and it does not solve
  the problem, because the commit that actually failed #1415 was a **human** commit with a 126-char
  subject, which no bot-author predicate can exempt. `commitlint.config.js` is left untouched; the
  gate is unchanged for every commit a PR authors.
- **Fetching more history / `--unshallow`** (backlog option 3) as the whole fix. Necessary but not
  sufficient: it closes root cause 1 only. Test A below fails under a full clone too. It is folded in
  here as "no depth-limited fetch", which is strictly better than raising the depth to a bigger guess.

## Red / green evidence

Synthetic fixture (`dev` base; `feature` merges a branch carrying a 126-char subject then adds its own
clean commits; `own-bad` authors a 126-char subject itself; `refs/pull/1/merge` reproduces GitHub's
synthetic merge ref with parent1 = base).

**A. A branch that merges another branch containing a >100-char subject.**

```
A1  today:  commitlint --from dev --to <feature>
    ✖ header must not be longer than 100 characters, current length is 126 [header-max-length]
    >>> EXIT=1  (RED)

A4  fixed:  git rev-list --first-parent dev..<feature> | per-commit commitlint
    ✔ found 0 problems, 0 warnings   (x3 — the PR's own commits)
    >>> EXIT=0  (GREEN)
```

**B. A PR whose OWN commit has a >100-char subject — the gate must NOT weaken.**

```
B1  today:  commitlint --from dev --to <own-bad>                >>> EXIT=1
B2  fixed:  git rev-list --first-parent dev..<own-bad> | …
    ✖ header must not be longer than 100 characters, current length is 126 [header-max-length]
    ✖ found 1 problems, 0 warnings
    >>> EXIT=1  (STILL RED — proven, not asserted)
```

**C. Why `--to` must be the head sha.**

```
refs/pull/1/merge 0d4220c parents=fb50a3e edd36c8   (parent1 is the BASE)
first-parent range dev..refs/pull/1/merge  = 1 commit  <- VACUOUS (only the synthetic merge)
first-parent range dev..<head.sha>         = 3 commits <- the PR's own commits
```

**D. #1415 unblocked.** The new step, extracted verbatim from `ci.yml` and run under GitHub's `bash -e`
semantics with `BASE_REF=develop HEAD_SHA=$(git rev-parse origin/chore/sync-main-into-develop)`:

```
Linting 1 commit(s) authored by this PR (origin/develop..5c8c1ff1e…, first-parent).
── 5c8c1ff1e chore(deps): sync main's dependency majors into develop
✔   found 0 problems, 0 warnings
>>> STEP EXIT=0
```

97 commits / 26 errors before; 1 commit / 0 errors after. The branch itself was not modified.

## Local / CI divergence

Closed for this job. CI evaluates `git rev-list --first-parent origin/<base>..<head sha>` on a
complete clone; the identical local command on the same branch (where `HEAD` _is_ the head sha)
yields the same set. The invocation is recorded verbatim as a comment in the job so it can be copied.

Two residuals, deliberately not fixed here:

- **Local parity still assumes a fresh `origin/<base>`.** If a developer has not fetched, their
  `origin/develop` is stale and the range differs. Unavoidable without a fetch in the local command;
  CI always has a fresh one.
- **The same `--depth=50` graft pattern remains in the `changes` job** — it fetches the base with
  `--depth=50` and feeds `git diff origin/<base>...HEAD`. A three-dot diff needs the merge-base, so a
  graft can mis-classify a PR as code/docs-only. Not touched here (out of this change's scope), and
  it is a soft failure rather than a blocking one — worth a follow-up item.
- **No mechanical regression test.** Guarding this would need a script under `scripts/harness/`,
  outside this change's file scope; the fixture above lives only in the PR evidence.
