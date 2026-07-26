---
id: INFRA-057
title: review-gate's auto-merge disarm may lack the permission it needs, silently
status: todo
priority: high
type: INFRA
created: 2026-07-26
---

## Problem

`review-gate` blocks a PR by failing **and** calling `gh pr merge --disable-auto`. That second half is
not decoration — it is INFRA-048's stated lever for the defect the whole gate exists to close:

> a red **non-required** check does not stop an armed auto-merge — which is precisely the #1409 hole.

Observed in the gate's own log on #1461, immediately after a genuine block:

```
GraphQL: Resource not accessible by integration (disablePullRequestAutoMerge)
auto-merge was not armed; nothing to disarm.
```

The workflow's `GITHUB_TOKEN` appears not to be permitted to call `disablePullRequestAutoMerge`. The
run then reports "nothing to disarm", which reads like a clean no-op — so **a permission failure and
a genuine no-op are indistinguishable in the log.**

It did not matter on #1461 because auto-merge was never armed there. It would matter the first time
a PR has auto-merge armed and the gate blocks it: the merge would proceed on the gating checks while
the gate's findings went unread, which is #1409 reproduced exactly.

## Why this is not resolved by `review-gate` now being required

`review-gate` was added to `protect-develop`'s required checks on 2026-07-26, which means a red gate
now blocks the merge by itself on `develop`. That is the durable fix and it makes the disarm
redundant **there**.

It does not make this moot:

- The gate also runs on PRs into `main`, where `protect-main` requires a different set
  (`promotion ancestry`, `main PR source guard`, `release-grade verification`) that does **not**
  include `review-gate`.
- A required check can be removed again — it already was once, on 2026-07-26, when the gate blocked a
  docs-only PR and had to be rolled back. The disarm is the belt to the ruleset's braces.
- A lever that is believed to work and does not is worse than a missing one, because it is budgeted
  for. INFRA-048's design explicitly leans on it.

## What to establish

1. **Whether the call actually failed on permissions**, or the message is emitted on a path where
   nothing was armed. Read the step body: the ordering of the `gh` call and the "nothing to disarm"
   message decides this. Do not infer it from the log's adjacency.
2. If it is a real permission gap: the token needs the scope that permits
   `disablePullRequestAutoMerge`. Determine whether a workflow-level `permissions:` block can grant
   it, or whether it requires a token the default `GITHUB_TOKEN` cannot be given — in which case say
   so plainly, because the honest outcome may be "this lever cannot work with the default token" and
   the design should stop relying on it.
3. **Make the failure loud either way.** The current output cannot distinguish "disarmed",
   "nothing to disarm" and "not permitted to disarm". Those are three different states and only one
   is benign.

## Red-first

Arm auto-merge on a throwaway PR that the gate will block, and observe whether the merge is actually
prevented. That is the only proof that matters; everything else is reading the log. Close the PR
without merging it either way.

## Acceptance

- [ ] The three states are distinguishable in the gate's output.
- [ ] Either the disarm demonstrably works on an armed PR, or the design records that it cannot and
      names what carries the guarantee instead.

## References

- `.github/workflows/review-gate.yml` — the Decide step
- `.agents/backlog/INFRA-048-review-arrives-after-merge.md` — the design that relies on the disarm
- #1409 (the original hole), #1461 (where the permission line was observed)
