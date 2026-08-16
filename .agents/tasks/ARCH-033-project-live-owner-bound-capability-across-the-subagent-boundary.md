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

## Blockers

- None.

## Result

Pending.
