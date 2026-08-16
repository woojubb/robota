---
status: draft
type: DATA
tags: [typescript, json-schema]
---

# CORE-043: structured-output capability is not represented at runtime

Design for Task [`.agents/tasks/CORE-043-structured-output-capability-has-no-runtime-representation.md`](../../tasks/CORE-043-structured-output-capability-has-no-runtime-representation.md)
(issue [#1750](https://github.com/woojubb/robota/issues/1750)), the root item for CORE-038 / issue
[#1738](https://github.com/woojubb/robota/issues/1738).

## Problem

`run(input, { output })` promises a schema-conforming object. It keeps that promise through a
core-side validate-and-retry loop, which is the right guarantee. What is missing is any runtime
knowledge of **whether the attempt the loop wraps carried a schema at all** — and the answer today is
decided by which package was imported, not by the endpoint and model actually being called.

Three facts, each verified against `develop` at the time of writing:

1. **`spec.jsonSchema` has exactly two consumers** — `robota-execution.ts:173` (the config override
   that becomes `IChatOptions.responseFormat`) and `:186` (the retry prose). Nothing else injects it.
2. **`agent-provider-openai-compatible` never reads `responseFormat`.** After PROV-004's seam landed
   (#1757) there is exactly one place it could be read — `shared/openai-compatible/request-builder.ts`
   — and it is not read there. So on deepseek / qwen / gemma, attempt 1 carries **no schema signal
   whatsoever**, and `outputRetries: 0` can only succeed by luck.
3. **The deepseek catalog already claims the capability it does not implement.**
   `deepseek/model-catalog.ts:16,25,35,45` list `'json_schema'` among each model's `capabilities`,
   and **nothing reads that array** (PROV-006). The repository therefore declares a per-model
   capability, ignores it, and ships an adapter that contradicts it.

The reporter of #1738 measured 0/4 for a JSON-schema response format through a gateway and read it as
a property of their gateway. In robota it is stronger than that: on the compat family it is
structurally guaranteed, because no schema is sent.

**And `agent-provider-openai` has the inverse problem.** It accepts a `baseURL`, and `llms.txt:22`
advertises exactly that for "any gateway (Vercel AI Gateway, LiteLLM, OpenRouter), Azure, vLLM,
Ollama, LM Studio". Pointed at a gateway serving a non-OpenAI model, the request still carries
`response_format: json_schema`, the endpoint accepts the parameter, and the model may ignore it. The
runtime believes it is on the enforce-early path while it is not. Nothing anywhere can tell the
difference, because nothing is asked.

## Prior Art Research

> **Scope of this pass.** The `prior-art-researcher` worker was not dispatched (the operator
> restricted subagent use this session), so this was read directly from vendor documentation rather
> than produced by that role. It is a documentation pass, not a source-reading one, per
> [research.md](../../rules/research.md).

### What the vendors actually document

Sources, all read 2026-08-16:

- OpenAI — Structured Outputs: <https://developers.openai.com/api/docs/guides/structured-outputs>
- Anthropic — Tool use with Claude: <https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview>
- Google — Gemini structured output: <https://ai.google.dev/gemini-api/docs/structured-output>
- DeepSeek — JSON Output: <https://api-docs.deepseek.com/guides/json_mode>

| Vendor        | Schema-enforced surface                                                                                                                                                                     | Documented limits                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenAI**    | `response_format` / `text.format` `json_schema`, **and** strict function calling — two distinct mechanisms                                                                                  | `json_schema` "is only supported with the `gpt-4o-mini`, `gpt-4o-mini-2024-07-18`, and `gpt-4o-2024-08-06` model snapshots and later" |
| **Anthropic** | `output_config.format`; **`strict: true` on a custom tool** "to ensure Claude's tool calls always match your schema exactly", with `tool_choice` forcing (`auto` / `any` / `tool` / `none`) | —                                                                                                                                     |
| **Gemini**    | `response_format` with `mime_type: application/json` + schema                                                                                                                               | "Very large or deeply nested schemas may be rejected"; "Not all JSON Schema features are supported"                                   |
| **DeepSeek**  | **`response_format: {'type': 'json_object'}` only — no `json_schema`**                                                                                                                      | Must "include the word 'json' in the system or user prompt, and provide an example of the desired JSON format"                        |

Four findings, each of which changes something in this document:

1. **The DeepSeek catalog in this repository is factually wrong, not merely unread.**
   `deepseek/model-catalog.ts` declares `'json_schema'` for all four models. DeepSeek documents only
   `json_object`. So PROV-006's "dead vocabulary" is worse than dead — consuming it as written would
   make the runtime send a schema surface the vendor does not offer. This is now a correctness item,
   not a tidy-up.
2. **`'none'` is a real state with a real shape behind it.** DeepSeek is not "no structured output";
   it is "JSON mode, no schema, and the word json must appear in the prompt". A boolean cannot carry
   that, and neither can a two-state enum. This is the strongest external support for the tri-state,
   and it argues the capability should eventually name the _mechanism_, not just the level.
3. **A forced tool call is a documented schema-conformance mechanism, not a folk remedy.** Anthropic
   documents `strict: true` for exactly this guarantee and documents forcing via `tool_choice`;
   OpenAI documents strict function calling as one of its two structured-output approaches. CORE-038's
   proposal is therefore well-grounded **as a fallback**.
4. **But it is not the better default where a native surface exists.** OpenAI's own guidance is
   explicit: "If you are connecting the model to tools, functions, data, etc. in your system, then you
   should use function calling — If you want to structure the model's output when it responds to the
   user, then you should use a structured `text.format`". This is evidence _against_ CORE-038's
   framing of a forced tool call as the general default, and _for_ the native-first ordering below.

Gemini's "deeply nested schemas may be rejected" and "not all JSON Schema features are supported" also
bear directly on CORE-039's universal subset — worth a cross-check, out of scope here.

### And the in-tree shape

| Adapter                                                         | Native surface                    | Shape                                            |
| --------------------------------------------------------------- | --------------------------------- | ------------------------------------------------ |
| `agent-provider-anthropic/src/anthropic/provider.ts:349-356`    | `output_config.format`            | Schema passed through `closeObjectSchemas` first |
| `agent-provider-gemini/src/gemini/execution-helpers.ts:142-145` | `responseSchema` + JSON mime type | Two fields set together                          |
| `agent-provider-openai/src/openai/chat-completions-chat.ts`     | `response_format`                 | Chat-Completions wire                            |

The relevant observation is not which vendor supports what — it is that **each of the three had to be
told, per adapter, how to express the schema**, while the compat family was told nothing and no layer
noticed. A capability contract that only records "supported / not supported" would have prevented
none of this; what is missing is a capability the _core_ consults before choosing what to send.

## Solution

Give structured-output capability a representation the runtime reads, keyed to the model actually
being called, and make the core's transport choice a function of it.

### 1. Extend the capability contract that already exists

`IProviderCapabilities` (`agent-core/src/interfaces/provider-capabilities.ts:20`) is the established
seam: every provider either overrides `getCapabilities()` or inherits
`createDefaultProviderCapabilities`, and `getProviderCapabilities()` is exported from agent-core's
public surface and already consumed by `agent-session/src/session-run.ts:164`. It is reachable by
every intended consumer today. Adding a third member is a smaller and more honest change than
introducing a parallel capability channel.

```ts
export type TStructuredOutputSupport = 'native' | 'none' | 'unknown';

export interface IProviderStructuredOutputCapability {
  support: TStructuredOutputSupport;
  /** Why — required for 'none' and 'unknown', so a degraded run can say what degraded it. */
  reason?: string;
}
```

**The third state is the point.** A boolean forces every provider to lie in one direction: `false`
makes `agent-provider-openai` stop sending `response_format` to real OpenAI, and `true` makes it
claim early enforcement through an arbitrary gateway. `'unknown'` is the honest answer for
"a `baseURL` I did not configure, serving a model I cannot identify", and it is a state the core can
act on differently from both others.

### 2. Make capability resolution model-aware

`getCapabilities()` takes no argument, so it can only describe the instance. Structured-output
support is a property of the model:

```ts
getCapabilities?(model?: string): IProviderCapabilities;
```

Optional parameter, so no existing implementation breaks. Providers with a catalog answer from it;
providers without ignore it. `getProviderCapabilities(provider, model?)` threads it through.

**This gives PROV-006 its answer, and its first real consumer.** PROV-006 asks whether to consume the
per-model capability vocabulary or delete it; this consumes it, and the `supportsTools()`-vs-catalog
self-contradiction PROV-006 also names becomes reachable through the same parameter.

**With one correction the research forces: the catalog must be fixed before it is read.** DeepSeek
documents `json_object` only, so the four `'json_schema'` entries are wrong, and consuming them as
written would make the runtime send a surface the vendor does not offer — a worse failure than
today's silent drop, because it would be a confident one. Correcting those entries is a prerequisite
step of this work, not a follow-up.

### 3. Each provider answers for itself

| Provider                                   | Answer                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| anthropic, gemini                          | `'native'`                                                                                        |
| `agent-provider-openai`, **no `baseURL`**  | `'native'`                                                                                        |
| `agent-provider-openai`, **`baseURL` set** | `'unknown'` — the endpoint is not ours and the model slug passes through verbatim                 |
| **deepseek**                               | `'none'` — the vendor documents `json_object` only; the catalog is corrected to match             |
| qwen / gemma                               | from their catalogs, once each is checked against its vendor documentation the way deepseek's was |

### 4. The core chooses the transport from the capability

`robotaRunStructured` stops unconditionally setting `responseFormat`:

- `'native'` → today's behaviour, unchanged. OpenAI's own guidance supports keeping it: a structured
  `text.format` is what it recommends for structuring a response to the user, over function calling.
- `'none'` / `'unknown'` → the forced-tool-call transport CORE-038 proposed, gated on this capability
  rather than on a guess, with the prose retry kept as the last resort it is good at. Anthropic
  documents `strict: true` on a custom tool for exactly this guarantee, so the fallback is a
  documented mechanism rather than a trick.

CORE-038's own open question — "does the schema tool collide with the agent's own tools under
`tool_choice: required`?" — is answerable only here, because only here does something decide _when_
to inject. Collision handling is part of this step, not a separate worry.

**Deliberately out of scope: DeepSeek's `json_object` mode as a third transport.** It would need the
word "json" injected into the prompt per DeepSeek's documentation, which is prompt manipulation on the
user's behalf and a decision of its own. `'none'` routing to the tool-call transport is the answer
here; the JSON-mode option is recorded so it is a choice rather than an oversight.

### Alternatives considered

**A. Thread `responseFormat` through the compat builder and stop.** One line in the seam #1757
created. Rejected as the whole answer: it sends a schema to models the catalog says may not honour it,
and it leaves `agent-provider-openai`-through-a-gateway — the configuration `llms.txt` actually
advertises — still misreporting. It is a strict subset of this design and can land first as a step,
but not as the fix.

**B. Put transport selection in `IRunOptions` / agent config.** Makes the caller responsible for
knowing what their endpoint supports. That is exactly the knowledge the SDK is supposed to hold, and
it would not help the reporter of #1738, who had no way to know either. Kept as a later _override_,
not as the mechanism.

**C. Probe the endpoint.** `shared/openai-compatible/endpoint-probe.ts` exists. Rejected: a probe
costs a request, is not deterministic, and `'unknown'` already carries the same information without
the round trip.

**D. Delete the per-model vocabulary (PROV-006's other branch).** Consistent, but it removes the only
per-model channel at the moment this item needs one, and would have to be rebuilt immediately.

## Architecture Review

Per [spec-workflow.md](../../rules/spec-workflow.md) § Validated Recommendation Before Approval. This
crosses a contract boundary (`IProviderCapabilities`, `IAIProvider.getCapabilities`), so the three
checks are run explicitly rather than assumed.

**Reachability — verified.** `getProviderCapabilities` is exported at `agent-core/src/index.ts:91`
and `interfaces/index.ts:63`, and has a live consumer at `agent-session/src/session-run.ts:164`. The
new member is reachable by agent-core (the intended consumer, `robota-execution.ts`), agent-session,
and every provider package, with no new dependency edge. Checked against
[project-structure.md](../../project-structure.md): agent-core → providers is the existing direction.

**Capability preservation — verified by enumeration, not by grep.** `IProviderCapabilities` has two
existing members. `functionCalling` and `nativeWebTools` are untouched; the change is additive.
`getCapabilities()`'s new parameter is optional, so all four current implementations
(`anthropic:284`, `deepseek:186`, `qwen:227`, `gemma:185`) and the
`createDefaultProviderCapabilities` fallback keep compiling and keep their current answers. One
behaviour is **consciously dropped**: `agent-provider-openai` with a `baseURL` stops reporting early
enforcement. That is the defect, stated as a change so it is not mistaken for a regression.

**Adversarial pass — partial, and the gap is named.** No independent reviewer ran (subagent use is
restricted this session), so this is a self-run red-team and should not be counted as the independent
pass the rule asks for. Strongest failure modes found:

1. **`'unknown'` becomes the default that swallows real support.** If a provider forgets to answer,
   the fallback decides. Mitigation: `createDefaultProviderCapabilities` returns `'none'` with a
   reason naming the provider, not `'unknown'` — an unanswered provider is not an ambiguous one, and
   `'none'` degrades to a transport that works everywhere rather than to a guess.
2. **The forced tool call collides with a real tool.** Under `tool_choice: required` the model may
   pick the user's tool instead of the schema tool. Not resolved by this document — it is the
   substance of step 4 and must be designed with a name-collision rule and an assertion on which tool
   came back, before implementation.
3. **A model-aware answer is only as good as the catalog — and the catalog is already wrong.** This
   was raised as a hypothetical risk and the research turned it into a finding: DeepSeek documents
   `json_object` only, while the catalog claims `'json_schema'` for all four models. Consuming it
   unchanged would upgrade a silent drop into a confident wrong send. Mitigation: correcting the
   catalog is a prerequisite step, and TC-03 fails if any entry disagrees with the vendor.
4. **Two capability channels drift.** `getCapabilities(model)` and the catalog could disagree.
   Mitigation: the catalog is the _source_ the compat providers answer from, not a second answer —
   one direction only.
5. **The tri-state flattens a state that is not flat.** DeepSeek is not "no structured output" — it
   is JSON mode without a schema, plus a prompt requirement. `'none'` routes it correctly today, but
   the capability will want to name the _mechanism_ eventually. Recorded, not designed here.

**Previously gating, now resolved.** The open question was whether a forced tool call is reliable
enough to be the fallback across five provider packages — the reporter's 4/4 on two models through
one gateway being evidence rather than a basis. The documentation pass above answers it: Anthropic
documents `strict: true` on custom tools "to ensure Claude's tool calls always match your schema
exactly" and documents `tool_choice` forcing; OpenAI documents strict function calling as one of its
two structured-output mechanisms. The fallback rests on documented vendor guarantees.

**It also produced one correction to this design's own premise.** OpenAI's guidance recommends a
structured `text.format` over function calling for structuring a response to the user. CORE-038
proposed the forced tool call as the better transport generally; that is not supported where a native
surface exists. The native-first ordering in step 4 is the corrected form — the tool call is the
fallback, not the default.

**Still not run: an independent adversarial review.** Everything above is self-run (subagent use is
restricted this session). The rule asks for an independent critical pass on a contract-boundary
change, and this is not it. That gap should be closed before GATE-APPROVAL.

## Completion Criteria (draft)

- **TC-01** `IProviderCapabilities.structuredOutput` exists with the tri-state, and
  `getProviderCapabilities(provider, model?)` returns it.
- **TC-02** `agent-provider-openai` reports `'native'` without a `baseURL` and `'unknown'` with one;
  a test pins both.
- **TC-03** The deepseek catalog no longer claims `'json_schema'` — the vendor documents `json_object`
  only — and qwen's and gemma's catalogs are checked against their vendor documentation the same way.
  A test fails if a catalog entry disagrees with what the adapter sends.
- **TC-04** A structured run against a `'none'` / `'unknown'` provider does **not** report early
  enforcement, and carries a schema by the tool-call transport.
- **TC-05** `outputRetries: 0` against a non-native provider succeeds for a schema the model can
  satisfy — the property that is structurally impossible today.
- **TC-06** The schema tool's name-collision rule is specified and tested against an agent that
  already registers a tool of that name.
- **TC-07** `agent-core/docs/SPEC.md` § Structured Output Contract no longer says providers without a
  native surface "ignore it" — PROV-004 classifies that as a violation, and the SPEC currently
  documents the violation as intent.
- **TC-08** PROV-006's `supportsTools()`-vs-catalog contradiction for deepseek is resolved in the same
  change, since the model parameter this design adds is what makes it resolvable.

## Evidence Log

| Claim                                          | Verified at                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `spec.jsonSchema` has two consumers            | `agent-core/src/core/robota-execution.ts:173,186`                                                          |
| compat family never reads `responseFormat`     | `grep -rn responseFormat packages/agent-provider-openai-compatible/src` → no hits                          |
| deepseek catalog claims `json_schema`          | `deepseek/model-catalog.ts:16,25,35,45`                                                                    |
| nothing reads the catalog `capabilities` array | `grep -rn "\.capabilities" packages/agent-provider-openai-compatible/src packages/agent-cli/src` → no hits |
| `IProviderCapabilities` shape and default      | `agent-core/src/interfaces/provider-capabilities.ts:20-23,33-50`                                           |
| resolver is exported and consumed              | `agent-core/src/index.ts:91`, `agent-session/src/session-run.ts:164`                                       |
| four `getCapabilities` implementations         | `anthropic:284`, `deepseek:186`, `qwen:227`, `gemma:185`                                                   |
| gateway configuration is advertised            | `llms.txt:22`                                                                                              |
| SPEC documents the drop as intent              | `agent-core/docs/SPEC.md:979`                                                                              |
| PROV-004 calls the same behaviour a violation  | `.agents/tasks/PROV-004-*.md:33`                                                                           |
| no stable release exists                       | npm `@robota-sdk/agent-core`: 71 versions, 0 non-prerelease                                                |
| DeepSeek supports `json_object` only           | <https://api-docs.deepseek.com/guides/json_mode>                                                           |
| OpenAI documents two mechanisms                | <https://developers.openai.com/api/docs/guides/structured-outputs>                                         |
| Anthropic documents strict tools + forcing     | <https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview>                                   |
| Gemini limits schema depth and features        | <https://ai.google.dev/gemini-api/docs/structured-output>                                                  |

## Sources

- [DeepSeek — JSON Output](https://api-docs.deepseek.com/guides/json_mode)
- [OpenAI — Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Anthropic — Tool use with Claude](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
- [Google — Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)
