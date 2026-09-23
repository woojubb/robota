---
name: multi-backlog-initiative
description: Execute several related work items on one integration base; use the single-item route otherwise.
invocable: true
---

# Multi-Backlog Initiative

Use this route only when several accepted work items share files or contracts and need one integration base.
Disjoint work remains separate; a single item uses `backlog-execution-orchestrator`.

## Entry boundary

1. Name the authoritative issue or request and enumerate the bounded item set.
2. Follow [`git-branch.md` § Branch Policy](../../rules/git-branch.md#branch-policy) for the fresh integration
   base, protected branches, migration evidence, and merge authorization.
3. Record which files or contracts force the items to share the base. Do not create a second lifecycle,
   planning-only commit, or per-item gate ledger.

## Execution

1. Complete each item as one coherent change against the integration base, with focused local verification.
2. Land an item on the base only after its review and applicable checks pass. A red check or unresolved
   finding returns to that item; it does not create a new process artifact.
3. Before starting the next item, confirm the base still has a clear relationship to its upstream. A real
   conflict requires resolution; a conflict-free upstream advance does not force unrelated rework.
4. After the bounded set is integrated, open one final pull request to the intended branch. Do not merge it
   without the authorization required by the branch policy.

## Completion boundary

Complete only when every enumerated item is accounted for, the combined result passes the applicable
verification, and the final landing is independently confirmed. Report omitted or deferred items explicitly.

The authoritative issue/request and pull requests own durable state. Do not create continuation commits,
receipt-only commits, copied Task/spec lifecycle projections, N/A dispatches, or repeated clean reviews.
