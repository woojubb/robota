---
title: 'PROV-010: an image already in the conversation is sent to whatever model runs next, so gating on `vision` has to answer what happens to history — refusing the turn strands the conversation, and ignoring history sends an image to a model that cannot see one'
status: todo
created: 2026-08-16
priority: medium
urgency: soon
area: packages/agent-core, packages/agent-provider-gemini, packages/agent-provider-openai-compatible
depends_on: []
---

# PROV-010: vision gating has a history problem, and both naive answers are wrong

Split out of [PROV-006](completed/PROV-006-per-model-capability-flags-declared-but-read-by-nothing.md),
whose first implementation shipped a `vision` guard and whose PR review refused it — correctly.

## Problem

PROV-006 made the per-model capability vocabulary readable, and `vision` is one of its six flags.
Consuming it looks trivial: refuse a request that carries an image when the model's catalog entry
omits `vision`. It is not trivial, because **the conversation is what gets sent, not the new
message.**

### Neither obvious answer works

**Refuse the turn when the outgoing messages carry an image.** This is what PROV-006's first
implementation did, and PR review found the defect: `setModel()` is a public API designed to change
models while preserving the conversation
(`packages/agent-core/src/core/robota-config-manager.ts:177`). Send an image to a vision-capable
model, switch to one without `vision`, and **every later text-only turn is refused for ever** —
because the history still holds the image. The user is not asking about the image; the conversation
is simply stranded.

**Refuse only when the NEW message carries an image.** The obvious narrowing, and it reintroduces the
defect it was meant to fix. Verified at source: the adapters send historical image parts to the
vendor —
`packages/agent-provider-openai-compatible/src/shared/openai-compatible/message-converter.ts:43-58`
converts every image part of every message it is given, and
`packages/agent-provider-gemini/src/gemini/request-converter.ts:35` does the same. A stale image in
history reaches a non-vision model regardless of what the new message says.

So the guard cannot be scoped by "which message", because the thing sent is the whole conversation.

## Direction

The decision is what happens to image parts that a model cannot see, and it is a real design choice
rather than a defect with one right answer:

- **Strip and report.** Drop image parts from the outgoing messages for a model that cannot see
  them, and say so — once per turn, through the diagnostics sink CORE-029 gave a destination. The
  conversation stays usable and the model never receives content it cannot process. The cost: the
  model answers about a conversation that is missing something, which is a real semantic change and
  must be visible rather than silent.
- **Refuse, with a way out.** Keep refusing, but make the error name the situation — the CONVERSATION
  carries an image, not merely "this model does not support images" — and say what resolves it
  (switch back, compact the history, start a new conversation). Honest, and still a dead end for a
  user who does not want to do any of those.
- **Refuse only the model SWITCH.** Move the check to `setModel()` / `swapDefaultProvider()`: refuse
  to switch to a non-vision model while the conversation holds an image. Catches it at the moment
  the user chooses, when a good message can be written, and leaves every turn unguarded afterwards.
  Interacts with CORE-047, which owns whether that API is reachable at all.

Whichever is chosen, the rule PROV-006 established still binds: only a POPULATED capability list that
omits `vision` is a denial. A catalog silent about a model has said nothing.

## Test Plan

- Red-first: a conversation that already carries an image, switched to a model whose entry omits
  `vision`, then given a **text-only** turn — the turn must not fail with "does not support images".
  This is the case the reverted implementation failed.
- An image sent to a non-vision model does not silently reach the vendor as if it had been read.
- Whatever the answer, it is observable: a stripped part is reported, a refusal names the
  conversation rather than the message.
- The silence rule: a model no catalog describes still accepts images.

## User Execution Test Scenarios

**Applies** — this is user-visible behaviour of a published SDK entry point and of model switching.
Author the scenario when the item is picked up: a scripted vision-capable provider, an image turn, a
switch to a non-vision model, then a text-only follow-up. No API key needed — the observables are the
request the agent builds and the error or report it produces.
