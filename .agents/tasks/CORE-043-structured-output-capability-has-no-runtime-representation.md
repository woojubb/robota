---
title: 'CORE-043: structured-output capability has no representation the runtime reads — agent-core emits `responseFormat` unconditionally, each provider silently maps or discards it, the seam cannot tell which, and the fact is a property of the instantiated PACKAGE rather than the endpoint and model actually called, so the documented gateway configuration reports enforcement it does not have'
status: todo
created: 2026-08-16
priority: critical
urgency: now
area: packages/agent-core, packages/agent-provider-openai, packages/agent-provider-openai-compatible
depends_on: []
---

# CORE-043: structured-output capability is not represented at runtime

Root item filed under [finding-depth.md](../rules/finding-depth.md) for the `DEPTH: FOUNDATIONAL`
verdict on [CORE-038](completed/CORE-038-forced-tool-call-as-structured-output-fallback-transport.md)
(2026-08-16). Registered as [issue #1750](https://github.com/woojubb/robota/issues/1750); the
proposal it was raised from is [issue #1738](https://github.com/woojubb/robota/issues/1738).
CORE-038 proposed a transport (forced tool call instead of a prose re-prompt); the
transport may well be the right one, but it is stated one layer above its cause.

**This item is not a proposal to implement. Several of its load-bearing decisions are reserved for
the owner** — see § Decisions reserved for the owner. What can proceed without them is listed there
too.

## Problem

`agent-core` emits `IChatOptions.responseFormat` on every structured run. Each provider package
either maps it onto a native surface or silently discards it. **The seam has no way to know which
happened, and no way to react.**

The one place the fact could live is per-model capability: `TProviderModelCapability`
(`packages/agent-core/src/interfaces/provider-definition.ts:66-67`) already contains `'json_schema'`.
It is read by nothing (PROV-006), and it is declared **falsely** — all three entries in
`packages/agent-provider-openai-compatible/src/deepseek/model-catalog.ts` claim `'json_schema'`
against an adapter that implements none of it.

Because capability is a property of the **package the caller instantiated** rather than of the
**endpoint and model actually being called**, the configuration the project documents as its gateway
story reports enforcement it does not have:

- `packages/agent-provider-openai/src/openai/provider.ts:66` passes `baseURL` to the SDK, and `:216`
  returns `options.baseURL ? 'chat-completions' : 'responses'` — setting a gateway URL switches to
  the one surface that maps `response_format`.
- `llms.txt:22` advertises exactly that: "OpenAI-compatible gateway via `baseURL` — any gateway
  (Vercel AI Gateway, LiteLLM, OpenRouter), Azure, vLLM, Ollama, LM Studio", and
  `agent-provider-openai/src/openai/types.ts:98` gives a gateway URL as the documented example.

So the advertised configuration sends `response_format: json_schema` to a model that may ignore it,
the endpoint accepts the parameter, and the core-side enforcement loop believes it enforced early.

**And the SPEC has already recorded the cause as intent.** `packages/agent-core/docs/SPEC.md`
§ Structured Output Contract: _"providers without one ignore it — the core-side enforcement loop
below is the universal contract either way."_ That sentence is the design decision that produces
every symptom below.

## Two corrections to what CORE-038 reported

Both verified against `origin/develop` after CORE-039 landed:

1. **There is no first-attempt prose fallback. There is no first-attempt transport at all.**
   `spec.jsonSchema` has exactly two consumers in the run path —
   `packages/agent-core/src/core/robota-execution.ts:173` (config override) and `:186` (the retry
   feedback prose). Nothing injects the schema into attempt 1. On the compat family the adapter
   never reads `options.responseFormat`, so **attempt 1 carries no schema signal whatsoever**. The
   reporter's measured 0/4 is not a property of their gateway; in robota it is structurally
   guaranteed on that family, and `outputRetries: 0` there can only succeed by luck.
2. **`agent-provider-bytedance` is not a text provider.** `src/bytedance/provider.ts:25` is
   `class BytedanceProvider implements IVideoGenerationProvider` — no `chat()`, no `IAIProvider`.
   Structured output never routes through it; CORE-038's grep found nothing because there is nothing
   to find. Its `area:` frontmatter named the package wrongly.

Relatedly, CORE-038's "openai-compatible is the path for DeepSeek, Groq, Together, OpenRouter,
vLLM/Ollama and any gateway" is wrong in the same direction: that package exports only
deepseek/qwen/gemma, and `llms.txt:22` routes gateways through `agent-provider-openai` instead.

## Evidence: the same defect, filed three times in three days

| Filed      | Item     | Input channel        | What it says                                                                                                                                                                                                                                                                                                                                        |
| ---------- | -------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-13 | PROV-004 | internal critic      | "**responseFormat dropped by the compat family (VIOLATION)** … ZERO references in `agent-provider-openai-compatible/src` … a `json_schema` run's fidelity depends silently on vendor choice", with the direction "thread `responseFormat` through the compat `buildRequestParams` (via `./shared`), or document the intentional per-provider no-op" |
| 2026-08-13 | PROV-006 | internal critic      | the missing mechanism itself: per-model capability flags declared and read by nothing                                                                                                                                                                                                                                                               |
| 2026-08-16 | CORE-038 | external issue #1738 | the same symptom again, as a transport proposal, naming PROV-006 only in a parenthetical                                                                                                                                                                                                                                                            |

Three filings, three channels, no reconciliation between them. That is the cost this item exists to
stop: the fact has no owner, so each observer files it as whatever it looked like from where they
stood.

## Interaction with PROV-007

CORE-038's proposed forced-tool-call transport is **not** dead on arrival —
`convertToOpenAIResponsesTools` sends `strict: strictTools ?? false`, so the default path accepts an
injected schema tool, and the compat family emits no `strict` at all while already mapping
`tool_choice: 'required'`. But a `strictTools: true` user is already wholly broken per PROV-007 (after
CORE-039, Zod's default `strip` emits `additionalProperties: true`, which strict mode refuses). Today
that costs tool users only. If structured output moves onto the tool seam, **PROV-007 becomes a hard
prerequisite on the OpenAI path** rather than an adjacent limitation.

## Direction

Give structured-output capability a representation the runtime reads, keyed to what is actually being
called rather than to which package was imported. Everything else in CORE-038 — including whether a
forced tool call is the right transport — becomes answerable once that exists, and is not answerable
before it: a transport chosen without a capability gate replaces one blind emission with another, and
CORE-038's own open question ("does the schema tool collide with the agent's own tools under
`tool_choice: required`?") exists only because nothing decides _when_ to inject.

This subsumes PROV-004's structured-output row and requires PROV-006's own open decision to be
settled first (consume the per-model vocabulary or delete it) — PROV-006 marks that decision "a
published-contract change, semver/changeset gate."

## Decisions reserved for the owner

Named explicitly rather than folded into a plan, because `backlog-execution.md` § Agent Decision
Authority reserves each of them:

1. **Whether `agent-provider-openai` changes behaviour when `baseURL` is set.** A provider default on
   a documented, published surface (`llms.txt:22`, `types.ts:86-103`). CORE-038's own first open
   question.
2. **Where capability and transport selection live** — provider capability declaration, agent config,
   or `IRunOptions`. Multiple architecturally valid approaches with long-term structural impact, and
   unanswerable before PROV-006's decision.
3. **Whether the SPEC's "providers without one ignore it" clause is rewritten.** Published contract.
4. **Whether a synthetic schema tool may be injected into a user's tool set** under
   `tool_choice: required`. Observable behaviour change for every tool-using agent.

**What can proceed without them:** PROV-004's already-scoped row — thread `responseFormat` through
the compat `./shared` request builder, or document the no-op the way the per-call effort dial is
documented. That is a correctness/documentation fix inside one package with no contract change, and
it is the honest floor under whatever the owner decides above.

## Test Plan

To be written once the reserved decisions are settled. It must at minimum pin: a structured run
against a provider without a native surface does not silently report early enforcement; the
`'json_schema'` catalog flag is either read or removed; and the deepseek catalog no longer declares a
capability its adapter does not implement.

## User Execution Test Scenarios

To be authored when this item is picked up. Expected `agent-executable` and provider-free for the
capability-representation half (observe what the SDK builds and what it reports about enforcement);
the end-to-end half needs an OpenAI-compatible gateway endpoint the executor supplies.
