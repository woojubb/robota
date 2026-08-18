---
title: 'ARCH-033: projecting live owner-bound capability across the subagent process boundary'
status: todo
created: 2026-08-16
priority: high
urgency: soon
area: packages/agent-subagent-runner, packages/agent-cli, packages/pack-coding
depends_on: []
issue: https://github.com/woojubb/robota/issues/1784
---

# ARCH-033: projecting live owner-bound capability across the subagent process boundary

## Problem

ARCH-021 makes the child reproduce the product's composition from a **recipe**. A recipe carries
anything that is a pure function of (execution root, serialized payload, ambient durable state). It
cannot carry a live, unrepeatable handle.

Concretely today: `ICodingPackOptions.sandboxClient`. `E2BSandboxClient` and `InMemorySandboxClient`
are both exported from `agent-tools`'s barrel, so a consumer can compose a sandboxed parent. ARCH-021
handles this by **refusing** to select the child-process runner in that case — correct, but a refusal
is not a projection.

`ISandboxClient` carries `snapshot()` / `restore(snapshotId)`, so a sandbox is in principle projectable
via a snapshot reference — but only to a child that can construct the same client, which is again the
composition root's job. That is the design space this item owns. Also in scope: live owner-bound
services generally (event/ask services bound to the parent's session).

Not urgent: robota supplies no sandbox client today, so ARCH-021's refusal is correct-by-construction
and binds the moment one is added.

## Investigated 2026-08-19 — nothing is implementable yet, and that is a measurement

Picked up while working the ARCH backlog. Both axes this item names were checked against the code
rather than against the record, and neither has work that can be built and verified today.

**The sandbox axis has no consumer.** No production file anywhere in `packages/` or `apps/`
constructs an `E2BSandboxClient` or an `InMemorySandboxClient` — the only constructions are in tests.
So `nonReproducibleCapabilities()` returns `[]` for every real composition, and ARCH-021's refusal is
correct-by-construction exactly as this item already said. `robota-subagent-composition.ts` implements
that refusal, is guarded by its own test, and documents its own limit honestly (it refuses at
composition time inside `startCli`, so robota declines to START rather than declining an individual
spawn — an earlier wording claimed a spawn refusal that does not exist).

**The live-services axis is closed by design, not open by omission.** `ISubagentWorkerComposition`
carries exactly two members: `createTools(context)` and `providerDefinitions`. No live handle crosses
the boundary, and the reasoning is written at the contract: proxying an instance loses containment,
because a proxied tool executes in the PARENT bound to the parent's checkout while a worktree-isolated
child's execution root is a different directory. The recipe crosses and the child rebuilds an
equivalent surface at its own root.

**So building a projection now would be speculative machinery**: no consumer to exercise it, no
red proof available, and the user-execution gate would have nothing to verify. That is a different
situation from an unconsumed contract deliberately prepared for the future — this would be an
unconsumed MECHANISM invented ahead of the capability it projects.

### What would make this actionable

A sandbox client being constructed by a real composition root. At that moment the refusal starts
firing and the projection question becomes concrete: `ISandboxClient` carries `snapshot()` /
`restore(snapshotId)`, so a snapshot reference is projectable — but only to a child that can construct
the same client, which is the composition root's job, and that is the design this item owns.

Left OPEN deliberately rather than closed. Closing it would lose the analysis; implementing it now
would build a mechanism nothing can exercise. The trigger is named above so the next reader does not
repeat this investigation.

## Blockers

- No sandbox client exists in any production composition, so the capability this item projects cannot
  be exercised end to end. Not a blocker to be removed — a precondition that has not arrived.

## Result

Pending — deliberately. See the investigation above for why, and for the trigger that changes it.
