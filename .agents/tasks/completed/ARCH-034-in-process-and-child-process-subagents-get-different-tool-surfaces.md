---
title: 'ARCH-034: in-process and child-process subagents get different tool surfaces'
status: done
completed: 2026-08-19
created: 2026-08-16
priority: medium
urgency: later
area: packages/agent-framework, packages/agent-subagent-runner
depends_on: []
issue: https://github.com/woojubb/robota/issues/1785
---

# ARCH-034: in-process and child-process subagents get different tool surfaces

## Problem

Found by `proposal-reviewer` while testing ARCH-021's premises. Filed rather than folded in: real,
but not #1777's cause, and ARCH-021 neither creates nor worsens it.

The in-process subagent runner inherits session-level extras the child-process path does not —
background process, goal tool, projected command tools, checkpoint wrappers. So two runners of the
same `ISubagentRunner` contract give a subagent different tool surfaces depending on which one the
composition root selected.

That is a contract-conformance problem in its own right: the choice of runner is supposed to be an
isolation/packaging decision, not a capability decision.

## Result

Delivered, and the measurement narrowed the item on the way.

**What the difference actually was.** Both runners hand `createSubagentSession` a `parentTools` array
and both are filtered identically from there, so parity was entirely a question of what each put IN
it. In-process passes `deps.tools` — the parent's fully ASSEMBLED surface. Child-process rebuilds the
product's set at its own root.

The item listed "background process, goal tool, projected command tools, checkpoint wrappers" as the
gap. Measured, most of that was already closed: `robota`'s child composition builds from the same
packs (`packTools`), so the pack tools — which for this product are the whole tool surface — do cross.
What did NOT cross is what session assembly adds AFTER the packs: the goal tool (`includeGoalTool`)
and edit-checkpoint wrapping. Recording that narrowing matters, because acting on the item as written
would have re-plumbed tiers that already agreed.

**The fix.** `ISubagentWorkerComposition.createTools` takes `sessionTiers`, the recipe carries it, and
the worker passes it through. The tier is a property of the PARENT'S session rather than of the
child's root, which is why it rides on the payload beside the request instead of being derived at the
child. `robota`'s composition appends the goal tool when — and only when — the parent had it.

**Parity means matching, not maximising.** A child that always received the goal tool would diverge
from an in-process sibling in the other direction, so the cases assert both edges. Mutation-checked:
dropping the tier turns one red, adding it unconditionally turns six red.

**Not closed here.** Edit-checkpoint wrapping stays with the parent. Its recorder is a live
owner-bound handle, so crossing it is ARCH-033's problem rather than this one's, and the projection
seam that item added is where it would go.

## Blockers

- None.
