---
title: 'PROV-009: nothing constrains a provider package to be a pure translator of IChatOptions — agent-provider-openai publishes a construction-time responseFormat/jsonSchema surface that no core seam can observe, so a request can be shaped by a channel core neither sees nor reports'
status: todo
created: 2026-08-16
priority: high
urgency: soon
area: packages/agent-core, packages/agent-provider-openai
depends_on: []
---

# PROV-009: a provider may shape the request behind core's back

Filed under [finding-depth.md](../rules/finding-depth.md) from a `DEPTH: FOUNDATIONAL` verdict
(`finding-depth-triager`, 2026-08-16) on an expansion CORE-043's design had absorbed.

## Problem

A provider package is supposed to translate `IChatOptions` onto its wire. Nothing enforces that, and
`agent-provider-openai` does more: `IOpenAIProviderOptions` publishes
`responseFormat?: 'text' | 'json_object' | 'json_schema'` and `jsonSchema`
(`src/openai/types.ts:124,128`) as **construction-time** options, merged inside the provider by
`mergeChatResponseFormat(input.providerOptions, input.chatOptions?.responseFormat)`
(`src/openai/chat-completions-chat.ts:147-148`).

So a request's response format can be decided at provider construction, where **no core seam can see
it**. Any core-side gate on structured output is bypassed by that path, and any core-side report of
what the request carried is wrong for it — not stale, wrong.

**The package SSOT does not mention it.** `packages/agent-provider-openai/docs/SPEC.md` has zero
occurrences of `responseFormat`, while the option is published in the generated API reference
(`content/v2.0.0/api-reference/openai/interfaces/IOpenAIProviderOptions.md:84`). A published option
absent from its own package contract is the shape this repository keeps rediscovering.

**Correction to an earlier claim.** CORE-043's design asserted the caller set was "verified empty …
no constructor caller anywhere in the workspace". That is **false**, and the error is instructive: the
sweep that produced it excluded `*.test.*`, and the one caller is a test —
`packages/agent-provider-openai/src/openai/provider.test.ts:313-326` constructs
`new OpenAIProvider({ apiKey, responseFormat: 'json_schema', jsonSchema })` and asserts the mapping.
A removal argued from an empty caller set must re-derive that set without the exclusion.

## Direction

Decide the boundary rule first, because it is the general question and the OpenAI option is one
instance: **may a provider package shape a request from anything other than `IChatOptions`?** If no,
the option is removed or demoted to a default that core-supplied options always override, and the rule
gets a mechanical floor so the next provider cannot re-open it. If yes, then every core-side claim
about what a request carries must be scoped to "what core supplied", and say so.

PROV-004 files four sibling divergences on this same contract; this is the fifth and the only one
where the provider adds a surface rather than dropping one.

## Relationship to other items

- **CORE-043** is blocked in one criterion only (its gate/report claim for the OpenAI path), not in
  its thesis. It should scope its claim to the core turn path until this lands.
- **PROV-004** owns the sibling-divergence set; this is adjacent, not a duplicate — that item is about
  providers implementing the shared contract _unequally_, this one about a provider implementing
  _more_ than it.

## Test Plan

- A test pins that a core-supplied `IChatOptions.responseFormat` and a construction-time option cannot
  disagree on the wire — whichever precedence is chosen, it is asserted rather than emergent.
- The package SPEC states the outcome; a doc test or scan fails if a published provider option is
  absent from its package SPEC.
- `pnpm harness:verify -- --scope packages/agent-provider-openai` green.

## User Execution Test Scenarios

Applies if the option is removed — that is an observable change for anyone constructing the provider
that way.

**Scenario 1 — construction-time format no longer bypasses the core option**

- Prerequisites: an OpenAI API key exported; `pnpm build`.
- Environment: uses the existing examples surface; confirm at implementation time which example
  constructs a provider directly.
- Steps: construct the provider with a construction-time `responseFormat`, then issue a run supplying
  a different `responseFormat` through the core option, and print what the request carried.
- Expected observable result: the core-supplied option wins (or the construction option is rejected at
  construction with a message naming the replacement) — one stated precedence, not a silent merge.
- Cleanup: none.
- Evidence: _to be filled after implementation_.
