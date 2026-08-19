---
title: 'CORE-048: a forced tool call as a structured-output transport — whether a synthetic schema tool may be injected into a user tool set, now that a capability gate exists to decide when'
status: done
created: 2026-08-17
completed: 2026-08-17
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

## Answer: it has no applicable provider. Closing with that recorded.

Questions (4) and (3) settle it, and they settle it by MEASUREMENT rather than by judgement. The
transport is worth something only for a `(provider, model)` pair that BOTH lacks a schema parameter
AND has enforceable strict tool arguments. Across the workspace, that intersection is **empty**:

| provider  | resolved mechanism              | strict tool arguments              |
| --------- | ------------------------------- | ---------------------------------- |
| openai    | `response_schema` (undeclared)  | **YES** — `strictTools` (PROV-007) |
| anthropic | `response_schema` (json_schema) | no                                 |
| gemini    | `response_schema` (json_schema) | no                                 |
| gemma     | `response_schema` (undeclared)  | no                                 |
| deepseek  | `json_object`                   | no                                 |
| qwen      | `none` (declares `tools` only)  | no                                 |

**(4) Which providers qualify — none.** `strictTools` exists in exactly one package,
`agent-provider-openai`, and `rg -l 'strictTools'` over the other four provider packages returns
nothing.

**(3) Does it beat the improved baseline — it cannot, because it never applies.** Every provider that
HAS strict tool arguments already resolves to `response_schema` and receives the schema as a native
parameter, so a forced tool call would carry nothing the request does not already carry. Every
provider that LACKS a schema parameter (`deepseek` → `json_object`, `qwen` → `none`) has no
strict-tool support to carry it instead — and against those, CORE-043 already states the schema in
the prompt on attempt ONE, which is the baseline this had to beat.

**(1) and (2) are not answered, deliberately.** A name-collision policy and a
model-picks-a-real-tool rule designed against no implementation would be designing for a provider
nobody has. They are recorded verbatim in the test below as what must be answered FIRST if the
premise ever changes.

So `'tool_strict'` still does not earn a member of `TStructuredOutputMechanism` — and it is now
declined with a measurement rather than with the caution CORE-043 had. A union member nothing
produces is a branch every consumer must handle and no test can reach.

## The tripwire, which is the part that lasts

A decision written down is a decision nobody re-opens, and the premise here is a property of the
PROVIDER SET — which changes. The day a provider gains strict tool arguments without a schema
parameter, this question becomes live and nothing would say so.

`packages/agent-provider-defaults/src/forced-tool-transport-applicability.test.ts` fails on that day.
It lives there because `agent-provider-defaults` is the only package that depends on every provider;
`agent-core` may not, and no single provider can see its siblings.

Proved to fire by simulating the change it watches for — giving OpenAI a tools-only capability table,
so it keeps `strictTools` while losing its native schema parameter:

```
× no provider both lacks a schema parameter AND has strict tool arguments
  → expected [ 'openai' ] to deeply equal []
× the providers that DO lack a schema parameter are the ones with no strict tools
  → expected [ 'deepseek', 'openai', 'qwen' ] to deeply equal [ 'deepseek', 'qwen' ]
```

**One export followed from this.** `resolveStructuredOutputCapability` was internal while the types it
produces — `TStructuredOutputMechanism`, `TStructuredOutputProvenance` — were already public, so a
caller could name the answer but not obtain it. It is exported now, which is also what lets a
consumer ask, before spending a call, what will happen to their schema against a given pair.

## Test Plan

The plan named two pins for an implementation that is not being built, so they do not apply. What
replaces them is the pin for the DECISION, which is what this item actually produced:

`packages/agent-provider-defaults/src/forced-tool-transport-applicability.test.ts` — three cases:

- no provider both lacks a schema parameter and has strict tool arguments;
- the one provider WITH strict tool arguments already carries the schema natively (the other half of
  the same fact, asserted separately so a change to either side is legible);
- the providers that DO lack a schema parameter are exactly the ones with no strict tools.

Red-proved by simulating the change it exists to catch, rather than by assuming it would fire.

The two original pins are recorded IN that file as questions (1) and (2), beside the assertion whose
failure makes them live — so they are not lost, they are attached to the condition that would make
them worth answering.

`agent-provider-defaults` 9 tests pass.

## User Execution Test Scenarios

**Not applicable**, and for the reason the item's own Direction anticipated: no product behaviour
changed. The transport is not built, no request is shaped differently, and no caller sees anything
new — the outcome is a recorded decision plus a tripwire.

The one user-visible change is that `resolveStructuredOutputCapability` is now exported, and its
behaviour is unchanged from CORE-043, whose scenarios already exercise it end to end
(`scratch/src/core-043-s1.ts`, `scratch/src/core-043-s2.ts`). Re-running them to demonstrate an
export would be theatre, not evidence.

Had the answer gone the other way, the scenario the item sketched — observing tool-set assembly and
the collision check without a network call — would have been the right one, and it is left here for
whoever re-opens this if the tripwire fires.
