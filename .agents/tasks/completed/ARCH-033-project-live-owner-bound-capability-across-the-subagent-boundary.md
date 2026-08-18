---
title: 'ARCH-033: projecting live owner-bound capability across the subagent process boundary'
status: done
completed: 2026-08-19
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

## Delivered 2026-08-19

The projection exists. `(type, snapshotId)` crosses the boundary; the live handle does not.

### What the investigation got wrong first

An earlier pass on this item concluded nothing was implementable, because no production code
constructs a sandbox client and the worker composition carries no live handles. That reasoning
mistook "no consumer exists" for "no work exists", and it was wrong twice over.

**First, a live defect was hiding behind the conclusion.** `assertChildProcessSubagentsCanReproduce`
was exported, unit-tested, and called by NOTHING. Its docblock claimed to run inside `startCli`; the
CLI imports two other symbols from that module and never the guard. The deeper cause:
`createRobotaPackSet(cwd: string)` built `{ cwd }` and nothing else, so the pack context had no slot
for a `sandboxClient` and the capability check returned `[]` **by construction** — not because robota
supplies no sandbox, but because the function could not receive one. A guard whose input cannot vary
cannot fire. The unit tests missed it because they built the context themselves and called the guard
directly: that proves the function works, not that the product ever asks.

**Second, a new example made the problem executable.** `examples/capabilities/sandboxed-tools`
composes a sandboxed tool surface and takes a snapshot — which showed the reference is _a string_.
That reframed the whole item: what a recipe cannot carry is not the state, it is the CONSTRUCTOR.

### The design

The same shape as `providerDefinitions`, and for the same reason — `createProvider` is code, so the
child builds its own against a registry rather than receiving an instance.

- `ISubagentWorkerComposition.sandboxFactories` — the composition root registers a constructor per
  type name.
- `ISubagentWorkerStartPayload.sandboxProjection` — the recipe carries `{ type, snapshotId }`.
- `restoreProjectedSandbox()` resolves one against the other, and the worker threads the result into
  `createTools({ cwd, sandboxClient })` so the child acts where the parent acts.

Three decisions, each toward the safe side:

- **Both halves are required.** A snapshot with no registry is a reference nothing opens; a registry
  with no snapshot rebuilds an EMPTY sandbox — a child that looks sandboxed while sharing none of the
  parent's state, which is worse than refusing. `snapshot()` is optional on `ISandboxClient`, so a
  client that cannot produce a reference stays unprojectable however well-named its type.
- **An unregistered type THROWS**, rather than degrading to host tools. A child told it is sandboxed
  that quietly is not is ARCH-010's shape. The error names the seam to register in.
- **The runner stays neutral.** It does not import `ISandboxClient` — this package depends on
  agent-core, agent-executor, agent-framework, agent-interface-transport and agent-process,
  deliberately not on agent-tools, and adding an edge to describe a value it only passes through is
  the shape ARCH-021 removed here on the provider axis.

`nonReproducibleCapabilities` was not deleted; its MEANING changed. A sandbox is non-reproducible only
while nothing can rebuild it, so registering a factory and naming the type leaves nothing to refuse —
asserted through the same function the product actually calls, not through a direct call.

### Verified

- Guard wiring red-proved: deleting its call site turns the new case red while the nine direct-call
  cases stay green.
- Projection mutation-checked: making the unregistered-type branch unreachable turns three cases red;
  calling the factory without the snapshot reference turns one red.
- The example runs and typechecks; `verify-like-ci` 12/12 on each commit.

### Still open, deliberately

No product registers a sandbox factory yet, so robota's behaviour is unchanged — it passes no sandbox
and composes exactly as before. The seam is what a product needs the day it adds one, and the refusal
remains correct for any product that has not.

## Blockers

- None.

## Result

Delivered. See "Delivered 2026-08-19" above for the design, the three safety decisions behind it, and
what the first investigation got wrong before the example made the problem executable.
