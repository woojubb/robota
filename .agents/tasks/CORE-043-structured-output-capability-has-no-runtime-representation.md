---
title: 'CORE-043: structured-output capability has no representation the runtime reads — agent-core emits `responseFormat` unconditionally, each provider silently maps or discards it, the seam cannot tell which, and the fact is a property of the instantiated PACKAGE rather than the endpoint and model actually called, so the documented gateway configuration reports enforcement it does not have'
status: todo
created: 2026-08-16
priority: critical
urgency: now
area: packages/agent-core, packages/agent-provider-openai-compatible, packages/agent-provider-gemini, packages/agent-provider-replay, packages/agent-session
depends_on: [PROV-007, PROV-006]
---

# CORE-043: structured-output capability is not represented at runtime

Root item filed under [finding-depth.md](../rules/finding-depth.md) for the `DEPTH: FOUNDATIONAL`
verdict on [CORE-038](completed/CORE-038-forced-tool-call-as-structured-output-fallback-transport.md)
(2026-08-16). Registered as [issue #1750](https://github.com/woojubb/robota/issues/1750); the
proposal it was raised from is [issue #1738](https://github.com/woojubb/robota/issues/1738).
CORE-038 proposed a transport (forced tool call instead of a prose re-prompt); the
transport may well be the right one, but it is stated one layer above its cause.

**Ready to design.** This item was first filed as "not a proposal to implement", holding four
decisions for the owner. Three of those were reserved on a false premise — that the surfaces involved
are published and carry a backward-compatibility constraint. They are not published (see
§ Decisions reserved for the owner, corrected 2026-08-16), so what remains is one architectural
choice plus a behavioural one, both of which `code-quality.md:50` says to answer by bringing a
validated design rather than by asking.

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

> **Corrected 2026-08-16 (owner directive).** This section was written on a false premise — that
> `llms.txt:22`, `types.ts:86-103` and the SPEC's structured-output clause are **published** surfaces
> carrying a backward-compatibility constraint. They are not. `@robota-sdk/agent-core` has **71
> versions on npm and zero non-prerelease among them**; the `latest` dist-tag itself resolves to
> `3.0.0-beta.79`. There has never been a stable release, so no consumer holds a compatibility claim
> against any of these surfaces.
>
> [code-quality.md](../rules/code-quality.md) already says so twice as an owner directive: cost,
> scale and churn "are NOT reasons to prefer a lesser design ... **(unreleased — no backward-compat
> constraint)**" (`:50`), and "**Legacy is disposable in service of the correct structure** ...
> Pre-release, existing files, rules, packages, or names are not preserved for their own sake"
> (`:51`). Three of the four items below were reserved _because_ they were read as
> published-contract changes; that reason does not exist. Worse, deferring them on those grounds is
> the "documented-as-intentional exception / leave-as-is" half-measure `:50` explicitly forbids as a
> primary option.
>
> **What actually remains reserved is a design choice, not a compatibility one** — and `:50` says how
> to bring it: lead with the architecturally-correct design, validate it (reachability, capability
> preservation, adversarial review at contract boundaries), then request approval. Not a
> multiple-choice question posed before any design exists.

Restated on the correct premise:

1. **Whether `agent-provider-openai` reports early enforcement when `baseURL` is set.** Not a
   compatibility question — `llms.txt:22` and `types.ts:98` advertise the gateway configuration, and
   the runtime claims early enforcement on it while the model may ignore `response_format`. That is
   a **defect in the advertised configuration**, and the docs are ours to correct with the code.
2. **Where capability and transport selection live** — provider capability declaration, agent config,
   or `IRunOptions`. This is the one genuinely architectural choice, and it is the substance of this
   item. PROV-006 does **not** gate it on a "semver/changeset" basis (`:108` above records that
   framing; it falls with the rest); PROV-006's real question — consume the per-model vocabulary or
   delete it — is answerable on architectural grounds alone.
3. **The SPEC's "providers without one ignore it" clause is wrong and should be rewritten.** Not a
   published contract. PROV-004 (2026-08-13) already classifies the same behaviour as a
   **VIOLATION** of `IChatOptions.responseFormat`, so the repository currently documents as intent
   what one of its own items calls a contract violation. Under `code-quality.md:51` that
   contradiction is absorbed into this work, not carried.
4. **Whether a synthetic schema tool may be injected into a user's tool set** under
   `tool_choice: required`. This one survives as a real design question — name collision and "the
   model picks a real tool instead" are behavioural, not compatibility, concerns — and it is
   answerable once (2) exists.

**The floor is not as free as first stated.** "Document the no-op the way the effort dial is
documented" is no longer available: it is the half-measure `:50` forbids, and it would re-record
PROV-004's VIOLATION as intent a second time. Threading `responseFormat` through the compat
`./shared` request builder is the correctness half — but note the three providers each carry a
**private copy** of `buildRequestParams` (`deepseek/provider.ts:218`, `qwen/provider.ts:243`,
`gemma/provider.ts:234`), so "via `./shared`" means collapsing that triplication first. That
extraction is behaviour-preserving and needs no decision, and it is what makes (1)–(4) a small change
in one place rather than three.

## Test Plan

To be written once the reserved decisions are settled. It must at minimum pin: a structured run
against a provider without a native surface does not silently report early enforcement; the
`'json_schema'` catalog flag is either read or removed; and the deepseek catalog no longer declares a
capability its adapter does not implement.

## User Execution Test Scenarios

To be authored when this item is picked up. Expected `agent-executable` and provider-free for the
capability-representation half (observe what the SDK builds and what it reports about enforcement);
the end-to-end half needs an OpenAI-compatible gateway endpoint the executor supplies.
