---
title: 'HARNESS-075: the harness test suite wrote to the real repository — and to its GitHub remote'
status: todo
priority: critical
urgency: now
type: INFRA
area: scripts/harness/__tests__, .claude/hooks
created: 2026-08-05
depends_on: []
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

## REPRODUCED — the trigger is the pre-push GATE, and pushing from a worktree is enough

Stated first because the sections below were written before it and read, in order, as though the
defect had resisted reproduction. It did not.

Confirmed by doing it a second time, unintentionally: a `git push` from a worktree fires
`harness:pre-push`, and it produced the identical signature within minutes of the first restore.

| Subject                      | State after                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| local `develop`              | moved to a fixture commit                                                                                                 |
| local branches               | `feat/a`, `feat/b`, `feat/open`, `feat/probe`, `feat/assigned`, `nested-*`, `release/promote`, `sibling-branch` recreated |
| `core.bare`                  | `true` again                                                                                                              |
| worktree registrations       | 3 → **20**                                                                                                                |
| the worktree's own `HEAD`    | repointed at a fixture branch; index showing `AD kept.ts`, `D pnpm-lock.yaml`                                             |
| **GitHub `develop`, `main`** | **untouched**                                                                                                             |

Two things this pins down, and the eliminations below are what make them worth something.

**The trigger is the GATE, not the suite.** `harness:test` alone was run four ways in a throwaway
clone and changed nothing; the gate reproduces on the first attempt. The suspects are the steps the
gate adds around it.

**The remote damage recurs too — it is not rare, it is CONDITIONAL on the push actually running.**
The second reproduction (a push that the gate then REFUSED, so `git push` never ran) damaged only the
clone. The third (a push attempt from a worktree that got as far as the network) rewrote GitHub's
`develop` again, with fixture commits timestamped to the second. Three incidents, and the pattern is
consistent:

| Run                                                          | Local clobber | Remote rewritten |
| ------------------------------------------------------------ | ------------- | ---------------- |
| 1 — push from a worktree                                     | yes           | **yes**          |
| 2 — push from a worktree, refused by the gate before pushing | yes           | no               |
| 3 — push from a worktree, reached the network                | yes           | **yes**          |

So the gate's own steps clobber the clone, and whatever then runs `git push` inherits a repository
whose `develop` points at a fixture commit and pushes THAT. The remote damage is not a separate
mechanism — it is the local damage escaping through the very push the operator asked for.

That also means **a refused push is not a safe push**: run 2 left the clone broken with nothing to
show for it.

**Operationally, until this closes: do not `git push` from a worktree of this clone.** Pushing from
the main checkout was tried immediately afterwards and left the clone untouched.

## What was known before the reproduction — and why the eliminations still matter

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

That was the hypothesis. It was then TESTED, on a throwaway clone, and it did not survive.

### Four eliminations, each measured on a throwaway clone

A `--no-hardlinks` clone with one or two worktrees, snapshotting `refs/heads/*`, `core.bare` and the
worktree list before and after:

| Run                                                                                                                      | Result        |
| ------------------------------------------------------------------------------------------------------------------------ | ------------- |
| the three obvious suspects (`branch-guard-unmerged`, `scan-promotion-ancestry`, `branch-base-at-creation`) in a worktree | **no change** |
| the FULL `scripts/harness/__tests__` suite in a worktree (2688 tests)                                                    | **no change** |
| the full suite in TWO worktrees CONCURRENTLY                                                                             | **no change** |
| the full suite from the main checkout                                                                                    | **no change** |

So it is not the scripts/harness suite, in a worktree, concurrently, or otherwise. Every shape that
looked obvious has been ruled out by running it.

### What that leaves

The incident ran under the whole `harness:pre-push` gate, which is more than `harness:test`:

```
pnpm harness:plan  →  pnpm harness:verify  →  pnpm harness:test  →  pnpm harness:scan  →  pnpm cli:dev --version
```

`harness:verify` runs the affected PACKAGES' own suites, and those have not been looked at here at
all. The suspect set is now **the package test suites and the non-test steps**, not
`scripts/harness/__tests__` — the opposite of where this investigation started, and the reason the
eliminations are worth more than the original hypothesis.

Next: snapshot a throwaway clone, run `pnpm harness:pre-push` in a worktree of it — the reproduction
above says it will fire — and bisect the gate's five steps before bisecting any file. `harness:verify`
is the first to look at: it runs the affected packages' own suites, which nothing here has audited.

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
