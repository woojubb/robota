---
title: "INFRA-067: nothing checks a branch's base at creation — the rule's own prescribed command defeats its guard"
status: done
priority: high
urgency: now
type: INFRA
area: .claude/hooks
created: 2026-07-28
completed: 2026-07-30
depends_on: []
---

# INFRA-067 — the create-time check for "cut from `origin/develop`" does not exist

## Problem

`git-branch.md:152` is mandatory: _"Feature branches must be created from `develop` … never from
`main`, and never from another local feature branch."_ Two independent audits measured what enforces
it.

**Nothing does, at creation time.** `branch-guard.sh` detects `checkout -b` / `switch -c`, but
`grep -c "origin/develop" .claude/hooks/branch-guard.sh` returns **0** — it never inspects what the
new branch is based on. It checks the branch NAME and warns about unmerged local branches; the base
is not part of its judgement.

**And the rule's own prescribed invocation defeated the guard entirely.** Fed the exact command
`git-branch.md:155` prescribes —

```
git fetch origin && git checkout -b <slug> origin/develop
```

— the hook exited **0, silently**. Moving the `checkout -b` to position 0 blocked the identical
branch name with exit 2. That was `GITPFX='^\s*…'`, the start-anchor now being repaired by #1510 and
#1514 — but repairing the anchor only makes the existing checks reachable. **It does not add the
base check, because there isn't one.**

Branch creation is also the one guarded action with **no git-native backstop**: husky covers
protected-branch commits, GitHub rulesets cover pushes to `main`, and nothing covers `checkout -b`.

## What it has cost

Five incidents, two orphaned PRs, 14 all-time repair commits to `branch-guard.sh`. Most recently
(2026-07-27): a fix branch cut from a promotion branch carried that branch's merge commit into
`develop` on merge, which broke the promotion-ancestry gate and blocked every promotion until the
amnesty constant was corrected.

The only enforcement today is `pre-push-check.sh`'s post-hoc merge-commit heuristic — after the work
is done, and only for the shape that leaves a merge commit behind.

## Proposed direction

At `checkout -b` / `switch -c` / `-B` / `-C`, resolve what the new branch would be based on and
refuse when it is not the freshly-fetched integration head, naming the correct command in the
refusal. The check is cheap: the base is the current `HEAD` unless a start-point argument is given,
and both are readable from the command plus `git rev-parse`.

Deliberately NOT a name-shape check — that already exists and is not the failing half.

Consider what a legitimate exception looks like before writing the refusal: a promotion branch is
cut from `develop` and a hotfix may legitimately start from `main`. An override must exist and must
be visible in the output, the way `BRANCH_GUARD_ALLOW_DELETE=1` is, so a deliberate choice is
distinguishable from an accident.

## Done when

- Creating a branch from `main`, from a promotion branch, or from another feature branch is refused,
  proven RED for each of the three bases.
- The command `git-branch.md` itself prescribes **passes**, proven GREEN — the rule and its guard
  must agree, which is the defect that made this item.
- The refusal names the base it found and the base it wanted.
- An override exists, is recorded in the rule, and its use is visible in the hook's output.

## GATE-COMPLETE (2026-07-30)

- Creating a branch from `main`, from a promotion branch, and from another feature branch is refused,
  proven RED for each of the three bases (`branch-base-at-creation.test.mjs`), against a fixture where
  every base sits at a different commit so the difference is real rather than an artefact of equal shas.
- The implicit case is covered too: no start point in the command, base = current HEAD. That is how the
  promotion-ancestry break actually happened — nobody named `main`, they were standing on a promotion
  branch.
- The command `git-branch.md` itself prescribes — `git fetch origin && git checkout -b <slug>
origin/develop` — PASSES, proven GREEN both in the fixture and against this repository. The rule and
  its guard agreeing is the defect that made this item.
- The refusal names the base it found and the base it wanted, with short shas. Measured here:
  `found: main (6cf10615a)` / `wanted: origin/develop (02f5a84b9)`.
- Override `BRANCH_GUARD_ALLOW_BASE=1` exists, is recorded in `git-branch.md`, and is covered.
- `hotfix/*` and `release/*` are exempt, since the rule lets them PR to `main` and prescribes no base
  for them; pinned so the exemption cannot quietly widen.
- Red-proved: removing the base check fails two cases.
