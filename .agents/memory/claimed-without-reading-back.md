# A commit message that describes intent instead of the diff

Twice on 2026-08-02, on PRs #1605 and #1606, a commit message asserted an edit the tree did not
contain. Review caught both; the author had not.

1. **The revert that was undone by the formatter.** A multi-line union in
   `packages/dag-core/src/types/runtime-provider.ts` was restored by hand, and the task file recorded
   "reverted". The pre-commit formatter collapsed it again before the commit landed. The evidence
   cited for the claim — two `prettier --check` runs both passing — was worthless, because a
   `git stash` between them meant they measured **two different trees**.

2. **The edit inside a rejected compound command.** The change adding `completed:` and the captured
   user-execution evidence to a task file was one statement in a `&&` chain that `branch-guard`
   rejected. A hook rejects the command **whole**: none of it ran. The commit message then said
   "moved to completed/ with its completion date". Two MUST findings.

## Why this is the same defect the repo keeps fixing

It is [`comment-asserted-invariants`](comment-asserted-invariants.md) one level up. There a comment
asserts a property the code lacks; here a commit message asserts an edit the tree lacks. The
mechanism is identical — the claim looks settled, so the next reader stops checking — and it is worse
in a commit message, because that message is what a future reader trusts _instead of_ re-deriving the
diff.

## What to do instead

- After any blocked or failed command, re-check what actually landed. A hook that rejects a compound
  command runs none of it, including the parts that would have succeeded.
- Write the sentence describing a change from `git diff --staged`, not from memory of the edit.
  Describing intent and describing a diff are different acts; only the second is a commit message.
- When a formatter or hook is in the loop, the tree **after** the hook is the tree. Verify post-hook.
- When citing a tool's output as evidence, confirm the tool ran against the state being claimed.

Related: [`comment-asserted-invariants.md`](comment-asserted-invariants.md),
[`check-validity-two-axes.md`](check-validity-two-axes.md).
