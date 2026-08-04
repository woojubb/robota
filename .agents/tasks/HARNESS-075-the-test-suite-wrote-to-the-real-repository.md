---
title: 'HARNESS-075: the harness test suite wrote to the real repository — and to its GitHub remote'
status: todo
priority: critical
urgency: now
type: INFRA
area: scripts/harness/__tests__, .claude/hooks
created: 2026-08-05
---

# HARNESS-075 — the suite that guards the repository damaged it

## What happened

Running `pnpm harness:test` inside a **git worktree** of this clone (via the `harness:pre-push`
gate) left the real repository and its GitHub remote carrying test-fixture state.

Measured, on 2026-08-05:

| Subject                 | Damage                                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub `develop`        | history REPLACED by fixture commits (`feat: cycle 3`, `feat: cycle 2`, `chore: root`, …), all authored `17:16:29–30Z`                                |
| local `develop`, `main` | moved to fixture commits                                                                                                                             |
| local branches          | `feat/a`, `feat/b`, `feat/open`, `feat/probe`, `feat/assigned`, `nested-branch`, `nested-1785863790900`, `sibling-branch`, `release/promote` created |
| local `.git/config`     | `core.bare = true` set, so every `git status` answered "must be run in a work tree"                                                                  |
| worktree registrations  | ~20 fixture worktrees registered against the real clone (`/tmp/repo-lock-*`, `/tmp/tree-prerequisites-*`, `/tmp/wt-alive-*`)                         |
| the in-flight worktree  | its `HEAD` repointed at a fixture branch (`release/promote`)                                                                                         |

**Nothing was lost.** Every real commit survived as an object; `main` was untouched on the remote;
the working trees on disk were intact. `develop` was restored to `b18dd4526` (the #1643 merge) by
force-push with the owner's confirmation, the fixture branches and worktree registrations were
removed, and `core.bare` was unset.

## What is NOT yet known — and why this is filed rather than fixed

Which test did it. The obvious candidates are isolated correctly:

- `scan-promotion-ancestry.test.mjs` builds its repository under `mkdtemp` and runs every `git` with
  `cwd` set to it.
- `branch-base-at-creation.test.mjs` pushes to an `origin` that is a **local bare repo** in its own
  temp directory.

So the mechanism is not "a test names the wrong remote" in the shape a grep finds. Candidates worth
testing, in order:

1. **A guarded command that the suite EXECUTES to prove the guard permits it.** Several cases carry
   real command strings (`git push origin --delete develop` among them) as data. A case that both
   asserts a verdict and then runs the command would do exactly this damage.
2. **Worktree-relative git resolution.** The run happened inside a worktree, whose `.git` is a FILE
   pointing at the parent clone's `.git/worktrees/<name>`. A fixture that resolves upwards, or a
   `cd` that lands outside its own temp root, reaches the real clone rather than a scratch one.
3. **`core.bare = true` is the loudest clue.** No ordinary test needs it. Whatever set it was
   operating on a repository it believed was its own bare fixture, and that repository was ours.

## The strongest lead, obtained by observation rather than argument

Immediately after the incident the SAME suite was run again from the **main checkout** — the full
`harness:test` under `harness:pre-push`, 2688 tests — and the clone was inspected before and after:

| Subject                | After a main-checkout run                |
| ---------------------- | ---------------------------------------- |
| branch refs            | unchanged                                |
| `core.bare`            | unset                                    |
| worktree registrations | 3 (the two real worktrees and the clone) |
| GitHub `develop`       | unchanged                                |

**Nothing.** The suite is safe in the main checkout and destructive in a worktree, which moves
candidate 2 — worktree-relative git resolution — from "worth testing" to the leading hypothesis and
demotes the others.

The mechanism it points at: a worktree's `.git` is a FILE containing `gitdir: <parent>/.git/worktrees/<name>`,
not a directory. A fixture that walks upward looking for a repository root, or that resolves `.git`
expecting a directory, lands on the PARENT clone from a worktree while landing on its own temp root
from the main checkout — the same code, two answers, and only one of them destroys anything. That
also explains `core.bare`: a fixture that means to create its own bare repository, handed the parent
clone as its target.

Reproduce it that way first: run a single suspect file in a worktree of a THROWAWAY clone and diff
the parent's refs, config and worktree list. The bisect is over files, and the worktree is the
condition — not the other way round.

## Done when

- The write path is identified by REPRODUCTION — a run that damages a throwaway clone, not an
  argument about which test looks risky.
- No test can reach a repository it did not create. The mechanism is a floor, not a review note:
  a wrapper that refuses when the resolved git dir is not under the test's own temp root is the
  obvious shape.
- `harness:test` is safe to run inside a worktree, proven by running it in one and diffing the
  parent clone's refs, config and worktree list before and after.
- Until then, the operational rule's parallel-work section carries the warning that landed with it.

## Why it is critical

The parallel-work rule added the same day makes running the suite in a worktree the PRESCRIBED way
to spend a blocking wait. This defect makes the prescribed workflow destructive, and it reached the
shared remote — the one place a local mistake stops being local.
