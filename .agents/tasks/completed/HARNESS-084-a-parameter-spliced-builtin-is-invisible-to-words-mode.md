---
title: 'HARNESS-084: a parameter-spliced builtin is invisible to words-mode, so a cd hidden in ${…} is never tracked'
status: done
completed: 2026-08-10
created: 2026-08-10
priority: high
urgency: next
area: .claude/hooks
depends_on: []
issue: https://github.com/woojubb/robota/issues/1682
---

# HARNESS-084: a parameter-spliced builtin is invisible to words-mode

## Problem

`lib/command-scan.sh`'s words-mode collapses a splice built from quotes, backslashes, command
substitutions and backticks — `"c""d"`, `c\d`, `c$()d`, ` c`d `` all read as the single word `cd`.
It does NOT collapse a PARAMETER splice: the masker turns `${UNSET}` into `${` plus mask bytes
(the closing brace among them), so `c${UNSET}d` builds a word that is not `cd`, and no reader ever
sees the builtin.

For `pre-push-check.sh` that is a wrong-repository fail-open: `c${UNSET}d /unreviewed-repo && git
push` really does `cd` in bash, but the walk never tracks the directory change, so the push is
judged against the session repository — which may hold a clean review record — and exits 0.

The same shape presumably hides any builtin the guards key on, not only `cd`: `branch-guard`'s verb
latch reads the same words-mode output, so a parameter-spliced `git` or a spliced subcommand is
worth checking in the same pass.

## Evidence

Measured 2026-08-10 during the #1681 review, on BOTH `origin/develop` and the HARNESS-083 branch
(so it is pre-existing, not introduced by that change):

| splice               | statement                       | verdict             |
| -------------------- | ------------------------------- | ------------------- |
| quotes               | `"c""d" <repo> && git push`     | exit 2 (refused)    |
| command substitution | `c$()d <repo> && git push`      | exit 2 (refused)    |
| backticks            | ` c`d <repo> && git push ``     | exit 2 (refused)    |
| **parameter**        | `c${UNSET}d <repo> && git push` | **exit 0 (passed)** |

A glob splice (`c? <repo>`, where a file named `cd` exists) is the same class and was not measured;
it should be covered by whatever fix lands.

## Direction

Not prescribed. Two candidate shapes:

- Collapse an EMPTY parameter expansion in words-mode the way an empty command substitution is
  already collapsed, so `c${UNSET}d` builds the word `cd`. The masker's treatment of `${…}` is the
  constraint to work within — the note in `command-scan.sh` explains why brace counting was
  rejected once already, so this needs care rather than a second attempt at the same idea.
- Or have the guards treat a statement whose raw text carries an expansion character it cannot
  resolve as UNREADABLE for the purposes of the builtin it is looking for — fail-closed, the answer
  every other unknowable already gets in `pre-push-check.sh`.

Whichever lands, the fix belongs in the shared reader, not in one hook: `branch-guard.sh` reads the
same words-mode output for its verb latch.

## Test Plan

- Red-first: `c${UNSET}d <repo> && git push` must refuse (it passes today, on develop, measured).
- The glob variant (`c? <repo>` with a file named `cd` present) covered the same way.
- The four already-collapsed splices stay refused (no regression in the existing behaviour).
- `branch-guard`'s verb latch checked for the same hole and covered if present.
- Full harness suite green.

## User Execution Test Scenarios

**Does not apply.** Harness-internal guard behaviour; there is no user-facing surface, and the
change is a refusal that only an agent constructing the splice would encounter.

## Resolution

Landed on branch `fix/harness-084-unresolvable-command`. The chosen direction is the SECOND one the
Direction section offered — the guards decline to answer — and the first one is now recorded as
wrong: collapsing `${UNSET}` into `cd` would assert a value the hook cannot know, and `c${HOME}d` is
not a cd. A guard that guesses refuses correct work, so neither hook guesses; both treat an
unresolvable command position the way they already treat an unreadable target.

`pre-push-check.sh` — the command position is unresolvable when the first non-assignment word is
empty (a substitution occupied it), carries `$`/backtick, or the command is `eval`. Any of those
sets `LAST_CD_UNREADABLE`, so a later push refuses instead of resolving against a stale directory.

`branch-guard.sh` — the same question for the verb latch, which keyed on the literal words `git` and
`commit`. Two narrow triggers: the SUBCOMMAND position carries an expansion (`git c${UNSET}ommit`),
or the COMMAND position does AND the statement spells a gated subcommand somewhere (`$GIT commit`,
`g${UNSET}it commit`). Deliberately narrow: `$EDITOR notes.md`, `${PAGER} log`, `$(which node)
build.js` and `echo $HOME` are all untouched, asserted as cases, because a guard that fires on
correct work is one people learn to route around.

The remedy in the message is to spell the command literally rather than a new override token — the
legitimate surface is a variable standing in for `git`, and writing it out costs nothing.

Verified: all seven new cases red-prove against `origin/develop` (each exits 0 there — the
wrong-repository fail-open for pre-push, the protected-branch bypass for branch-guard — and refuses
here); the narrowness cases pass on both sides; every pre-existing pre-push and branch-guard case is
untouched; full harness suite 3117 green.
