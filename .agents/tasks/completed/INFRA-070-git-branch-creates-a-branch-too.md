---
title: 'INFRA-070: `git branch <name> <base>` creates a branch the create-checks never see'
status: done
completed: 2026-08-05
priority: medium
urgency: soon
type: INFRA
area: .claude/hooks
created: 2026-07-30
depends_on: []
---

# INFRA-070 — one spelling of branch creation is guarded, the other is not

## Problem

`branch-guard` detects branch creation as `git checkout -b` / `git switch -c`, and both create-time
checks hang off that detection: the base a branch is cut from (INFRA-067) and the name it is given.

`git branch <name> <start-point>` creates a branch just as truly, and is not detected. So

```
git branch my-branch main && git checkout my-branch
```

reaches neither check — a branch cut from `main`, named outside the convention, created in two
commands that the guard reads as "not a creation".

Found by review on PR #1525, which also noted that `git-branch.md` scopes the rule to
`checkout -b` / `switch -c`, so this is a coverage gap rather than a rule violation. Recording it
because "the rule says only these two spellings" is exactly the shape that leaves a guard true on
paper and reachable around in practice — the class PROC-003 tracks.

## Why it is not urgent

Nothing observed has used this form. The two guarded spellings are what the rule prescribes and what
every documented workflow uses, and the base check now covers the implicit case (creating while
standing on the wrong base), which is how the one real incident happened.

## Done when

- `git branch <name> [<start-point>]` is treated as a creation by `branch-guard`, with the same base
  and name checks and the same overrides, proven RED for a wrong base and a bad name and GREEN for
  the prescribed form.
- Listing and deleting forms — `git branch`, `git branch -a`, `git branch -d/-D <name>`, `git branch
--list` — are NOT treated as creations, each proven silent, so widening the detection does not turn
  ordinary inspection into a refusal.
- `git-branch.md` names all the spellings it governs, so the rule and the guard agree on scope.

## Resolution

`branch-guard` treats `git branch <name> [<start-point>]` as a creation, with the same base check,
the same name check and the same overrides as `checkout -b` / `switch -c`. `git-branch.md` now names
all three spellings, so the rule and the guard agree on scope.

**The flag list is an ALLOWLIST, and that direction is the whole safety of it.** `git branch` with no
argument lists; `-a`, `-r`, `-v`, `--list`, `--merged`, `--show-current` list; `-d`/`-D` delete;
`-m`/`-M` rename. Reading any of those as a creation would turn ordinary inspection into a refusal —
guard property 4, which is the failure that gets a guard overridden by reflex rather than fixed. Only
flags that leave the command a creation are admitted (`-f`, `--force`, `-q`, `--quiet`, `-t`,
`--track`, `--no-track`), and the token after them must not itself be a flag.

**One defect found while writing it.** The first attempt hung a single `${GITEND}` off the widened
alternation instead of leaving it on each branch, which silently dropped the trailing boundary from
the two spellings that already worked — `git checkout -bogus` would have read as `-b`. Widening a
matcher is where the existing matcher gets weakened, and the weakening does not announce itself.

### Red-proved, each half independently

`branch-guard-reads-git-branch.test.mjs`, 15 cases against the real hook in a scratch repository
where `main` and `origin/develop` genuinely diverge, with no `BRANCH_GUARD_ALLOW_*` in the
environment by construction:

| Reverted | What fails |
| --- | --- |
| the detection | 3 cases — bad name, wrong base, and the two-command shape the item names |
| the start-point extraction only | 1 case — wrong base, while detection still fires |

The second is the one worth having. With detection widened and the base unread, `git branch x main`
would be **judged against HEAD** — a creation detected, judged, and judged against the wrong thing,
which reads as a pass. The other 12 cases stay green under both reversions, which is what shows the
widening did not simply start refusing everything.

Ten listing/deleting/renaming forms are each proven to exit 0 **with no output at all**, not merely
permitted: a guard that narrates on the happy path is one people learn to scroll past, after which
its refusals scroll past too.

### Met while doing this, and worth its own item: a worktree commit is judged by the wrong checkout

`branch-guard` resolves the repository a statement will run in with the precedence `git -C <path>` >
hook-input `cwd` > project dir, exactly so a worktree agent's commit is not judged against the main
clone's branch. It works — for a LITERAL path. The hook reads the command as TEXT, so
`git -C "$WT" commit` hands it the eight characters `"$WT"`, which name no repository, and the
resolution falls back to the project dir. With the main checkout sitting on `develop`, every commit
made in a worktree through a shell variable is refused for being "on protected branch develop".

That is the HARNESS-061 class — the hook sees the text, not the expansion — and it just became
load-bearing, because the new operational rule "A Wait Is Not Idle Time" makes worktree-parallel work
the prescribed way to spend a blocking wait. A guard that refuses the prescribed workflow whenever
the main checkout happens to be on an integration branch is the property-4 failure that gets guards
overridden by reflex.

Not fixed here: it is a different subject from branch-creation spellings, and the shell-aware
extraction it needs is already filed as HARNESS-061. Recorded so the next person meets a written
cause instead of a confusing refusal, and so the item that fixes it knows this is now on a hot path.
