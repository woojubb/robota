---
title: 'CORE-048: a forced tool call as a structured-output transport — whether a synthetic schema tool may be injected into a user tool set, now that a capability gate exists to decide when'
status: todo
created: 2026-08-17
priority: medium
urgency: next
area: packages/agent-core, packages/agent-provider-openai, packages/agent-provider-anthropic
depends_on: [CORE-043]
---

# CORE-048: forced-tool-call transport, now that something can decide when to use it

CORE-038 proposed this and was judged `DEPTH: FOUNDATIONAL` — the transport may well be right, but it
was stated one layer above its cause. [CORE-043](CORE-043-structured-output-capability-has-no-runtime-representation.md)
built that layer: a `(provider, model)` pair now resolves to a `TStructuredOutputMechanism`, and the
request is shaped to match at one seam. This is the remaining question, and it is now answerable.

## The question

For a model with **no schema parameter but working strict tool arguments**, a forced call to a
synthetic tool whose parameters ARE the output schema is a real transport — strict tool arguments are
enforced where `json_object` is not. CORE-043 left `'tool_strict'` out of the mechanism vocabulary on
purpose: a union member nothing produces is a branch every consumer must handle and no test can reach.

What has to be decided before it earns a member:

1. **Name collision.** The synthetic tool goes into a tool set the user owns. `respond_with_schema`
   is not reserved. A collision silently replaces the user's tool or is silently replaced by it.
2. **The model picks a real tool instead.** Under `toolChoice: 'required'` the model may call one of
   the user's own tools. CORE-017 already makes forcing directives apply to round 1 only, so this
   interacts with an existing rule rather than being free to define.
3. **Whether it beats what CORE-043 already ships.** The prompt statement now goes out on attempt
   one, so the baseline this is measured against is no longer "guaranteed failure on attempt one".
   The case has to be made against the improved baseline, not the original defect.
4. **Which providers actually qualify.** `strictTools` exists on `agent-provider-openai` (PROV-007);
   nothing else in the workspace has an equivalent. A transport with one implementation may not be
   worth a vocabulary member.

## Direction

Answer (1)–(4) with a design, per `code-quality.md:50` — lead with the architecturally-correct shape
and validate it, rather than posing a multiple-choice question before a design exists. If the answer
is that the improved baseline is good enough, that is a legitimate outcome and this item closes with
it recorded.

## Test Plan

To be written with the design. It must at minimum pin: a name collision with a user tool is detected
rather than resolved silently, and a run whose model calls a real tool under the forced directive
still terminates.

## User Execution Test Scenarios

To be authored when this item is picked up. Expected `agent-executable` and provider-free — the
tool-set assembly and the collision check are both observable without a network call.
