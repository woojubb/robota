---
title: 'HARNESS-077: the parallel-work rule is unenforceable as written — can the wait be instrumented?'
status: todo
priority: medium
urgency: later
type: INFRA
area: .agents/rules, scripts/harness
created: 2026-08-05
depends_on: []
---

# HARNESS-077 — a wait leaves no trace

## Problem

`operational.md` § "A Wait Is Not Idle Time" requires that a blocking wait — a continuous-integration
run, a review round, a deploy — is spent progressing an independent item. It is the only rule in that
document whose terminal state is `Enforced by: nothing`, and the reason is not laziness: **the
repository cannot tell the two behaviours apart.**

Two branches in flight is what parallel work produces. It is also what sequential work produces, one
after the other. The tree records what was done, never when the doing was possible, so nothing in it
distinguishes an agent that filled a wait from one that watched it.

## Why it is filed rather than dropped

The rule was written because the cost was measured: four pull requests run strictly one after
another, review rounds of eight to ten minutes each, three to six rounds per request — over two hours
blocked with seventy-one independent items open. A rule with a measured cost and no mechanism is
exactly the state `lesson-to-harness` step 8 says must be WRITTEN DOWN rather than left silent, and
this item is that writing.

## What might make it checkable

Ordered by how much they would actually prove, not by how easy they are:

1. **Wall-clock between a push and the next commit on any branch.** A long gap with other work
   available is the shape of the defect. Weak on its own — a gap is also a meal, a meeting, a
   session ending — so it can only ever be advisory.
2. **A session-level record**, if one exists that is not the repository: the harness already writes
   run-context reports. If a wait and the work taken during it are both observable there, the
   question becomes decidable outside the tree, which is where it belongs.
3. **Accept it as unenforceable and say so permanently.** A legitimate outcome. The rule would keep
   `Enforced by: nothing` and this item would close as `wontfix` with the reasoning recorded — which
   is still better than the silence it replaced.

## Done when

- Either a mechanism exists and the rule names it, or the item closes with a written argument that
  the property is not observable and the rule keeps its declared `nothing`.
- Whichever way it goes, `new-rule-declares-enforcement` keeps the rule honest about its own state.
