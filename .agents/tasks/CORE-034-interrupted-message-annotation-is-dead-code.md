---
title: 'CORE-034: the interrupted-message annotation contract (getMessagesForAPI) is dispatched by nothing — the model never sees "[This response was interrupted by the user]", so the documented mechanism for it to understand a cut-short turn is dead code'
status: todo
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-core
depends_on: []
---

# CORE-034: interrupted-annotation projection is never used

## Problem

The SPEC documents `getMessagesForAPI()` as the projection that annotates interrupted assistant
messages with `[This response was interrupted by the user]` so the model understands its previous turn
was cut short. The method exists but has zero callers — every provider request is built from raw
`getMessages()` — so interrupted state is stored but never surfaced to the model, and the documented
purpose is not delivered by any execution path.

## Evidence (round-2 engine audit, 2026-08-13)

- `packages/agent-core/docs/SPEC.md:1036-1038` — "`getMessagesForAPI()` prepares the conversation
  history for provider API calls. For interrupted assistant messages … the text is annotated with
  `[This response was interrupted by the user]` suffix. This allows the model to understand that its
  previous response was cut short."
- `packages/agent-core/src/managers/conversation-store.ts:216-231` — the method exists with the
  annotation, but a monorepo-wide search finds ZERO call sites.
- Every provider request is built from raw `conversationStore.getMessages()` —
  `execution-round.ts:79`, `execution-stream.ts:106`.

## Direction

If the annotation is wanted (the SPEC argues it is, for coherent post-abort model context), route the
provider-message derivation through the annotating projection on both the round and streaming paths. If
it is not wanted, delete the SPEC section and the method. Owner decision. (Distinct from RUNTIME-002..006,
which cover cancellation delivery, not the model's context on the turn AFTER an abort.)

## Test Plan

- Red-first: after an interrupted turn, the next provider request's messages contain the interruption
  annotation on the interrupted assistant message (fails today — raw messages, no annotation); OR (if
  deleting) the method and SPEC section are gone.
- `pnpm harness:verify -- --scope packages/agent-core` green.

## User Execution Test Scenarios

**Applies** (interrupting a turn then continuing is a normal CLI interaction).

- Prerequisites: built CLI + provider key.
- Steps: start a long turn, press ESC to interrupt it mid-response, then send a follow-up asking the
  model about its previous (cut-short) answer.
- Expected (after the "wire it" fix): the model is aware its previous response was interrupted (it does
  not treat the partial as complete).
- Expected (before fix, contrast): the model sees the partial as a normal completed message with no
  interruption marker.
- If "delete" is chosen: Not applicable — record the removal in the Test Plan.
- Evidence (fill in after implementation): the follow-up turn's transcript showing the model's
  awareness (or the removal diff).
