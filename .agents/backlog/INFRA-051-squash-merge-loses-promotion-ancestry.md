---
id: INFRA-051
title: Squash-merging back-merges erases branch ancestry, so every promotion re-conflicts
status: todo
priority: high
type: INFRA
created: 2026-07-26
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
ancestry was not. #1426 had to redo the merge by hand to clear it.

This is not a one-off: it recurs on **every** sync cycle, and each cycle costs a manual
conflict-resolution pass whose only job is to re-assert a resolution that already happened.

## Why it matters beyond the annoyance

The manual re-resolution is where the real risk sits. Resolving those conflicts wholesale in either
direction is wrong, and both directions have already nearly caused a regression:

- `--theirs` toward main would have reverted develop's patch bumps;
- `--theirs` toward develop would have silently un-archived four backlog items and dropped ~80
  changesets, had each not been individually traced to a deliberate `PROC-001` / `REL-023` change.

A resolution that must be re-derived by hand every cycle is a defect the process keeps paying for.

## Direction (not yet decided — this needs a spec)

Options, in rough order of preference:

1. **Merge-commit the sync merges.** Keep squash as the default for feature PRs, but require a merge
   commit for `main -> develop` and `develop -> main`. Ancestry is then recorded and the conflict
   never re-appears. Needs a mechanical guard, since the merge method is a per-merge human choice
   and the default is squash.
2. **Fast-forward promotion.** If `develop` is only ever ahead of `main`, promote by fast-forward and
   never merge at all. Requires that nothing ever lands directly on `main` (hotfixes included).
3. **Single trunk.** Remove the two-branch split entirely; the divergence cannot exist.

Whichever is chosen, the gate must be **mechanical** — a rule that says "remember to pick merge
commit here" is the prose-without-a-mechanism failure this harness has repeatedly recorded.

## Acceptance

- [ ] A spec that picks a direction and states why the alternatives were rejected.
- [ ] A mechanical check that fails when a sync merge lands in a way that loses ancestry — proven RED
      against the current state (where `origin/main` is not an ancestor of `origin/develop`) before
      it is proven green.
- [ ] A promotion performed under the new mechanism that conflicts on nothing.

## References

- #1415 (back-merge, squashed), #1413 (promotion, blocked by it), #1426 (manual re-resolution)
- `.agents/rules/git-branch.md` — branch policy owns the merge-method rule
