---
id: INFRA-051
title: Squash-merging back-merges erases branch ancestry, so every promotion re-conflicts
status: done
priority: high
type: INFRA
created: 2026-07-26
completed: 2026-07-26
spec: .agents/spec-docs/done/INFRA-051-promotion-ancestry-invariant.md
---

## Problem

`main` and `develop` cannot be kept in sync, because the two merges that are supposed to sync them
are squashed:

- a **back-merge** (`main -> develop`) squashed into one commit copies main's content across but
  records **no ancestry link** — `git merge-base --is-ancestor origin/main origin/develop` still
  fails afterwards;
- so the next **promotion** (`develop -> main`) still computes against the old merge base and
  re-conflicts on exactly the manifests the back-merge just reconciled.

Measured on 2026-07-26: #1415 back-merged main into develop and merged green. Immediately after,
`develop -> main` (#1413) still reported `CONFLICTING`, on the same five `package.json` files plus
`pnpm-lock.yaml`. The squash commit `bc0ee64ff` has a single parent. The content was synced; the
ancestry was not. #1427 had to redo the merge by hand to clear it.

## Why it matters beyond the annoyance

The manual re-resolution is where the real risk sits. Resolving those conflicts wholesale in either
direction is wrong, and both directions have already nearly caused a regression:

- `--theirs` toward main would have reverted develop's patch bumps;
- `--theirs` toward develop would have silently un-archived four backlog items and dropped ~80
  changesets, had each not been individually traced to a deliberate `PROC-001` / `REL-023` change.

## Decision — merge-commit the sync merges, as an ancestry invariant enforced pre-merge

Full reasoning, measured facts and rejected alternatives:
[`.agents/spec-docs/done/INFRA-051-promotion-ancestry-invariant.md`](../../spec-docs/done/INFRA-051-promotion-ancestry-invariant.md).
Reviewed by `proposal-reviewer` (verdict **REVISE**), which found three defects in the first draft —
all fixed below.

**Direction 1 (merge-commit the sync merges) chosen**, reframed as an invariant on every PR into
`main`, all three assertions evaluated on `github.event.pull_request.head.sha`:

- **A1** `origin/main` is an ancestor of the promotion head — the property a squashed back-merge
  destroys.
- **A2** the head adds no non-merge commit outside `origin/develop`'s ancestry, past a frozen
  adoption baseline — catches a _previous_ promotion that was squashed.
- **A3** the head's tree equals the `develop` commit it was cut from — catches an evil merge, a
  `hotfix/*` landing, or a direct push, none of which `--no-merges` can see.

**Direction 2 (fast-forward promotion) rejected on policy, not capability.** The draft rejected it as
mechanically impossible; the reviewer refuted that — `protect-main` already grants the operating
account `bypass_mode: always`, so `git push origin develop:main` would succeed today. It is rejected
because `git-branch.md` prohibits direct pushes to `main`, promotion is a user-approved release
action, and a bypassing push forfeits the only place `release-grade verification` and CodeQL run
against the promotion. Its premise is also false: `git rev-list origin/develop..origin/main
--no-merges` = 10 — nine Dependabot PRs **and one human feature branch** (`fbf9f5156`, #1216, base
`main`) landed directly on `main`. Filed as **INFRA-053** as the stronger end state, which needs this
item's invariant first.

**Direction 3 (single trunk) rejected on blast radius.** `main` is a tag trigger
(`release-tag-on-version-bump.yml`), a deploy boundary, and a distinct protection surface with a
release-grade verification job that exists only for `base_ref == 'main'`.

**Also rejected: disabling squash repository-wide** (would strip squash from every feature PR — the
correct lever is the per-branch one), and **a prose rule** ("remember to pick merge commit"), which is
the prose-without-a-mechanism failure this harness has recorded repeatedly.

### Defects the proposal review caught (all fixed)

1. **A2 was unsatisfiable as first written.** Phrased against `origin/main` with no baseline it can
   never go green, because the design deliberately deletes the `main -> develop` back-merge, so the
   ten pre-existing commits never enter `develop`'s ancestry. Proof: #1427 _did_ use real merge
   commits and `git rev-list origin/develop..origin/main --no-merges` is **still 10**. Installing it
   would have red-blocked every promotion forever. Fixed with a frozen, anti-rot adoption baseline.
2. **GitHub _does_ have a per-branch merge-method control** (`pull_request` ruleset rule,
   `allowed_merge_methods`). The draft asserted it did not and conceded a detector-only ceiling.
   Applying it turns the merge-method dimension into a true gate.
3. **A3 was missing.** `--no-merges` cannot by construction see content introduced by a merge commit,
   so an evil merge would have passed A1+A2 while leaving the branches diverged.

## Enforcement — two gates, both pre-merge

| Layer            | Mechanism                                                                                                                                                    | Gate or detector                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Merge **method** | `protect-main` ruleset, `pull_request` rule, `allowed_merge_methods: ["merge"]` (applied)                                                                    | **GATE** — GitHub refuses to squash/rebase-merge into `main`. `protect-develop` untouched, feature PRs still squash. |
| Merge **input**  | `promotion ancestry` job in `.github/workflows/ci.yml`, a **required status check** on `protect-main`, running `scripts/harness/scan-promotion-ancestry.mjs` | **GATE** — blocks the promotion PR before it lands.                                                                  |

Neither is a post-merge detector. The one residue is `protect-main.bypass_actors` (admin, always) —
INFRA-054.

## Root cause of the recurring cost — removed, not mitigated

`scripts/harness/promote.mjs` builds the promotion branch deterministically:

```bash
git checkout -B release/promote-develop-to-main origin/develop
git merge --no-ff origin/main
```

In the steady state that merge is clean **by construction** — `main`'s tree equals the develop commit
the last promotion promoted, so `main`'s side of the three-way merge is empty. Verified live:
`git merge-tree --write-tree origin/develop origin/main` exits **0** and yields a tree byte-identical
to `origin/develop^{tree}`. **The separate `main -> develop` back-merge PR, and the per-cycle
hand-derived resolution with it, is deleted from the process.**

## Acceptance — all met

- [x] **A spec that picks a direction and states why the alternatives were rejected.**
      `.agents/spec-docs/done/INFRA-051-promotion-ancestry-invariant.md`, reviewed by
      `proposal-reviewer`.
- [x] **A mechanical check, proven RED against the pre-fix state before green.** Below.
- [x] **A promotion that conflicts on nothing.** The prescribed promotion merge exits 0 with a tree
      identical to develop's, so the promotion introduces no content and has nothing to conflict on
      (command and output under Red/green proof below). The promotion itself is a release action
      requiring explicit user approval; the branch construction is proven clean.

## Red/green proof

**RED — the exact pre-#1427 state** (`origin/main` = `ee7227535`, `origin/develop` = `bc0ee64ff`, the
squashed back-merge; both still reachable):

```
bc0ee64ff parents: bc0ee64ffd6c0c57bfd5b9d7f7d7d9d60209bf26 6db1f000da16f3e09c58b1ff2d2f6fa4e1520c11
                   ^ single parent — the ancestry link is absent

===== PRE-FIX (2026-07-26, #1415 squashed back-merge → #1413 CONFLICTING) =====
RED — 1 finding(s):
  [A1] `ee7227535` is NOT an ancestor of the promotion head.
```

**RED — through the real CLI, against today's refs, promoting from `origin/develop`'s tip** (what a
squashed sync leaves you with):

```
$ GITHUB_BASE_REF=main PR_HEAD_SHA=$(git rev-parse origin/develop) \
    node scripts/harness/scan-promotion-ancestry.mjs
promotion-ancestry scan failed (INFRA-051):
  - [A1] `origin/main` is NOT an ancestor of the promotion head. …
EXIT=1
```

**GREEN — the same CLI on a promotion head built the prescribed way:**

```
$ git merge-tree --write-tree origin/develop origin/main   # exit 0, tree == origin/develop^{tree}
$ GITHUB_BASE_REF=main PR_HEAD_SHA=c59fb01541b234a2b8927b3fcab1f01d788717ee \
    node scripts/harness/scan-promotion-ancestry.mjs
promotion-ancestry scan passed — A1/A2/A3 hold for c59fb015… (pre-adoption baseline debt on `main`: 10 commit(s), frozen at a1a6bb830).
EXIT=0
```

**The `refs/pull/N/merge` accidental-green trap, refused rather than passed:**

```
$ GITHUB_BASE_REF=main GITHUB_EVENT_NAME=pull_request node scripts/harness/scan-promotion-ancestry.mjs
promotion-ancestry scan failed (INFRA-051): refusing to evaluate `HEAD` on a `pull_request` event …
EXIT=1
```

**Unit suite — 11 tests over real throwaway git repositories**, covering the squashed back-merge red,
the prescribed construction green, a 3-cycle steady-state green, the squashed-previous-promotion red,
the evil-merge red (with A2's blindness asserted in the same test), and the two hard-failure modes:
`scripts/harness/__tests__/scan-promotion-ancestry.test.mjs`.

## What remains manual (filed, not hidden)

1. A `hotfix/*` that lands content on `main` still needs one deliberate `main -> develop` back-merge,
   merged as a merge commit, before the next promotion. A3 blocks the promotion until then and prints
   the remedy, but `protect-develop` cannot restrict that back-merge's _method_ without stripping
   squash from every feature PR. → INFRA-053.
2. A repository admin can bypass `protect-main` and therefore both gates. → INFRA-054.

## References

- #1415 (back-merge, squashed), #1413 (promotion, blocked by it), #1427 (manual re-resolution)
- `.agents/rules/git-branch.md` § Promotion — the procedure and both enforcement layers
- Follow-ups: INFRA-053 (fast-forward promotion end state), INFRA-054 (vacuous required contexts and
  bypass actors on `protect-main`)
