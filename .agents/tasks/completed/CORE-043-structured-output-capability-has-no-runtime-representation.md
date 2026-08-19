---
title: 'CORE-043: structured-output capability has no representation the runtime reads — agent-core emits `responseFormat` unconditionally, each provider silently maps or discards it, the seam cannot tell which, and the fact is a property of the instantiated PACKAGE rather than the endpoint and model actually called, so the documented gateway configuration reports enforcement it does not have'
status: done
created: 2026-08-16
completed: 2026-08-17
priority: critical
urgency: now
area: packages/agent-core, packages/agent-provider-openai, packages/agent-provider-anthropic, packages/agent-provider-openai-compatible, packages/agent-provider-gemini, packages/agent-provider-replay, packages/agent-session
depends_on: [PROV-007, PROV-006, PROV-008]
---

# CORE-043: structured-output capability is not represented at runtime

Root item filed under [finding-depth.md](../../rules/finding-depth.md) for the `DEPTH: FOUNDATIONAL`
verdict on [CORE-038](CORE-038-forced-tool-call-as-structured-output-fallback-transport.md)
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
> [code-quality.md](../../rules/code-quality.md) already says so twice as an owner directive: cost,
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

Delivered. The three minimum pins the item named, and where each is enforced:

| Pin                                                                                                     | Where                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A structured run against a provider without a native surface does not silently report early enforcement | `packages/agent-core/src/services/__tests__/structured-output-transport.test.ts` — the `sent` / `schemaInPrompt` outcome, and the `structured_output_transport` event asserted end-to-end in Scenario 2 |
| The `'json_schema'` catalog flag is either read or removed                                              | READ — `mechanismFor()` in `structured-output-transport.ts` is the only consumer, and `applyStructuredOutputTransport` acts on its answer                                                               |
| The deepseek catalog no longer declares a capability its adapter does not implement                     | `packages/agent-provider-openai-compatible/src/deepseek/capability-table.ts` now declares `json_object`; asserted both ways in `deepseek/__tests__/model-capabilities.test.ts`                          |

Plus, red-proved by reverting each behaviour in place and re-running:

- reading an absent capability table as a denial (which would strip a working `json_schema` from
  every provider without a verified table) — 1 test red
- stating the schema only on the retry turn (the original defect) — 2 tests red

Endpoint provenance is covered on the real provider classes:
`agent-provider-openai/src/openai/__tests__/endpoint-provenance.test.ts` and
`agent-provider-anthropic/src/anthropic/__tests__/capability-table.test.ts`.

## User Execution Test Scenarios

Both are `agent-executable` and provider-free — no API key, no network. The end-to-end gateway half
is deliberately NOT claimed here: Scenario 2 proves the provider reports the gateway honestly, which
is the part this repository owns; what an arbitrary gateway does with the parameter is not ours to
assert.

### Scenario 1 — a structured run against a provider with no schema parameter

**Command:** `cd scratch && node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-043-s1.ts`

Runs a real `Robota` agent with a provider declaring DeepSeek's actual capability (`json_object`).

**Evidence:** EXIT:0

```
validated object: {"name":"Ada","age":36}
provider calls made: 1
attempt 1 responseFormat: {"type":"json_object"}
attempt 1 system instructions: ["Respond with ONLY a JSON object (no prose, no code fences) matching this JSON schema:\n{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\",\"description\":\"The person name\"},\"age\":{\"type\":\"number\",\"description\":\"Age in years\"}},\"required\":[\"name\",\"age\"],\"additionalProperties\":true}"]
PASS the run resolved to a validated object
PASS it took exactly ONE provider call — the wasted first attempt is gone
PASS the wire option was downgraded to what this provider can honour ('json_object'), not the 'json_schema' it would have ignored
PASS the schema was stated to the model on the FIRST attempt, not only on retry
SCENARIO 1 PASS
```

### Scenario 2 — the transport report, and the advertised gateway configuration

**Command:** `cd scratch && node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-043-s2.ts`

Constructs the REAL `OpenAIProvider` (never called — no request is sent) and runs a real agent turn
against a provider that declares nothing.

**Evidence:** EXIT:0

```
openai direct  — endpointIsVendorDefault: true
openai gateway — endpointIsVendorDefault: false
openai gateway — declares a capability table: false
transport report: {"executionId":"exec_1786898563479_cl3a0sfa3","conversationId":"conv_1786898563476_didbfv197","round":1,"provider":"fake-undeclared","model":"some-new-model","mechanism":"response_schema","provenance":"undeclared","sent":"json_schema","schemaInPrompt":false,"reason":"the provider declares no capability table, so the request is sent as asked — silence is not a denial"}
PASS the vendor endpoint is reported as the vendor endpoint
PASS a configured baseURL is reported as a gateway
PASS it answers that WITHOUT declaring a capability table — so the signal never required inventing one
PASS a structured turn now emits a transport report at all
PASS the report says what the request DID (which transport carried the schema)
PASS a provider that declares nothing is still sent the schema — silence is not a denial
SCENARIO 2 PASS
```

## What this landing delivers, and what it does not

Answering the four restated decisions:

1. **Whether `agent-provider-openai` reports early enforcement when `baseURL` is set** — ANSWERED.
   It no longer does. `IAIProvider.endpointIsVendorDefault?()` is a separate member from
   `capabilityTable?()` precisely so this provider, which declares no table by choice, can still
   report its endpoint without inventing capability claims. `provenance: 'unverified-endpoint'`
   carries it to the caller.
2. **Where capability and transport selection live** — ANSWERED. Capability is declared by the
   provider package (PROV-006's vocabulary, now actually consumed); transport selection happens at
   the seam that assembles the request, which is the only point holding both the resolved provider
   and the outgoing messages. Not in `robotaRunStructured`, which has neither.
3. **The SPEC's "providers without one ignore it" clause** — REWRITTEN, in both
   `agent-core/docs/SPEC.md` and `agent-provider-openai-compatible/docs/SPEC.md`.
4. **Whether a synthetic schema tool may be injected into a user's tool set under
   `tool_choice: required`** — NOT DELIVERED HERE, and deliberately so. It is a behavioural design
   question (name collision; the model picking a real tool instead), it was answerable only once (2)
   existed, and it is now answerable. `TStructuredOutputMechanism` carries no `tool_strict` member
   yet for the same reason: a union member nothing produces is a branch every consumer must handle
   and no test can reach. Tracked as **CORE-048**.

Also corrected along the way: `execution-round-provider.ts` used the caller's history array as the
cache key; it now keys on what was actually sent. And the Anthropic 429→`RateLimitError` mapping
existed character-for-character on both the streaming and non-streaming paths — extracted to
`anthropic/errors.ts`, since two copies of a taxonomy decision is how PROV-004's drift starts.

## Scope of the transport report (PROV-009)

[PROV-009](../PROV-009-provider-packages-shape-requests-outside-any-core-seam.md) requires this item to
scope its report claim to the core turn path until that boundary rule lands, and it is right to. The
`structured_output_transport` event describes **what core supplied**, not everything the request
carried. `@robota-sdk/agent-provider-openai` publishes `responseFormat` / `jsonSchema` as
construction-time options and merges them with the per-call ones in
`packages/agent-provider-openai/src/openai/openai-request-format.ts` — the per-call value wins, so a
request core shaped is reported correctly. The gap is the turn core does not shape at all: a run
without `output` resolves no transport and emits no event, yet a provider constructed with
`responseFormat: 'json_schema'` still puts `response_format` on the wire. (Note the case this is NOT:
`mechanism: 'none'` cannot arise for that provider, which declares no capability table at all, so
every structured turn against it resolves `response_schema` / `undeclared`.) Recorded in
`packages/agent-core/docs/SPEC.md` under the Structured Output Contract; widening the report to cover
that channel is PROV-009's to decide, not this item's to assume.

Also correcting an assertion this item's design made: it claimed the constructor caller set for those
options was "verified empty". It is not — the sweep that produced it excluded `*.test.*`, and
`packages/agent-provider-openai/src/openai/provider.test.ts` constructs the provider with
`responseFormat: 'json_schema'` and asserts the mapping. PROV-009 caught it.
