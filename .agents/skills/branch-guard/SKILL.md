---
name: branch-guard
description: Pointer — protected-branch commit/merge policy is owned by the git-branch.md rule and enforced mechanically by the branch-guard hook + husky pre-commit. Consult before committing when on main/master/develop.
---

# Branch Guard (pointer)

The policy (branch-first, protected branches, merge-target = fork origin, release merges,
`--delete-branch` prohibition) is owned by [git-branch.md](../../rules/git-branch.md). Do not
restate it — read it there.

## Rule Anchor

- `AGENTS.md` > "Git Operations"

## Mechanical enforcement is the SSOT (two layers)

1. **Claude PreToolUse hook** (`.claude/hooks/branch-guard.sh`) — blocks `git commit`/`push`/`merge`
   Bash tool calls on `main`/`master`/`develop` before they run. It parses the command string, so a
   commit whose message breaks its regex extraction (multi-line, embedded quotes) can slip past —
   which is exactly how a release-record commit once landed directly on `main` (2026-06-14).
2. **Git-native `.husky/pre-commit`** — runs for EVERY commit regardless of how it is invoked; the
   robust backstop for what the parsing layer misses.

Exceptions (both layers): a merge in progress (`.git/MERGE_HEAD`), or the explicit overrides
`ALLOW_PROTECTED_COMMIT=1` (husky) / `BRANCH_GUARD_ALLOW_MAIN_MERGE=1` (Claude hook) for
user-approved release automation. Branch-first applies even to one-line doc commits — always
branch → commit → PR.

If the hook refuses a NEW branch because another local branch is still open (one-branch-at-a-time)
and the user wants the open work parked rather than merged or abandoned: park it in a tracked ref
(`git update-ref refs/holding/<branch> <sha>` or a scoped `git stash push`) BEFORE `git branch -D`,
and restore it later with `git cherry-pick` / `git stash pop`. A `git format-patch` file in a
scratchpad is not a holding place — the exact form is exception 3 of
[git-branch.md](../../rules/git-branch.md) § One-Branch-At-A-Time Rule (issue #2344).

If the hook fires (or you notice you are on a protected branch): stop, propose a conventional
branch name (`feat|fix|refactor|docs|chore/<scope>-<desc>`), get user approval, then
`git checkout -b` and continue — subsequent commits in the same task stay on that branch without
re-asking.
