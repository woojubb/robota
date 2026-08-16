---
name: multi-backlog-initiative
description: Sub-orchestration for an initiative that spans several backlog items. Establishes an integration base branch cut from the integration branch, dispatches backlog-execution-orchestrator once per item against that base, keeps the base from drifting mid-flight, and opens the final PR that the user — never this pipeline — decides to merge. Owns only the ordering and routing between items; every branch, PR, and gate constraint is owned by the rules it points at. The entry point for multi-item work; a single item enters backlog-execution-orchestrator directly.
invocable: true
---

# Multi-Backlog Initiative — pipeline only

When one unit of intent needs several Task items, they land on an **integration base branch** rather than
one at a time on the shared integration branch. This skill operates on already-classified Tasks, not raw
GitHub issues; use [issue-to-backlog](../issue-to-backlog/SKILL.md) first when the work starts from an
issue. It owns that outer loop: establish the base, run each item through the per-item pipeline against
it, and hand the assembled result to the user.

It holds no branch policy and no gate definitions. Which branches may target which, when a merge needs
approval, and what a work item must satisfy before it merges are owned by the rules below.

**This pipeline never merges the final PR.** That is not a step it happens not to take — it is the
terminal constraint the rule places on it.

## Rule Anchor

- [backlog-execution.md](../../rules/backlog-execution.md) — "Base Branch Workflow" (the initiative's
  branch/PR shape and its never-auto-merge terminal constraint), "One-Backlog-At-A-Time Rule", "PR Unit
  Rule", "Stop Conditions".
- [git-branch.md](../../rules/git-branch.md) — protected branches, allowed PR sources, fresh-base
  requirement, one-branch-at-a-time, merge approval, "Merge Landing Verification".

## Preconditions (refuse to start otherwise)

1. The initiative's items are enumerated and ordered. An open-ended "and whatever else comes up" is not an
   initiative; it is a series of separate work units.
2. More than one item genuinely belongs to it. A single item does not need a base branch — dispatch
   [backlog-execution-orchestrator](../backlog-execution-orchestrator/SKILL.md) directly and stop here.
3. No other branch from this session is open (the one-branch-at-a-time constraint the rule owns).
4. The items are **related** — they share files or contracts, so they must serialize. Genuinely disjoint
   items are not an initiative: they are separate PR units, and running them concurrently is
   [worktree-parallel-orchestration](../worktree-parallel-orchestration/SKILL.md)'s job, not this
   pipeline's. The discriminator is the rule's PR Unit Rule § Sequence by relatedness.

If any precondition fails → **terminate** and report which.

## Steps and routing

**1. Establish the integration base branch, cut fresh from the integration branch.** Fetch first: a base
cut from a stale local ref carries divergence into every child that follows.

| Outcome                                                      | Route                                                                                        |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Base created from a freshly-fetched ref                      | Advance to step 2.                                                                           |
| The base already exists from an earlier session              | Verify it is still a descendant of the integration branch, then take step 4's routing first. |
| The integration branch is not in the state the rule requires | **Return `HALT`.** Never cut a base from an unclear starting point.                          |

**2. Run the next item through the per-item pipeline, against the base.** Dispatch
[backlog-execution-orchestrator](../backlog-execution-orchestrator/SKILL.md) for exactly one item, telling
it that the integration base — not the shared integration branch — is its child branch's origin and its
PR's target.

| Per-item outcome                                    | Route                                                                                                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COMPLETE`                                          | The child PR is merged into the base. Advance to step 3.                                                                                             |
| `HALT`                                              | **Return `HALT`** with the item's own reason. Do not start the next item to keep momentum — the one-item-at-a-time constraint is not suspended here. |
| The item turns out not to belong to this initiative | Drop it from the enumeration, record why, and repeat step 2 with the next item. Do not merge unrelated work into the base.                           |

A child PR merges into the base only when its checks are green **and** its content matches the
recommendation endorsed for it — the rule makes both conditions, not just the first. A mismatch goes
back to the item's own pipeline, which re-enters its recommendation gate for the enlarged scope.

A child PR whose checks are red never merges into the base. That failure belongs to the item's own
pipeline, which owns the fix-and-re-verify loop; this level does not reach into it and does not merge
around it.

**3. More items?**

| Condition                          | Route                                                |
| ---------------------------------- | ---------------------------------------------------- |
| Items remain                       | **Return to step 4**, then step 2 for the next item. |
| Every item is merged into the base | Advance to step 5.                                   |

**4. Keep the base from drifting.** Before each subsequent item, check whether the integration branch has
moved since the base was cut. The rule flags mid-flight divergence as a gap; this is its edge.

| Outcome                                                  | Route                                                                                                                                                       |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The base is still a descendant of the integration branch | Continue to step 2.                                                                                                                                         |
| The integration branch has moved, and syncing is clean   | Sync the base forward as its own change on the base — not folded into any item's child PR — then continue to step 2.                                        |
| Syncing conflicts materially                             | **Return `HALT`.** A conflicted integration base is a decision, not a merge: the user owns the final PR and must own this. Report what conflicts with what. |

**5. Open the final PR from the base into the integration branch — and stop there.** Its description
records what each item contributed and each item's gate result, per the rule's PR contract.

| Outcome                                       | Route                                                                                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| The PR is open and its checks are green       | Return `COMPLETE`. **Hand it to the user unmerged.** Do not enable auto-merge, and do not merge on a later turn without a fresh decision. |
| A check on the final PR is red                | Fix it on the base — never by force-merging, and never by amending a merged child. Then re-open this step.                                |
| The base diverged again while the PR was open | **Return to step 4**, then re-open this step against the new head.                                                                        |

## Outcome contract

Return exactly one to the caller:

- `COMPLETE` — every item landed on the base and the final PR is open, green, and **unmerged**, awaiting
  the user.
- `HALT` — an item halted, a stop condition fired, or the base could not be kept coherent. Name which, and
  name which items already landed so the state is recoverable.

There is no outcome in which this pipeline reports the initiative merged. If the final PR is merged, a
human decided that.

## What This Skill Does NOT Do

| Not this skill's job                               | Owner                                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| Anything inside one item's execution               | [backlog-execution-orchestrator](../backlog-execution-orchestrator/SKILL.md) |
| Define branch, PR-target, or merge-approval policy | [git-branch.md](../../rules/git-branch.md)                                   |
| Judge whether a child merge landed                 | `merge-verifier` (agent)                                                     |
| Decide the initiative ships                        | the user                                                                     |
