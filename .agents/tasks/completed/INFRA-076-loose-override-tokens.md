---
title: 'INFRA-076: branch-guard honours an override token wherever it appears, not where it is given'
status: done
completed: 2026-07-31
priority: high
urgency: soon
type: INFRA
area: .claude/hooks
created: 2026-08-01
issue: https://github.com/woojubb/robota/issues/1548
depends_on: []
---

# INFRA-076 — an override read as a word, not as a prefix

## Problem

`branch-guard.sh` reads its four overrides (`BRANCH_GUARD_ALLOW_DELETE`, `_ALLOW_MAIN_MERGE`,
`_ALLOW_OPEN_BRANCHES`, `_ALLOW_BASE`) as a token appearing anywhere in the masked command:

```sh
grep -qE '(^|[[:space:];&])BRANCH_GUARD_ALLOW_DELETE=1([[:space:]]|$)'
```

Masking stops a QUOTED mention. It does not stop an unquoted one, because an unquoted token is a
real word in the command:

```
git commit -m BRANCH_GUARD_ALLOW_DELETE=1 && git push origin --delete develop
echo BRANCH_GUARD_ALLOW_DELETE=1 ; git push origin --delete develop
```

Measured on the sibling hook `worktree-cwd-guard`, which had the identical rule: both shapes
disarmed the guard, and the quoted shape did not. That hook was repaired by anchoring the override
to the command it overrides — an override is something you GIVE a command, so it must prefix one.

## Why it is filed rather than fixed alongside

`branch-guard`'s overrides are DOCUMENTED as loose — a token anywhere on the line — and its own
comments explain the choice. Narrowing them to a prefix is a user-visible behaviour change to the
most-used hook in the repository: an operator whose habit is `BRANCH_GUARD_ALLOW_OPEN_BRANCHES=1`
somewhere in a compound command would start being refused. That is a decision, not a repair, and it
should be taken deliberately rather than as a side effect of fixing a sibling.

`pre-push-check`'s `PRE_PUSH_ALLOW_UNREVIEWED` already uses the strict prefix rule, as does
`merge-gate`'s ACK. So the repository has both conventions live, which is the thing to settle.

## Options

1. **Anchor all four**, matching the three hooks that already anchor. Uniform, and closes the hole.
   Cost: breaks any established loose usage.
2. **Anchor the destructive ones only** (`_ALLOW_DELETE`, `_ALLOW_MAIN_MERGE`) and leave the two
   workflow ones loose. Closes the cases where a mention costs something irreversible.
3. **Leave as is and document the exposure.** Only defensible if the loose form is load-bearing for
   an actual workflow — name it if so.

## Done when

- One convention is chosen for override tokens across `.claude/hooks/`, and every hook follows it.
- A case per hook proves a bare mention does NOT disarm it, and the real prefix still does.

## Completion (2026-07-31)

Resolved by PR #1559 — with one half deliberately held and filed as #1563 (INFRA-079, since resolved by #1583). An override token is no longer honoured wherever it appears: it must prefix a statement, and that statement must carry the action it excuses. `branch-guard.sh` reads all four through `stmt_override`.

Reconciled 2026-08-04: the work had landed and the issue was closed with its evidence, but the Task
file was never moved. Verified against the tree before moving, not taken from the closed issue.
