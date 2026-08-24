---
name: post-merge-cycle
description: Shared sub-orchestration for everything that happens AFTER a merge command returns — verify the merge actually landed, decide whether the source branch may be deleted and delete it, then reset the working tree onto a fresh integration base for the next branch. Routes on each step's outcome with a defined failure edge; it never forms the landing verdict itself. Dispatched by any pipeline that merges.
loop: over=attempt; bound=2 attempts
---

# Post-Merge Cycle — pipeline only

A merge command returning is not the end of a merge. This skill is the ordered tail: **verify → delete →
re-base**, in that order, because each step's safety depends on the one before it. Deleting before the
landing is confirmed orphans work; branching before the base is reset forks the next branch off the wrong
commit. Both are incidents this repo has already had.

It routes; it does not judge. "Did the merge actually land?" is a verdict, and verdicts belong to
`merge-verifier`.

Where this procedure needs a concrete branch name, command, or deletion precondition, it **points at the
rule that owns it** instead of restating it. The only names used literally are the agent it dispatches and
the outcome tokens it routes on, because those _are_ the mechanism.

## Rule Anchor

- [git-branch.md](../../rules/git-branch.md) — "Merge Landing Verification" (the verify-independently and
  per-hop mandates); "`--delete-branch` is Prohibited in `gh pr merge`" (the ban, the confirm-merged
  precondition, and the four conditions under which a branch must NOT be deleted); "Delete Merged
  Branches" (the local/remote deletion mechanics, the ancestry precondition, never the integration
  branches); "Work that reaches `develop` is resolved" (the closure is performed, not inferred, and what a
  partial delivery does instead); "Post-Merge Branch Cycle" (churn discipline and the fresh-base requirement); "Clean Working
  Tree Before Every Commit and Push" (names the CI-equivalent verification entry point).
- The `merge-verifier` agent definition in `.claude/agents/merge-verifier.md`.

## Input

The merge just performed: the PR (or merge commit) and its target branch; **the issue this work resolves,
or that there is none**; whether this is one hop of a multi-hop flow and, if so, which hops remain; and
whether the caller intends to continue working in this same working tree afterwards. That last one decides whether phase 4 runs at all — ask rather than assume,
because a caller working in a disposable isolated tree has no next branch to base.

## The state machine

### 1. Verify the merge landed

Dispatch `merge-verifier` on the merge and its target. Take its verdict as given — do not re-derive it,
and do not treat a host UI's "merged" label as the answer.

| Outcome        | Routes to                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `PASS`         | advance to 2                                                                                          |
| `FAIL`         | **terminate** — report the agent's findings and its stated remediation. Never advance to deletion.    |
| more hops left | repeat step 1 for the next hop **after** that hop's merge; the rule requires a check per hop, not one |

The `FAIL` edge is absolute: a merge that did not land is exactly the case where deleting the source
branch destroys the only copy of the work.

### 2. Close what the merge resolved

The merge landed, so the work is resolved — `develop` is where that happens, and the issue does not wait
for a promotion. Close it here, in this step, as an act.

Do not look for the host to have closed it. The rule owns why: a closing keyword needs a pull request
based on the default branch, and this one was not, so nothing fired. A closed-looking issue at this point
was closed by someone, not by the merge.

| Outcome                                     | Routes to                                                                                                             |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| the issue's criteria are all delivered      | close it with a comment naming the delivering commit on the integration branch, then advance to 3                     |
| some criteria remain                        | **leave it open**, comment which were delivered and which were not, then advance to 3                                 |
| the merge delivered no issue                | advance to 3 — recorded as "none", never as an empty step                                                             |
| the merge names an issue it did not deliver | **leave it open** — a pull request that files, tracks, or cross-references an issue has not resolved it; advance to 3 |

The last row is the failure this step is most likely to cause, and it is the opposite of the one it was
added to fix. Most merged pull requests here name issues they are _registering_, not delivering. Read what
the body says about the issue before acting on the fact that it mentions one.

Where the issue carries acceptance criteria, compare them item by item. "This change addressed the topic"
is not "this change satisfied the criteria", and only the second one closes an issue.

### 3. Decide and perform branch deletion

The rule lists the conditions under which a merged branch must **not** be deleted. Evaluate each against
observable state — they are all decidable, not matters of taste — and route:

| Outcome                                          | Routes to                                                                                                |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| every condition clear                            | delete local, then remote, then advance to 4                                                             |
| any condition holds                              | **skip the deletion**, record which condition held and why, advance to 4                                 |
| the ancestry precondition fails on remote delete | **do not delete**; surface it as a finding (the branch has commits the target does not) and advance to 4 |

Order within the deletion itself is fixed by the rule: local first (its safe form refuses an unmerged
branch, so it is a free second opinion), then the remote — and the remote only once the merge is confirmed,
which step 1 already established. Prune any worktree that was holding the branch.

Not deleting is a recorded outcome, not a silent one. A branch skipped here without a reason written down
is how a backlog of stale branches accumulates.

### 4. Reset onto a fresh base for the next branch

Run only when the caller continues in this working tree. The order matters and is the whole point of the
phase:

1. **Discard transient auto-generated churn first**, by the scoped means the rule mandates — before any
   branch switch. Churn left in place blocks the switch, and a switch that is then forced or ignored is
   precisely how a new branch silently forks off the previous feature branch.
2. **Update the integration branch** so its head is the freshly-fetched one.
3. **Cut the new branch** from that head.
4. **Verify the base** — confirm the new branch actually forked from the freshly-updated integration head
   and not from a previous feature branch.

| Outcome                  | Routes to                                                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| base verification passes | **terminate** — the cycle is complete                                                                                               |
| base verification fails  | return to step 4.1 and re-cut, **bounded at 2 attempts**                                                                            |
| still failing after 2    | **terminate and escalate to the user** — a base that will not resolve is a repository-state problem, not something to keep retrying |

## Termination

Terminate on any of: `merge-verifier` returning `FAIL`; the base-reset bound being exhausted; a caller
with no next branch reaching the end of step 3; or any of the conditions the governing rules define as a
stop. Those stop conditions are owned by the rules — do not restate them here.

## Outcome contract

Report, per step: the landing verdict; **which issue was closed, or the reason none was** — `none`, or the
criteria that remain; whether the branch was deleted or which condition prevented it; and whether a fresh
base was established. The closure field is required, so a cycle that never reached it is a missing field
rather than a silence. Aggregate "cleaned up" is not a report — the caller may be holding
other work behind this cycle's completion.

## What This Skill Does NOT Do

| Not this skill's job                           | Owner                              |
| ---------------------------------------------- | ---------------------------------- |
| Decide whether the merge landed                | `merge-verifier` (agent)           |
| Define deletion preconditions or branch policy | `.agents/rules/git-branch.md`      |
| Perform the merge, or decide when to arm one   | the calling pipeline               |
| Define what a clean tree or a green gate means | `.agents/rules/git-branch.md`      |
| Judge the merged change's quality              | the code-review gate the rules own |
| Decide whether an issue's criteria are met     | the session that owns the issue    |

If you find yourself restating a rule here, stop — link the rule instead.

## Record the run

Open a ledger entry before the first round, record each round's finding count, and close it with the
terminal reason it actually reached — `converged`, `no-progress`, `bound-reached`, `halted-for-user`, or
`abandoned` if it stopped without reaching any of them. A run that leaves no record cannot be told from a
run that never happened ([a loop run is recorded](../../rules/enforcement-architecture.md), which owns
what each terminal reason means).

```bash
node scripts/harness/loop-run.mjs open  --loop post-merge-cycle
node scripts/harness/loop-run.mjs round --loop post-merge-cycle --run <id> --findings <n>
node scripts/harness/loop-run.mjs close --loop post-merge-cycle --run <id> --terminal <reason>
```
