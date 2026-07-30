---
title: 'INFRA-070: `git branch <name> <base>` creates a branch the create-checks never see'
status: todo
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
