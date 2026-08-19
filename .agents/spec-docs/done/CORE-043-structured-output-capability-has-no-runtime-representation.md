---
status: done
type: DATA
tags: [typescript, json-schema]
---

# CORE-043: structured-output capability is not represented at runtime

Design for Task [`.agents/tasks/completed/CORE-043-structured-output-capability-has-no-runtime-representation.md`](../../tasks/completed/CORE-043-structured-output-capability-has-no-runtime-representation.md)
(issue [#1750](https://github.com/woojubb/robota/issues/1750)), the root item for CORE-038 / issue
[#1738](https://github.com/woojubb/robota/issues/1738).

> **Citations re-verified 2026-08-16 after CORE-042 landed (#1774).** That change collapsed the
> duplicated turn: `execution-stream.ts` went from ~400 lines to 115, `execution-stream-tools.ts` was
> deleted, and `robotaRunStructured` was extracted to `core/robota-execution-structured.ts`. Every
> load-bearing contract this design rests on still holds — `tools.getTools()`, the `{ chat }`-narrowed
> resolved provider, the `responseFormat` union, `IProviderCapabilities`, the `validate` closure — but
> line numbers in `execution-round.ts` and `execution-pipeline.ts` moved and are corrected above.
>
> **One argument changes.** Step 4 justified its placement partly as keeping CORE-042 "from claiming
> an eighth instance" of the twice-implemented turn. CORE-042 has now landed, so the shared seam
> exists rather than being something this design must avoid worsening. The placement is unchanged and
> its reasoning is now simpler: the extraction sits inside a seam that is already one.

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
   that, and neither can a two-state enum. This is the strongest external evidence that capability
   must name the **mechanism** — which is what step 2 does, and why the tri-state that first stood
   here was rejected: it kept provenance and discarded exactly this.
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

> **Revised 2026-08-16 after `REVIEW VERDICT: REVISE`.** The first draft added a third representation
> of one fact and placed the decision where its inputs are not resolved. The independent review
> falsified four premises; every one was re-checked against the code and confirmed. See § Architecture
> Review → Independent review for the verdict and what each finding changed. This section is the
> revised design, not the reviewed one.

There is not one capability channel in this repository. There are **two, and they already overlap**:

| Channel                                                                            | Scope    | Facts it carries                                                         | State    |
| ---------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------ | -------- |
| `IProviderCapabilities` (`agent-core/src/interfaces/provider-capabilities.ts:20`)  | instance | `functionCalling`, `nativeWebTools`                                      | live     |
| `IProviderModelCatalogEntry.capabilities` (`interfaces/provider-definition.ts:66`) | model    | `tools`, `vision`, `json_schema`, `reasoning`, `native_web`, `streaming` | **dead** |

`tools` ↔ `functionCalling` and `native_web` ↔ `nativeWebTools` are **the same facts stated twice**,
with the per-model side unread. `json_schema` is a third such fact, unread on both sides.

Adding a structured-output member to the instance channel — the first draft's design — would have
given one of six overlapping facts a _third_ shape and left the other five dead. That repeats the
depth error one level below the one this item was filed for: CORE-038 fixed a transport where the
symptom surfaced instead of where the capability was missing; adding to the instance channel fixes
the capability where _it_ surfaces instead of where the defect is. Under
[finding-depth.md](../../rules/finding-depth.md) that is the same mistake, and under
[code-quality.md](../../rules/code-quality.md) `:51` the duplication found along the way must be
absorbed, not stepped around.

### 1. One resolution seam, keyed on (provider, model)

Collapse the two channels instead of extending one. The per-model catalog entry becomes the
**declared source**; the provider **qualifies** it with what only the instance knows (endpoint not
identifiable, feature disabled by config); agent-core owns the resolution:

```ts
resolveProviderCapabilities({ provider, model }): IProviderCapabilities;
```

This resolves PROV-006 wholesale rather than for one flag, and the deepseek
`supportsTools()`-vs-catalog contradiction PROV-006 also names falls out of the same mechanism
instead of needing its own criterion.

**The declared source has to be built, because the current catalog cannot be it.** Review round 2
established three facts: `IProviderModelCatalog` hangs off `IProviderDefinition`, a setup/registry
artifact the provider _instance_ does not hold; `refreshModelCatalog` is declared by all six
provider-definitions and **invoked by nothing**, and no `src` reads `modelCatalog.entries` either; and
OpenAI's `status: 'unavailable'` (`openai/provider-definition.ts:36-40`) is a statement about
**discovery** — "availability should be discovered live from `GET /v1/models`" — which the first
revision misread as "declares no capabilities". `IOpenAIModelCatalogResource` carries `id` and nothing
else, so live discovery can never populate a capability.

The struct conflates two different things, and the split is part of this work:

| Concern                 | Nature                                    | Home                                                                              |
| ----------------------- | ----------------------------------------- | --------------------------------------------------------------------------------- |
| **Which models exist**  | dynamic, per-account, live-refreshable    | stays in `modelCatalog` / `refreshModelCatalog` as today                          |
| **What a model can do** | static, versioned with the adapter, dated | a new static capability table each provider package owns and its instance imports |

DeepSeek already has exactly that shape (`getDeepSeekFallbackModelCatalogEntry` reads a module-scope
array in its own package). OpenAI gets one for the first time, and it can finally express the snapshot
rule its own vendor documentation states. That table — not the registry catalog — is the declared
source the resolution seam reads, which is also the plumbing path the first revision needed and did
not name.

`IProviderDefinition.allowedModels` is a **third** model-scoped surface. It stays separate on purpose:
its own JSDoc scopes it as a subset/override of `modelCatalog.entries[].id`, so it is a listing
concern like discovery, not a capability one. A design that opens by collapsing two channels should
say why it is not collapsing a third.

**Miss policy — stated here rather than left to implementation.** Lookup is exact-id, new model
snapshots appear constantly, and `capabilities` is an optional field, so there are three states:

| State                                     | Resolution                                                |
| ----------------------------------------- | --------------------------------------------------------- |
| entry present, capabilities declared      | the declaration, `provenance: 'catalog'`                  |
| entry present, `capabilities` undefined   | provider vendor-default, `provenance: 'vendor-default'`   |
| **entry absent** (the common OpenAI case) | provider vendor-default, `provenance: 'undeclared-model'` |

**The table records verified DEVIATIONS from the vendor default — it does not enumerate models.**
This is the miss policy's payoff and it must be stated, or the natural reading is "list every model"
and the result is an unmaintained per-model × six-flag matrix. Because a miss resolves safely, the
table needs only the handful of exception rows that are actually true and dated: OpenAI's
pre-`2024-08-06` snapshots, `deepseek-reasoner`'s absent `tools`. Everything else is a miss, and a
miss is correct.

The asymmetry that justifies this: **over-declaration is the only unrecoverable error class.** An
over-claim sends a parameter the endpoint does not support — a vendor error, or worse, silent
acceptance with no enforcement, which is precisely today's bug. An under-claim or a miss degrades to a
transport that works everywhere. So entries are added only against dated vendor documentation, and
**when in doubt the correct action is to have no entry.**

**Residual risk, named rather than implied away.** No build-time check closes this. TC-03's
consistency test catches a declaration no adapter implements — the DeepSeek class — but it cannot
catch a declaration the adapter _does_ implement and the vendor does not support; that same DeepSeek
entry would pass every check here if the compat builder were also taught to send `json_schema`. A
staleness scan makes someone re-stamp a date, not re-read the docs, and a re-stamped wrong entry looks
fresher than a stale one. Only the runtime can observe that a declaration is wrong about the vendor: a
provider rejecting the structured-output parameter is ground truth arriving, and recording it with the
provenance that produced the claim is the only feedback path from reality back into the table.
Whether that lands in this item or a follow-up, it is the known gap.

**Only an explicit declaration may deny a capability. A miss never resolves to a negative.** Without
this rule, an unrecognised but perfectly real OpenAI model would resolve `tools` absent and have tool
calling silently disabled — a regression far worse than the one this item exists to fix. This is the
first draft's red-team #1 (`'unknown'` swallowing real support) returning at six times the stakes now
that the seam governs six flags, and that same pattern already produced the Gemini fail-silent that
step 3 fixes. It is written into the design rather than trusted to whoever implements it.

### 2. Mechanism and provenance, not a flat tri-state

The first draft proposed `'native' | 'none' | 'unknown'`. That is the wrong shape, and this document's
own Prior Art established why before the review said so: capability varies along **two orthogonal
axes**, and the tri-state kept the one the runtime does not act on while discarding the one that
decides what gets sent.

```ts
export interface IProviderStructuredOutputCapability {
  mechanism: 'response_schema' | 'json_object' | 'tool_strict' | 'none';
  provenance: 'catalog' | 'vendor-default' | 'unverified-endpoint';
  reason?: string;
}
```

`'unknown'` was never a capability — it is `provenance: 'unverified-endpoint'`, and separating it lets
a presumed mechanism co-exist with unverified provenance, which is what makes the override in step 5
fit without another contract change.

**`json_object` is added to `TProviderModelCapability`.** Without it, DeepSeek is unrepresentable in
either channel: the vocabulary offers only `json_schema`, which DeepSeek does not support, so removing
that entry (the first draft's TC-03) would have left the corrected catalog as wrong as the current
one, in the other direction.

### 3. The model argument is required

`resolveProviderCapabilities` takes the model, and no caller may omit it. The first draft made it
optional and justified that with "so no existing implementation breaks" — which
`code-quality.md:50` bars in as many words ("cost, scale, and churn are NOT reasons to prefer a lesser
design … unreleased — no backward-compat constraint"), and which this item's own Task spends a
paragraph establishing is not a real constraint here.

It is also the wrong contract. Optional means the same provider answers differently depending on
whether a caller happens to pass the argument, with nothing declaring which answer is authoritative,
and every existing override keeps compiling while silently ignoring the model. The live consumer shows
the hazard concretely: `agent-session/src/session-run.ts:164` calls
`getProviderCapabilities(ctx.aiProvider)` and logs the result three lines below `model: ctx.model` —
the model is already in scope and would silently not be passed, so the log would describe a different
model than the run. That fail-silent-by-omission shape is what produced PROV-006's dead vocabulary in
the first place.

**Every producer is updated — the full list, which the first draft got wrong:**

| Producer                                                             | Today                                                                   |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `agent-core/src/abstracts/abstract-ai-provider.ts:210`               | concrete, non-optional default                                          |
| `agent-provider-openai/src/openai/provider.ts:162`                   | **omitted from the first draft**                                        |
| `agent-provider-anthropic/src/anthropic/provider.ts:284`             | override                                                                |
| `agent-provider-anthropic/src/anthropic/provider.ts:311`             | `configureNativeWebTools` also returns the type, with no model in scope |
| `agent-provider-openai-compatible/src/deepseek/provider.ts:186`      | override                                                                |
| `agent-provider-openai-compatible/src/qwen/provider-capabilities.ts` | answer lives in its own file                                            |
| `agent-provider-openai-compatible/src/gemma/provider.ts:185`         | override                                                                |
| **`agent-provider-gemini`**                                          | **no override at all — inherits the default**                           |
| `agent-session/src/session-run.ts:164`                               | call site; must pass `ctx.model`                                        |

The Gemini row is the one that mattered. It has a working native surface
(`gemini/execution-helpers.ts:140-145`) and no override, so under the first draft — whose red-team
mitigation made the default answer `'none'` — Gemini would have silently reported no structured output
the moment the change landed. A fail-silent capability regression, introduced by the mitigation for a
different fail-silent risk.

### 3b. The consumers, enumerated — the step this document was missing

Round 1 found the **producer** enumeration incomplete and round 3 fixed it as a table, which has held
since. But this change alters runtime _behaviour_ — an extra provider call, a new event kind, a
changed commit shape — and no revision enumerated the **consumers** of that behaviour. Rounds 6, 7, 8
and 9 each found one by accident, which is why they share a shape. That is a missing step, not bad
luck, so it is done here once, from a workspace sweep rather than from the packages already in the
Task's `area`.

**Capability readers and answerers outside step 3's producer table** — nine, in six packages and one
app:

| Reader                                                     | Today                                      | What this change requires                                                                      |
| ---------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `agent-provider-replay/src/replay-provider.ts:82`          | `supportsTools` only, no `getCapabilities` | An explicit answer — a provider with **no vendor** must not resolve a vendor-default mechanism |
| `agent-core/src/testing/scripted-provider.ts:88`           | same                                       | An explicit answer **and** a scriptable extraction turn — six criteria name this fixture       |
| `agent-core/src/executors/local-executor.ts:180-186`       | any-registered-provider disjunction        | Routed through the step-1 seam, or exempt with a reason — TC-08 claims `tools` resolves there  |
| `agent-core/src/abstracts/abstract-executor.ts`            | `supportsTools`                            | Same question one layer up                                                                     |
| `agent-core/src/interfaces/executor.ts`                    | declares `supportsTools`                   | Contract decision follows the two above                                                        |
| `agent-remote-client/src/client/remote-executor-simple.ts` | `supportsTools`                            | Capability across a remote boundary — can it answer per-model at all?                          |
| `agent-playground/src/lib/playground/remote-injection.ts`  | `supportsTools`                            | Browser-side reader                                                                            |
| `apps/agent-server/src/catalog/providers.ts`               | `supportsTools`                            | Server catalog surface — outside every package this Task lists                                 |
| `agent-provider-gemini/src/gemini/provider.ts`             | `supportsTools`, **no `getCapabilities`**  | The round-1 finding, restated: needs the new override                                          |

**The replay collision — round 9's own fix breaks round 10's reader.** `ReplayProvider.chat`
(`:60-71`) is a **positional cursor**, and `extractRecordedResponses` (`:88-95`) builds its corpus by
filtering session-log entries on exactly `SESSION_LOG_EVENT.providerResponseNormalized`. Round 9
specified that the extraction emit its **own** event kind — correct for replay disambiguation, and
fatal here: the extraction's response is never recorded while the extraction call still **consumes a
cursor position**, so the cursor desynchronises and every later call replays the wrong response until
`"[replay] no recorded provider response for call #N … the log is exhausted."`

The two rounds contradict each other and neither could see it alone. **Decision: the extraction
records under the existing `providerResponseNormalized` name, and carries a discriminator field.**
The corpus stays intact and ordered, replay stays deterministic — determinism being that package's
entire purpose — and round 9's disambiguation survives as a field rather than as a separate event
name. `session-log-events.ts` is the only other consumer of that event, so the blast radius is two
files.

**Cost is a static per-model fact left on the dynamic side of step 1's split.**
`IProviderModelCatalogEntry.costPerInputToken` / `costPerOutputToken` (`:84-85`, ARCH-PROVIDER-003)
are static and per-model by step 1's own criterion, yet step 1 moves `capabilities` to the new static
table and leaves cost on the discovery struct — whose live-refresh path can never populate it, since
`IOpenAIModelCatalogResource` carries `id` alone. **Cost travels with capability into the static
table.** Round 9 made the extraction's tokens part of what must be costed, so leaving cost on the
side that cannot be populated would break the accounting that round 9 exists to make checkable.

**The five surfaces round 10 named as unexplored, now walked.** Two were not clean:

| Surface                             | Result                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `agent-session-analytics`           | **No impact** — no reference to `responseFormat`, `json_schema` or capability                              |
| `agent-cli` `allowedModels` / setup | **No impact** — no `allowedModels` reference in that package's `src`                                       |
| `agent-session` log schema          | **No impact beyond the replay reader** — `provider_request` / `provider_response_*` names, already covered |
| **`agent-framework` query surface** | **Impact — see below**                                                                                     |
| **Plugin hooks**                    | **Impact — `beforeProviderCall` was missed**                                                               |

**`agent-framework` exposes a second, pre-existing path into the same provider field.**
`IChatOptions.responseFormat` (`interfaces/provider.ts:198-200`) is a **union**:
`{ type: 'text' | 'json_object' }` or `{ type: 'json_schema'; name?; schema }`. This document has
treated only the `json_schema` arm. But `query.ts:30` and `runtime/agent-runtime.ts:58` publish
`responseFormat?: { type: 'text' | 'json_object' }` as a caller option and forward it
(`query.ts:54`, `agent-runtime.ts:125`).

Two consequences the design must state:

1. **Caller-supplied `json_object` is a different intent from schema enforcement** — "give me JSON",
   not "enforce this shape" — and it carries no schema to validate against. The capability gate must
   not silently reinterpret it as a structured-output request, and the extraction transport must not
   fire for it.
2. **It has the same defect, ungated.** `agent-framework` forwards it to whatever provider is
   configured, and the compat family reads no `responseFormat` at all, so a caller asking for JSON on
   deepseek/qwen/gemma gets nothing and is told nothing — the identical silent drop, on a surface this
   document had not looked at. The capability's `json_object` mechanism (step 2) is exactly what makes
   this answerable, so covering it costs almost nothing here and leaves the same bug standing if
   omitted.

**`beforeProviderCall` was missed by the round-9 table.** It fires once per round at
`execution-round.ts:93`, the mirror of `afterProviderCall` at `:185`. The extraction's own call path
must answer for it on the same terms as row 5 — fire with an explicit marker, or be excluded with the
reason recorded. A hook that sees the request but not its sibling, or the response but not the
request, is worse for a cost/usage plugin than seeing neither.

### 3c. The intent channels — the axis step 3b's sweep could not reach

Step 3b enumerated **readers of capability**. That is not the same set as **expressers of
structured-output intent**, and the second is where the bypass lives: a caller can ask for structured
output through a channel that reads no capability and emits no provider event, so no term in step 3b's
sweep could find it. Swept here on the intent symbols themselves.

| #   | Channel                                                                                                                                                                                                                                                   | Routes through the gate?                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 1   | `IChatOptions.responseFormat` (`interfaces/provider.ts:198-200`) — per call, the union                                                                                                                                                                    | **Yes** — this is where step 4 puts the gate |
| 2   | `IAgentConfig.responseFormat` / `IResponseFormatConfig` (`interfaces/response-format.ts`) — agent config; what `structuredConfigOverrides` writes                                                                                                         | Yes, it feeds (1)                            |
| 3   | **`agent-provider-openai` construction options** — `responseFormat?: 'text' \| 'json_object' \| 'json_schema'` and `jsonSchema` (`openai/types.ts:124,128`), merged inside the provider by `mergeChatResponseFormat` (`chat-completions-chat.ts:147-148`) | **NO — bypasses core entirely**              |
| 4   | Caller options publishing the `json_object` arm — `agent-framework/query.ts:30`, `runtime/agent-runtime.ts:58`, `interactive/interactive-session-options.ts:157,279`, `agent-session/session-types.ts:154`                                                | Reach (1), but ungated as intent             |
| 5   | **CLI `--json-schema`** (`agent-cli/src/utils/cli-args.ts:49,269`) — implemented by appending _"Respond with valid JSON only, matching this JSON schema: …"_ to the system prompt (`startup/append-system-prompt.ts:26-28`)                               | **NO — prompt-level, outside the model**     |

**Correction (depth triage, 2026-08-16).** `agent-command-workflows/src/authoring/author.ts:60` was
filed here under (4) as "reaches (1), but ungated". It does **not** reach (1): `author.ts:53` calls
`provider.chat()` **directly**, so it is (3)'s class. And it is not alone — there are six non-test
direct `provider.chat()` sites outside the core turn path (`author.ts:53`,
`execution-pipeline.ts:168`, `agent-session/src/compaction-orchestrator.ts:128`,
`agent-framework/src/interactive/session-naming.ts:53`, `apps/agent-server/src/app.ts:138`,
`routes/handlers/playground-execute.ts:145`).

The round-11 sweep that existed to close this axis also missed four publishers of the `json_object`
arm: `agent-framework/src/assembly/create-session-types.ts:207`, `assembly/create-session.ts:273`,
`interactive/create-session-projection.ts:95`, `interactive/interactive-session-init.ts:261`.
(`dag-framework/src/adapters/prompt-backend.ts` matches the sweep on
`jsonSchemaPropertyToInputSpec` — a schema→port converter, **not** an intent channel. Recorded so it
is not re-examined.)

**Channel 3 is the one with consequences.** Step 4 places the gate in core, and a user writing
`new OpenAIProvider({ baseURL: <gateway>, responseFormat: 'json_schema', jsonSchema })` never reaches
it. So the design's central claim — the core chooses the transport from the capability — is bypassed
by a documented provider option, on the exact `baseURL`-plus-gateway configuration step 5 exists to
correct. And step 4b's outcome report is produced at the seam this path avoids, so it would describe a
request the wire did not carry. **A report that lies is worse than no report**, and the report is this
item's headline deliverable.

**Channel 5 contradicts this document's own scope-out.** Step 4 declined DeepSeek's `json_object` on
the grounds that injecting "json" into the user's prompt is prompt manipulation, citing
`project-structure.md:113`. The CLI already ships exactly that mechanism, on the flagship surface. The
design cannot both refuse it as out of bounds and leave it running unexamined.

**Decision, as corrected: the core seam is the sole gate FOR THE CORE TURN PATH.** The unqualified
form was unenforceable — `IChatOptions` is a provider-facing contract any package holding an
`IAIProvider` can populate directly, and six sites do. The unbounded-provider-surface half is
**PROV-009**; the direct-call sites are their own question and are recorded here rather than claimed.
Within the core turn path: Any other answer requires
step 4b's report to enumerate what it cannot see, which makes the item's deliverable conditional on
which construction path the caller happened to use. Pre-release, `code-quality.md:51` makes the
consequences available rather than merely desirable:

- **(3)** is removed, or routed through the gate — the provider stops merging a construction-time
  format of its own. **Correction (depth triage, 2026-08-16): the "verified empty caller
  set" claimed here was FALSE.** The sweep that produced it excluded `*.test.*`, and the one caller is
  a test — `packages/agent-provider-openai/src/openai/provider.test.ts:313-326` constructs
  `new OpenAIProvider({ apiKey, responseFormat: 'json_schema', jsonSchema })`. The option is also
  published at `content/v2.0.0/api-reference/openai/interfaces/IOpenAIProviderOptions.md:84`, while
  `packages/agent-provider-openai/docs/SPEC.md` does not mention it. The finding survives; the
  approval case built on the empty set does not, and this consequence now belongs to **PROV-009**.
- **(4)** funnels into (1) as intent, so a drop is reported rather than silent.
- **(5)** becomes a caller of the gated path instead of a prompt-appender — which also removes the
  contradiction with step 4's own scope-out.

### 4. The decision is made where its inputs are resolved

The first draft put the transport choice in `robotaRunStructured`. **That function has no provider.**
`IRobotaExecutionDeps` (`robota-execution.ts:19-26`) carries `conversationId`, `config`, `logger`,
`getHistory`, `getExecutionService`, `emitAgentEvent` — nothing else. Deciding there would mean
re-resolving a provider out of `config.aiProviders` by name, duplicating resolution that already
happens.

The decision belongs at the seam where `responseFormat` is actually emitted — `buildChatResponseFormat`
(`execution-service-helpers.ts:25`), called from `execution-round-provider.ts:67` and
`execution-stream.ts:159`. One shared helper covers both the round and the streaming path, which is
also what keeps CORE-042's "the turn is implemented twice" from claiming an eighth instance.

This requires widening `IResolvedProviderInfo.provider`, which is typed down to `{ chat }`
(`execution-types.ts:45-47`) and cannot answer a capability question at all. That widening is part of
this work.

### 4b. The resolved capability is reported, not just consulted

Deciding at the seam and telling nobody would leave **this document's own headline problem open**. The
Problem section says what is missing is _runtime knowledge_ of "whether the attempt the loop wraps
carried a schema at all" — and a decision made at `buildChatResponseFormat` and never surfaced is
still not knowledge anything can read.

**The carrier is the event channel, not `ICoreExecutionResult`.** The fourth revision chose the result
object, and that choice does not survive: `executeStream` returns
`AsyncGenerator<IStreamChunk>` where `IStreamChunk` is `{ chunk, isComplete }`
(`execution-stream.ts:27-30`). There is no `ICoreExecutionResult` on the streaming path and no
metadata channel on the chunk — so `robotaRunStreamStructured` (`robota-execution.ts:236`), a
first-class structured entry point, would report nothing at all.

That would ship **a declared member half the producers structurally cannot fill** — which is the exact
defect class this item exists to eliminate. PROV-006's dead vocabulary, the DeepSeek catalog, the
falsified Evidence Log row in this document's own history: all the same shape. A design whose thesis is
that an unhonoured declaration is worse than none must not close by adding one.

`ExecutionEventEmitter` already reaches both paths — it is in `IStreamDependencies`
(`execution-stream.ts:40`) as well as in `ExecutionService`, and `onExecutionEvent` is threaded through
`buildRunContext` for both. It is universal, and it needs no new contract member that can be absent.
A typed field on `ICoreExecutionResult` may be added **only alongside a terminal metadata carrier on
the streaming path** (`isComplete` being the obvious place), never on its own.

**And the report is the OUTCOME, not the resolution.** The fourth revision said the resolved
`mechanism` / `provenance` travels out. But the named consumer can compute that itself:
`session-run.ts:164` has `ctx.aiProvider` and `ctx.model` both in scope (`:171`), so after step 3 it
can call `resolveProviderCapabilities` pre-run and log the resolution directly. A post-run field
restating a pre-run computation is a second place for one fact — precisely what step 1 spends a page
collapsing.

What only the runtime holds is **what actually happened**: which transport carried the schema, whether
an extraction call was issued, whether the endpoint override applied. That is irreducible,
self-verifying, and it is what TC-04's "does not report early enforcement" should assert against.

Once injection moved to the pipeline (step 7), nothing needs this for control flow any more — so it
stands purely as an **observability** contract, which is why the event channel is the right home. Its
consumer is waiting: `session-run.ts:164-177` already logs sibling capability facts per run
(`nativeWebSearchSupported`, `nativeWebFetchEnabled`, …), so a degraded structured run becomes visible
in the session log instead of being inferred from a bad answer — which is how the reporter of #1738
had to find it.

### 5. The endpoint override lands in this change, and covers BOTH gateway providers

**`agent-provider-anthropic` accepts a `baseURL` too, and every revision before this one missed it.**
`anthropic/src/anthropic/types.ts:41-48` documents it as "any Anthropic-Messages-API-compatible
endpoint — e.g. a proxy/gateway that speaks the Messages protocol", wired at `provider.ts:84`. So
Anthropic-through-a-gateway carries the **identical defect this whole item was filed for**: it sends
`output_config.format`, the endpoint accepts it, the model may ignore it, and the runtime reports
early enforcement it does not have.

Earlier revisions gave anthropic a flat `response_schema` and split only `agent-provider-openai` on
`baseURL` — the round-1 producer-enumeration failure recurring in the answer table, where the provider
being thought about got enumerated and the others did not. Correcting the defect in one package while
leaving it standing in another this change already modifies is the documented-as-intentional exception
`code-quality.md:50` bars.

**Both gateway-capable providers resolve `provenance: 'unverified-endpoint'` when `baseURL` is set,
and both are covered by the override below.**

`'unverified-endpoint'` for every `baseURL` reverses a **correct** behaviour for a large documented
population: `llms.txt:22` names Azure, vLLM, Ollama and LM Studio alongside gateways, and Azure OpenAI
and vLLM do honour `response_format: json_schema`. For those users today's early enforcement is right,
and routing them to an extra-round fallback is a regression.

The first draft deferred the caller-side declaration to "a later override". That is the half-measure
`code-quality.md:50` forbids, applied to the mitigation instead of the fix: the override is what makes
the behaviour change safe, so it ships with it.

### 6. What the fallback actually emits — the previously "resolved" question, reopened

The first draft closed its gating question by citing Anthropic's `strict: true` and OpenAI's strict
function calling. **Those citations do not apply to the families that take the fallback.** Gemini
answers `response_schema` and never reaches it; anthropic reaches it only through a `baseURL`, where
the endpoint is by definition not Anthropic's and the guarantee does not travel with the protocol.
The paths that do take it:

- **compat (`json_object` / `none`)** — `convertToOpenAICompatibleTools`
  (`shared/openai-compatible/message-converter.ts:19-36`) emits `name`, `description`, `parameters`,
  and there is **no `strict` field anywhere in that package**. A non-strict forced tool call carries no
  conformance guarantee.
- **`agent-provider-openai` + `baseURL`** — this is the path **PROV-007** declares broken: strict mode
  refuses the `additionalProperties: true` that Zod-derived schemas emit.

So the honest claim is weaker than the first draft's, and is made explicitly: **a non-strict forced
tool call is expected to beat a prose re-prompt because models are post-trained on emitting well-formed
tool arguments, not because a vendor guarantees conformance.** The validate-and-retry loop remains the
only guarantee. **PROV-007 is a hard prerequisite** on the OpenAI path and is now declared in the
Task's `depends_on`.

### 7. Forced-tool semantics, designed rather than deferred

- **Force by name, not by `required`.** `TToolChoice` (`interfaces/provider.ts:162`) already has
  `{ tool: string }`, and both wires already map it (`shared/openai-compatible/tool-choice.ts`). This
  dissolves most of "the model picks the user's tool instead".
- **Name collision.** The schema tool's name derives from `spec.name`; core already validates that a
  named tool exists in the invocation's tool list, so a collision is detectable rather than silent. The
  rule: the synthetic tool takes a reserved prefix, and a user tool already holding that name is a
  configuration error raised at registration, not at run time.
- **Multi-round — and the previous revision's answer to it was undecidable.** `provider.ts:159-161`
  documents that "within a multi-round run, forcing directives apply to the FIRST model call only". A
  structured run that also carries real tools _is_ multi-round, so forcing the schema tool on the
  first call would short-circuit the agent's real tool work. The previous revision concluded "force
  it on the **final** call, and the emission seam knows which call that is". **Both halves are
  false**, and review round 2 showed why:
  - **Finality is a posterior fact.** The loop is `while (hasRoundCapacity(...)) { … const shouldBreak
= await executeRound(…); if (shouldBreak) break; }` (`execution-pipeline.ts:69-85`). It ends
    because the model came back with text and no tool calls. `buildChatResponseFormat` runs _inside_
    the round, before the provider call, where the only decidable predicate is
    `currentRound === maxRounds` — budget exhaustion, which on the happy path never fires. A
    "force when round is last" implementation would force the schema tool essentially never.
  - **The structurally final call bypasses the seam.** `forceSummaryCall`
    (`execution-pipeline.ts:122-170`) builds its own options — `{ model, onTextDelta? }` and nothing
    else. No `tools`, no `toolChoice`, no `responseFormat`, no call to `buildChatResponseFormat`.

**Injection is a terminal extraction call owned by the PIPELINE — the sibling of `forceSummaryCall`.**
Selection and injection are different decisions and the second revision conflated them; the third put
injection at the run level, which was also wrong, and step 4 says why three paragraphs above:
`robotaRunStructured` has no provider. It has two further gaps the third revision did not trace:

- **It cannot learn its own trigger.** The extraction is conditional on the resolved mechanism, which
  is computed at `buildChatResponseFormat`, and nothing carries it back up. `ICoreExecutionResult`
  (`execution-types.ts:150-161`) is `response / messages / executionId / duration / tokensUsed /
toolsExecuted / success / error / interrupted`, and `robotaRun` narrows even that to a `string`.
- **It cannot add a tool to a call.** The invocation's tool list is not read from config —
  `execution-service-helpers.ts:105` is `const availableTools = tools.getTools()`, the `IToolManager`.
  `robotaRunStructured`'s only lever is `configOverrides: Partial<IAgentConfig>`, and `IRunOptions`
  carries no tools either. Reaching a call from that layer would mean mutating the ToolManager through
  `robota.registerTool` / `unregisterTool` (`core/robota.ts:324,327`), which are **agent-global**: a
  register-call-unregister around an `await` is a race, and it makes the schema tool briefly visible
  to every concurrent run on that instance.

`forceSummaryCall` (`execution-pipeline.ts:122-170`) is already a pipeline-owned terminal provider call
issued after the loop converges, for the case where the loop ended without the answer the caller needs.
The schema extraction is **that function's sibling, not a new concept at a different altitude** — same
trigger shape, same layer, same needs. There it has `resolveProviderAndTools`, the resolved provider,
the capability seam, and the ability to compose a one-call tool list without touching the ToolManager.

`robotaRunStructured` keeps what it genuinely owns — the spec, validation, and the attempt budget —
and passes the spec down. With the ownership placed there, step 4 ("decide where the inputs are
resolved") and step 7 ("inject where convergence is a fact") stop pulling in opposite directions,
because in the pipeline both facts are present at once.

**The schema needs no new plumbing.** "Passes the spec down" is not an unbudgeted task: the schema
already travels. `structuredConfigOverrides` (`robota-execution.ts:167-177`) puts `spec.jsonSchema` and
`spec.name` into `config.responseFormat`, which becomes `executionConfig` and reaches the pipeline —
it is the same carrier `buildChatResponseFormat` already reads. The pipeline holds the schema and the
tool name it needs, with no new field on `IExecutionContext` or `IRunOptions`.

**The trigger is structural, because the validator cannot travel.** `IStructuredOutputSpec.validate`
(`schema/structured-output.ts:36`) is a **closure** over Zod's `safeParse` or the structural validator.
It cannot pass through `IAgentConfig.responseFormat`, which is `Record<string, TConfigValue>` — data.
So validation stays at the run layer, where it belongs.

The fourth revision's trigger — "validation failure inside the first attempt" — therefore put the
predicate in a layer that cannot perform the action, which is the round-1 and round-3 defect a third
time, for the validator instead of the provider or the tool list. The pipeline instead evaluates a
**structural** predicate over data it already holds:

> the selected mechanism is not `response_schema`, **and** the converged response does not already
> parse-and-match the JSON schema in `config.responseFormat`.

Both helpers are core and exported and operate on plain data —
`parseStructuredResponseText` and `validateAgainstJsonSchema` (`schema/structured-output.ts:274,99`).

These are **two checks answering two different questions**, not one fact stated twice: the pipeline
asks "do I need to extract?", the run layer asks "is this the object the caller asked for?".

**Evaluation order matters and is part of the design:** the conjunction is evaluated left to right, so
`mechanism ≠ response_schema` short-circuits and **the native path never parses at all**. The extra
work exists only where an extraction might actually be needed, where one `JSON.parse` sits against a
network round trip.

**The two checks are not equally powerful, and the gap is the normal case — not an edge one.**
`validateAgainstJsonSchema` checks the universal subset (CORE-039); the run layer runs full Zod
`safeParse` (`structured-output.ts:66-74`, where `jsonSchema: zodToJsonSchema(output)` and
`validate: output.safeParse` are built from the same schema but are not the same power).
`zodToJsonSchema` is lossy in exactly the directions that matter — `.email()`, `.min()`, `.refine()`,
transforms. So "structural match, Zod reject" is what happens for **any schema with real
constraints**.

Left there, the consequence is severe: no extraction fires, the run layer burns a full retry run with
prose feedback, and the same predicate can pass again on the retry — so **the extraction transport
would be unreachable for precisely the schemas with the tightest constraints**, the ones most likely
to need it. A `z.string().email()` field on a DeepSeek model would get today's behaviour forever while
this document claimed to cover it.

**The fix feeds the failure forward, using the carrier that already exists.** The run layer owns
validation and already builds the retry input (`buildRetryFeedbackInput`,
`robota-execution.ts:179-188`). It also sets a config override on the next attempt meaning _this
attempt must use the extraction transport_ — plain data on `IAgentConfig`, the same carrier
`structuredConfigOverrides` uses, no new field anywhere. So attempt 1 keeps the cheap structural
predicate as a best-effort fast path, and **every attempt after a validation failure extracts
unconditionally on a non-native provider**. The authoritative knowledge reaches the pipeline without
the closure travelling, and the prose retry becomes the last resort this design claims it is rather
than the default by accident.

**Budget and failure mechanics, stated so they are not left to an implementer's reading:**

- **The extraction does not consume an attempt.** `maxAttempts` is unchanged; attempt 1 is "run plus
  at most one extraction". With `outputRetries: 0` a failed extraction throws `StructuredOutputError`
  after one run and one extraction — strictly better than today, where the same call throws having
  sent no schema at all.
- **Unparseable `arguments` pass through as the response text**, they do not throw. The run layer then
  produces precise validation issues and the loop proceeds; throwing at the conversion would turn a
  recoverable case into a run failure.
- **At most one extraction per attempt.** The pipeline does not retry its own extraction — a failed
  one falls to the loop, or "at most one call" quietly becomes an inner loop with no budget.

**The return path, which is load-bearing and was unspecified.** The extraction call comes back as an
assistant message carrying a tool call whose `arguments` are the schema-conforming object — and, on
every wire, empty content. `robotaRun` returns the response _string_, and `validateStructuredText`
parses that string. **Unless the pipeline lifts the forced call's `arguments` into the response text,
every structured run on a non-native provider returns `''` and fails validation** — the design's
central mechanism producing nothing.

That conversion is the pipeline's, and it interacts with two existing behaviours by name:
`hasTextResponse` (`execution-pipeline.ts:90-94`) explicitly treats a message carrying tool calls as
_not_ a response, and `allowToolOnlyCompletion` (CORE-011, `:99`) is the existing seam for "a tool call
is a legitimate ending". The extraction call is a **third** case — a tool call that _is_ the answer,
after conversion — and it is stated here rather than left for an implementation round to discover.

**Conditional, so the lucky path pays nothing.** The third revision made the extraction unconditional,
charging a call to a run whose text already validated. The structural predicate above fires only when
extraction is actually needed.

**The history contract — the point at which a naive implementation would 400.** The package SSOT
governs this and no earlier revision cited it. `agent-core/docs/SPEC.md:986-987`:

> **History**: every attempt — including retry feedback turns — is a real conversation turn committed
> through the standard append-only history path. **Structured output never edits history.**

The extraction call returns an assistant message carrying a tool call and empty content. Committed
through the standard path, that leaves a **`tool_use` with no matching `tool_result`** in the
conversation. The Anthropic converter emits a `tool_use` block for every entry in
`assistantMsg.toolCalls` (`agent-provider-anthropic/src/anthropic/message-converter.ts:63-74`), and
the Anthropic API rejects an unanswered `tool_use`; OpenAI likewise requires a `tool` message per
`tool_call_id`. So the **next** provider call on that conversation — a retry attempt under this very
design, or simply the user's next turn — fails at the API. Not a degradation, a 400.

The obvious workaround collides with the SPEC line: `forceSummaryCall`, the analog this design
deliberately adopted, already does the edit-history dance — `conversationStore.clear()` and re-add a
filtered list (`execution-pipeline.ts:172-185`). Taking it as the structural sibling inherits that
tension.

**Four constraints, and the rule is their intersection.** This is the third formulation of the history
rule, and the previous two are recorded rather than quietly replaced, because each optimised one
constraint before the others were known:

| #   | Constraint                              | Broken by                                                             |
| --- | --------------------------------------- | --------------------------------------------------------------------- |
| a   | No unpaired `tool_use` persisted        | committing the raw extraction response                                |
| b   | No two consecutive assistant messages   | **round 5** — committing the converted text as a second message       |
| c   | History ends on the **accepted** answer | **round 6** — committing nothing, so history keeps the rejected prose |
| d   | No history edit (`SPEC:987`)            | `forceSummaryCall`'s `clear()`-and-re-add                             |

Round 5 committed the converted JSON as an assistant text message: it solved (a) and broke (b), since
the round has already committed its prose message and the Anthropic Messages wire rejects consecutive
assistant entries (`anthropic/message-converter.ts:56-62`) — a wire step 5's gateway correction had
just made reachable. Round 6 committed nothing: it solved (b) and broke (c).

**(c) is not a nicety — breaking it re-creates this item's own defect one layer over.** On a native
provider the model's JSON _is_ the assistant text, so `commitAssistant` writes the object into
history. Under round 6's rule a non-native provider commits the prose and returns the object only to
the caller. Same `run(input, { output })`, different conversation state **depending on which provider
package was instantiated** — verbatim the sentence the Problem section indicts. And what gets
committed is the artifact the system _rejected_: `parseStructuredResponseText` already tolerates a
fenced JSON block, so anything reaching extraction genuinely failed validation. It is also a
regression against today's loop, where a failed attempt is followed by a retry turn and history ends
on the accepted answer.

**The rule: hold the turn pending, commit exactly once.** The store already has the protocol, in the
SPEC (`agent-core/docs/SPEC.md:1104-1108`) and in use in the round — `beginAssistant()`
(`execution-round.ts:150`), `appendStreaming` / `appendToolCall` (`:210,214`), `commitAssistant`
(`:218`), and `discardPending()`, already used on the failure path at `:198`.

**And the extraction happens inside the converging round — post-response, pre-commit.** An earlier
revision put it after the loop and deferred the commit at `:218` across that boundary. That is
superseded: the pending protocol is scoped to a single provider call's streaming lifecycle, and
**four consumers read committed state after the round returns**, each breaking differently. They are
listed here because each is a trap an implementer would otherwise hit separately:

| Consumer                                                       | What deferral does                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hasTextResponse` (`execution-pipeline.ts:92-98`)              | Last committed message is a user or tool-result turn, so it reads false and **`forceSummaryCall` fires on every non-native structured run** — an extra call, a "Tool round limit reached" prompt on a run that hit no limit, and its `clear()`-and-re-add edit, which is the very edit constraint (d) exists to avoid |
| `buildFinalResult` (`execution-failure.ts:35-45`)              | Derives `response` from the last committed assistant message with non-empty content; pending is invisible, so `response` becomes the literal `'No response received. The context window may be full.'` and **the validator runs against a sentinel**                                                                  |
| `history_mutation` emission (`execution-round.ts:218,225-233`) | `getMessages().at(-1)` returns the _preceding_ message — truthy, so the guard passes and an **append event fires for an append that did not happen**, at a wrong index, against `SPEC.md:859`'s append-only replay contract                                                                                           |
| Abort return (`execution-pipeline.ts:98`)                      | Sits between the round's return and the extraction; an abort landing there leaves a pending assistant neither committed nor discarded, against `SPEC.md:1106` — "Text is ALWAYS preserved"                                                                                                                            |

The correct placement is **inside the converging round, after the response is parsed and before
`commitAssistant`** — and it is the only point where all four required inputs coexist:

- **finality**, as a local: `assistantToolCalls.length === 0` (`execution-round.ts:238`), computed from
  the parsed response with no store read — the fact that was unavailable at `buildChatResponseFormat`,
  which runs _before_ the provider call;
- **the provider and model**, via `resolved`, already `executeRound`'s parameter;
- **the schema and tool name**, via `config.responseFormat`;
- **an open pending state** the round owns.

So the converging round runs: parse response → if the mechanism is non-native and the structural check
fails, issue the extraction call → `commitAssistant` **once**, with the extracted object → return.

**This does not reopen the round-2 finding.** That round rejected forcing the schema tool on a round
that could not be identified as final _at request-build time_. This is the same fact evaluated _after_
the response, where it is free.

The commit still happens before the round returns, so all four consumers above see exactly what they
have always seen. And it satisfies every constraint: one assistant message per turn (b), no unpaired
`tool_use` (a), nothing edited or added (d), and history ending on the accepted answer on **every**
provider (c). The divergence closes instead of moving.

Transport **selection** is unaffected and stays at `buildChatResponseFormat` per step 4 — selection
belongs where the request is built; only injection moves to where the response is parsed.

**The extraction gets its own instrumented call path — the round's contract is one provider call.**
Placing the extraction inside the round makes it two, and reusing the round's path would inherit six
assumptions that do not hold for it. A named sibling of `callRoundProviderWithEvents`, not a reuse of
it, with each of these specified rather than inherited:

| #   | Assumption of the round's path                                                                                                   | What the extraction requires                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | **Forcing is round-1 only.** `resolveToolChoiceForRound` (`execution-round-streaming.ts:93-99`) reverts later rounds to `'auto'` | Pass `toolChoice: { tool }` **directly, bypassing that resolution** — a deliberate exemption, stated as one       |
| 2   | One usage record per round; `cumulativeInputTokens = inputTokens` **assigns** (`execution-round.ts:205-207`)                     | Usage is accumulated, or carried separately and included by `buildFinalResult`, so `tokensUsed` covers both calls |
| 3   | One `provider_request` / `provider_response_*` per `round` (`:70,105,111`)                                                       | Its own event kind — never a second request under the same round, and never an unpaired tool call in the stream   |
| 4   | Streaming callbacks append into the round's pending assistant (`createRoundStreamingCallbacks`, `:151`)                          | Does **not** stream into pending; whether its deltas reach `onTextDelta` is decided and pinned                    |
| 5   | `afterProviderCall` fires once per round (`:183-187`)                                                                            | Fires with an explicit marker, or is excluded with the reason recorded                                            |
| 6   | `callProviderWithCache` treats every request as ordinary                                                                         | Bypasses the cache, or the document states why a hit across differing schemas is safe                             |

**Row 1 is a correctness bug, not bookkeeping**, and it is the round-2 rule biting from the other
side: routed through the round's resolution, the extraction's named forcing would be **stripped on
every converging round after the first** — the common case for any run that used tools — and the call
would come back as prose that looks exactly like an ordinary miss.

**Row 2 makes step 7's own cost claim checkable.** That step argues the extraction is cheaper than the
retry it displaces; under the round's wiring the one call it adds is the one call it does not count,
so the claim would be unverifiable from the runtime's own numbers.

**The streaming case is decided here, not left to the implementer.** On the streaming structured path
the prose deltas have already been yielded before extraction runs, so committing the object makes
history differ from what the caller watched stream by. **Commit the object anyway.** History is the
record of the turn's outcome, and a streamed-then-superseded render is already what happens on any
retried attempt today. Pinned explicitly, because an implementer who does not notice will commit
whatever is convenient on each path and the two entry points diverge again — which is the failure
this document has now corrected three times.

**Two ordering facts, verified rather than assumed.** There is no race with the attempt's own append:
`commitAssistant` runs **inside** the round (`execution-round.ts:214`), so by the time the loop exits
the store already holds the converged assistant message — the same guarantee `hasTextResponse` and
`forceSummaryCall` already depend on. A post-loop read is sequential and deterministic. And the
extraction's request is composed **without mutating the store** —
`[...conversationStore.getMessages(), <trailing user message>]` passed straight to `provider.chat`.
That is what makes out-of-band implementable, and it is strictly better than `forceSummaryCall`'s
`clear()`-and-re-add (`execution-pipeline.ts:172-185`), which is the edit that sits in tension with
`SPEC:987`. The trailing user message is not decoration: a conversation ending on an assistant message
is not a valid request shape on every wire, which is why the sibling has one too.

**And that call is cheaper than the retry it displaces.** An attempt is a whole run, not a call:
`maxAttempts = (options.outputRetries ?? 2) + 1` and each attempt calls `robotaRun`
(`robota-execution-structured.ts (extracted by CORE-042)`), which runs the entire round loop with full history. So on the compat
family — where a prose first response is the structurally guaranteed case, since no schema is sent —
the extraction replaces a full run with one provider call. Stated honestly: both replay the
conversation, so the saving is "one history replay instead of one history replay **plus a round
loop**", not "one call instead of a run's worth of tokens". Step 6's justification is expectational,
so this cost argument is made explicitly rather than left to be assumed.

**An existing defect this absorbs.** `forceSummaryCall` carries no `responseFormat` on _any_ provider,
native ones included — so a structured run that exhausts its rounds already ends on a call with no
schema signal today. That is a latent instance of this item's own defect that nobody had noticed. Per
[code-quality.md](../../rules/code-quality.md) `:51` it is absorbed here: `forceSummaryCall` is routed
through the shared option builder, or excluded with a stated reason. Leaving a second divergent
option-construction path is exactly the "the turn is implemented twice" pattern (CORE-042) that step 4
cites as its reason to prefer one helper.

### Alternatives considered

**A. Thread `responseFormat` through the compat builder and stop.** One line in the seam #1757
created. Rejected as the whole answer: it sends a schema to models the vendor documents as not
supporting it, and leaves `agent-provider-openai`-through-a-gateway still misreporting. **And it is
withdrawn as a landing step too** — that wording predates step 1's correction, which established
DeepSeek is `json_object` only, so threading `responseFormat` there would send a surface the vendor
does not offer.

**B. Put transport selection in `IRunOptions` / agent config alone.** Makes the caller responsible for
knowing what their endpoint supports — the knowledge the SDK is supposed to hold. It would not have
helped the reporter of #1738, who had no way to know either. **Partially adopted**: as the step-5
override, it is the necessary escape hatch; as the whole mechanism, it is not.

**C. Probe the endpoint.** `shared/openai-compatible/endpoint-probe.ts` exists. Rejected: a probe costs
a request and is not deterministic, and `provenance: 'unverified-endpoint'` carries the same
information without the round trip.

**D. Delete the per-model vocabulary (PROV-006's other branch).** Rejected — but note the first draft
rejected it partly because the vocabulary "would have to be rebuilt immediately", which is an argument
for building it correctly now, not for keeping it unread. The real reason to keep it is that a
model-scoped declared source is the correct structure; step 1 makes it live.

**E. Add a structured-output member to the instance-level `IProviderCapabilities` (the first draft).**
Rejected on review: it gives one of six overlapping facts a third representation while five stay dead,
and it cannot be reached from the decision point.

## Architecture Review

Per [spec-workflow.md](../../rules/spec-workflow.md) § Validated Recommendation Before Approval. This
crosses a contract boundary, so the three checks are run explicitly.

**Reachability — re-verified after the first check was found insufficient.** The first draft verified
that the _type_ is exported (`agent-core/src/index.ts:91`) and has a live consumer
(`agent-session/src/session-run.ts:164`), and stopped there. It never checked that the decision point
can obtain a provider to ask — and it cannot: `IRobotaExecutionDeps` carries no provider, and
`IResolvedProviderInfo.provider` is typed `{ chat }` only. Export-level reachability is not reachability
at the decision point. The revised design decides at `buildChatResponseFormat`, reached from both
`execution-round-provider.ts:67` and `execution-stream.ts:159`, and widens the resolved-provider type as
part of the work.

**Capability preservation — re-enumerated after the first enumeration proved incomplete.** The first
draft listed four producers and claimed "verified by enumeration, not by grep". It missed
`abstract-ai-provider.ts:210` (a concrete non-optional default, not merely the helper),
`agent-provider-openai/src/openai/provider.ts:162` (the provider whose answer the design most wants to
change), anthropic's second producer at `:311`, qwen's separate file, and — the material one —
**`agent-provider-gemini` has no override at all**. The full list is in step 3. Two behaviours are
**consciously changed**: `agent-provider-openai` with a `baseURL` stops reporting early enforcement
(the defect), mitigated for Azure/vLLM by the step-5 override; and the model argument becomes required,
so every producer is updated rather than silently ignoring it.

**Adversarial pass — independent, completed.** See below.

### Independent review

Twelve rounds with `proposal-reviewer`, 2026-08-16. All twelve returned **`REVIEW VERDICT: REVISE`**;
all were accepted in full, and in every round each load-bearing finding was independently
re-checked against the code before revising. No finding was refuted in any round.

**Round 3** (on the second revision) settled steps 1–6 — the discovery/capability split, the miss
policy, mechanism/provenance, the required model argument, the eight-producer enumeration, the
weakened fallback claim — and blocked on one thing: the new owner for injection.

| Round-3 finding                                                                  | Re-checked at                                            | Disposition                                                      |
| -------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| `robotaRunStructured` cannot learn its own trigger — no capability on the result | `execution-types.ts:150-161`                             | Fixed — step 4b                                                  |
| It cannot add a tool: the list comes from the ToolManager, not config            | `execution-service-helpers.ts:105`                       | Fixed — owner moved                                              |
| Mutating it via `registerTool`/`unregisterTool` is agent-global — a race         | `core/robota.ts:324,327`                                 | Fixed — owner moved                                              |
| The document's own Problem is not closed by its own solution                     | Problem § vs. the seam decision                          | Fixed — step 4b                                                  |
| Steps 4 and 7 asserted opposite things about the same function                   | the two paragraphs                                       | Fixed — step 7 reconciles them                                   |
| Unconditional extraction charges the lucky path for nothing                      | `validateStructuredText`, `robota-execution.ts:209`      | Fixed — conditional; TC-05b                                      |
| An attempt is a whole RUN, so extraction is cheaper than the retry it replaces   | `robota-execution-structured.ts (extracted by CORE-042)` | Adopted — the premise is stronger than claimed; stated in step 7 |
| A static table just relocates staleness unless its purpose changes               | DeepSeek stamped `2026-05-07`, wrong throughout          | Fixed — deviations-not-enumeration, in step 1                    |

The reviewer's correction on cost is worth keeping visible: this design's fallback was defended as
merely acceptable overhead, and it is in fact **cheaper** than what it displaces, because each retry
attempt is a full round loop and the extraction is one call.

**Rounds 1 and 2** are below. Round 2 (on the first revision):
the code before revising. No finding was refuted.

**Round 11** (on the tenth revision) answered this author's question about step 3b's completeness with
**no** — the sweep had the same shape of gap, one axis over. "Consumer" had been scoped to _readers of
capability_; the set that matters equally is _expressers of intent_, and a caller can express intent
through a channel that reads no capability and emits no provider event. Step 3c is that axis.

| Round-11 finding                                                               | Re-checked at                                                 | Disposition                        |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------- |
| **`agent-provider-openai` construction options bypass the core gate entirely** | `openai/types.ts:124,128`; `chat-completions-chat.ts:147-148` | Fixed — sole-gate decision; TC-08e |
| `agent-session` is a further publisher of the `json_object` arm                | `session-types.ts:154`                                        | Fixed — step 3c row 4              |
| A live in-repo caller gets nothing today                                       | `agent-command-workflows/.../author.ts:60`                    | Fixed — TC-08d retargeted          |
| **The CLI already ships the prompt-injected schema this design scoped out**    | `cli-args.ts:49,269`; `append-system-prompt.ts:26-28`         | Fixed — TC-08f                     |

This author's own sweep then found two more publishers the review had not named
(`interactive-session-options.ts:157,279`) and one false positive worth recording
(`dag-framework/prompt-backend.ts` matches on a schema→port converter, not an intent channel).

**Round 10** (on the ninth revision) produced the meta-finding that explains rounds 6–9: **producers
were enumerated, consumers never were.** Round 1 caught the producer gap and round 3 fixed it as a
table; nothing did the same for the readers of the behaviour this change alters, so four consecutive
rounds each found one by accident. Step 3b is that pass, done once from a workspace sweep.

| Round-10 finding                                                                                    | Re-checked at                         | Disposition                                                 |
| --------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------- |
| **Round 9's new event kind breaks the replay corpus** — recorded on one name, cursor still advances | `replay-provider.ts:60-71,88-95`      | Fixed — record under the existing name with a discriminator |
| `ReplayProvider` has no `getCapabilities` — the Gemini shape, in the determinism package            | `replay-provider.ts:82`               | Fixed — step 3b table; TC-08b                               |
| The scripted provider cannot express what six criteria assert                                       | `testing/scripted-provider.ts:88`     | Fixed — step 3b table                                       |
| `LocalExecutor` reads `tools` outside the seam TC-08 claims                                         | `executors/local-executor.ts:180-186` | Fixed — TC-08c                                              |
| Cost left on the dynamic side of step 1's split                                                     | `provider-definition.ts:84-85`        | Fixed — travels with capability                             |
| Five surfaces unexplored                                                                            | —                                     | Recorded as unknown, not clean                              |

The replay collision is the sharpest result of the whole loop: a fix this reviewer recommended in
round 9, which this document adopted, was falsified in round 10 by a consumer neither party had
walked. That is the argument for step 3b existing at all.

**Round 9** (on the eighth revision) confirmed the placement and found that the round's _contract_ is
one provider call, which the new placement makes two:

| Round-9 finding                                                                                 | Re-checked at                           | Disposition                     |
| ----------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------- |
| **`resolveToolChoiceForRound` strips the forcing after round 1** — the extraction returns prose | `execution-round-streaming.ts:93-99`    | Fixed — own path, row 1; TC-07f |
| Usage **assigns** rather than accumulates, so the extraction's tokens are unattributed          | `execution-round.ts:205-207`            | Fixed — row 2; TC-07f           |
| A second `provider_request` under one `round`, with an unpaired tool call in the event stream   | `execution-round.ts:70,105,111`         | Fixed — row 3                   |
| Streaming callbacks would concatenate extraction text onto the pending prose                    | `createRoundStreamingCallbacks`, `:151` | Fixed — row 4                   |
| `afterProviderCall` fires once per round                                                        | `:183-187`                              | Fixed — row 5                   |
| Cache eligibility undecided                                                                     | `callProviderWithCache`                 | Fixed — row 6                   |

The first is the round-2 rule biting from the other side, and it is the reason the extraction needs an
instrumented path of its own rather than a reuse of the round's.

**Round 8** (on the seventh revision) traced the seam the previous two rounds had moved, at this
author's request, and found the history _outcome_ right and the _lever_ wrong — deferring the commit
across the round boundary breaks four consumers, each differently:

| Round-8 finding                                                              | Re-checked at                              | Disposition                      |
| ---------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------- |
| `hasTextResponse` reads false → spurious `forceSummaryCall` every run        | `execution-pipeline.ts:92-98`              | Fixed — commit stays in-round    |
| `buildFinalResult` returns the "No response received" sentinel               | `execution-failure.ts:35-45`               | Fixed — same                     |
| `history_mutation` fires for an append that did not happen, at a wrong index | `execution-round.ts:218,225-233`           | Fixed — same; TC-07e             |
| An abort between round return and extraction loses pending text              | `execution-pipeline.ts:98`; `SPEC.md:1106` | Fixed — same                     |
| Finality is a free local **after** the response                              | `execution-round.ts:238`                   | Adopted — the placement argument |

The placement question ran through five positions across eight rounds — `robotaRunStructured`, the
emission seam, the run-level terminal phase, the pipeline post-loop, and finally inside the converging
round. The last one is not another swing: it is the only point where all four required inputs coexist
(finality as a local, the resolved provider, the schema, and an open pending state), and stating it
that way is what makes it checkable rather than plausible.

**Round 7** (on the sixth revision) found that the fully out-of-band rule was correct about wire
validity and wrong about conversation semantics — the specific risk this author had asked it to check
rather than assume:

| Round-7 finding                                                                                                                    | Re-checked at                                         | Disposition                        |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------- |
| Committing nothing leaves history on the **rejected** prose, so conversation state again depends on which package was instantiated | the Problem section's own indictment                  | Fixed — pending-then-commit-once   |
| The pending protocol already exists, and `discardPending()` is already used on a failure path                                      | `execution-round.ts:150,198,214`; `SPEC.md:1104-1108` | Adopted — no new machinery         |
| The streaming case would diverge if left unstated                                                                                  | streamed deltas precede extraction                    | Fixed — decided and pinned, TC-07d |

**Round 6** (on the fifth revision) closed the ordering question this author raised — there is no race,
because `commitAssistant` runs inside the round (`execution-round.ts:214`), so the post-loop read is
sequential — and then found one verified fact that changed two steps, **including a correction to the
reviewer's own round-5 recommendation**:

| Round-6 finding                                                                                                    | Re-checked at                                | Disposition                                              |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | -------------------------------------------------------- |
| `agent-provider-anthropic` accepts `baseURL` — the gateway defect is not OpenAI-only                               | `anthropic/types.ts:41-48`, `provider.ts:84` | Fixed — step 5 covers both providers                     |
| Committing the converted text produces **two consecutive assistant messages** — a 400 on a strict-alternation wire | `anthropic/message-converter.ts:56-62`       | Fixed — fully out-of-band; TC-07b now pins both failures |
| No race, and the request must be composed without mutating the store                                               | `execution-round.ts:214`                     | Adopted — stated as verified                             |

The second row is the notable one: the reviewer recommended committing the converted assistant text in
round 5, this document adopted it, and round 6 falsified it — but only because round 6's _own_ first
finding (anthropic + `baseURL`) made the strict-alternation wire reachable. Neither fact alone would
have surfaced it.

**Round 5** (on the fourth revision) confirmed the design's shape as final — the reviewer stated it
would approve steps 1–6, the pipeline ownership, the predicate's placement, the carrier decision and
the outcome framing as written — and blocked on three narrow points. Two were the ones this author had
flagged; the third neither party had looked at, and it is the most serious finding of all five rounds.

| Round-5 finding                                                                                   | Re-checked at                                                                              | Disposition                                            |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| **The extraction leaves an unpaired `tool_use` in history — the next provider call is a 400**     | `SPEC.md:986-987`; `anthropic/message-converter.ts:63-74`; `execution-pipeline.ts:172-185` | Fixed — out-of-band rule, TC-07b                       |
| Subset-vs-Zod divergence is the NORMAL case, so extraction is unreachable for constrained schemas | `structured-output.ts:66-74` — lossy `zodToJsonSchema` vs. full `safeParse`                | Fixed — failure fed forward, TC-07c                    |
| Evaluation order unstated, so the double parse reads as a real cost                               | the conjunction itself                                                                     | Fixed — short-circuit stated; native path never parses |
| Whether a failed extraction consumes the retry budget was unstated                                | `maxAttempts`, `robota-execution.ts:202`                                                   | Fixed — it does not; mechanics named                   |

The history finding is worth naming plainly: this design adopted `forceSummaryCall` as its structural
analog and inherited a tension with the SPEC clause that `forceSummaryCall` itself resolves by editing
history — which `SPEC:987` forbids for structured output. The out-of-band rule satisfies both
constraints instead of choosing between them.

**Round 4** (on the third revision) confirmed the pipeline ownership, the cost argument, the
conditional trigger and the capability-table posture, and blocked on the two points this author had
again flagged as uncertain — both of which broke:

| Round-4 finding                                                                                                                                     | Re-checked at                                                         | Disposition                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------- |
| `validate` is a closure, so the trigger's layer cannot perform the action — the round-1 defect a third time                                         | `schema/structured-output.ts:36`                                      | Fixed — structural predicate in step 7 |
| **The return path was unspecified**: a forced tool call returns `arguments` and empty content, so every non-native structured run would return `''` | `hasTextResponse`, `execution-pipeline.ts:90-94`                      | Fixed — conversion named, TC-04b       |
| `ICoreExecutionResult` does not exist on the streaming path                                                                                         | `IStreamChunk` = `{ chunk, isComplete }`, `execution-stream.ts:27-30` | Fixed — event channel is the carrier   |
| Reporting the _resolution_ duplicates what the consumer can compute pre-run                                                                         | `session-run.ts:164,171`                                              | Fixed — the report is the outcome      |
| The schema needs no plumbing — it already travels                                                                                                   | `structuredConfigOverrides`, `robota-execution.ts:167-177`            | Adopted — stated, not budgeted as work |

The carrier finding is the one worth keeping visible: adding an optional field that half the producers
structurally cannot fill would have shipped **a declared member nobody honours** — the exact defect
class this item exists to eliminate, committed by the document that exists to eliminate it.

Round 2 confirmed the unified-channel direction and steps 2–6, and blocked
on two defects that the first revision had _introduced_ — both at the two points this author had
flagged as uncertain when sending it back:

| Round-2 finding                                                                        | Re-checked at                                                    | Disposition                                                  |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| "Force on the final call, the seam knows which" — undecidable; the seam runs mid-round | `execution-pipeline.ts:69-85`                                    | Fixed — step 7 moves injection to a run-level terminal phase |
| The structurally final call bypasses the seam and carries no schema on any provider    | `execution-pipeline.ts:152-170` — `{ model, onTextDelta? }` only | Fixed — absorbed as an existing defect, TC-06b               |
| "Catalog declares" has no source for OpenAI; `refreshModelCatalog` invoked by nothing  | `openai/provider-definition.ts:36-40`; no caller in any `src`    | Fixed — step 1 splits discovery from capability              |
| Catalog-miss semantics undefined, now governing six flags                              | optional `capabilities`, exact-id lookup                         | Fixed — miss policy table, TC-03b                            |
| Evidence Log still asserted the falsified "four producers"                             | the row itself                                                   | Fixed — the row now reads eight, Gemini's absence included   |
| Prior Art #2 still argued for the rejected tri-state                                   | the sentence itself                                              | Fixed — retargeted at mechanism                              |
| `lastVerifiedAt` has no keeper                                                         | DeepSeek entries stamped `2026-05-07`, wrong throughout          | Fixed — TC-03 staleness scan                                 |

The falsified Evidence Log row deserves naming rather than burying: the first revision corrected the
producer count in the body and left the **audit surface** stating the count the revision existed to
fix. That is the same defect class as the DeepSeek catalog entry this whole item is about — a
declaration nobody re-read after the fact under it changed.

**Round 1** (on the original draft):

| Finding                                                                                                         | Re-checked at                                                    | Disposition                                                      |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| Decision point cannot reach a provider                                                                          | `robota-execution.ts:19-26`, `execution-types.ts:45-47`          | Fixed — step 4                                                   |
| Producer enumeration incomplete; **gemini has no override**                                                     | `grep getCapabilities packages/agent-provider-gemini/src` → none | Fixed — step 3                                                   |
| `strict:true` citations apply only to providers that never take the fallback; no `strict` in the compat package | `grep strict …/agent-provider-openai-compatible/src` → none      | Fixed — step 6, claim weakened                                   |
| PROV-007 unmentioned and undeclared                                                                             | `.agents/tasks/PROV-007-*.md` exists                             | Fixed — `depends_on`                                             |
| Tri-state encodes provenance and discards mechanism                                                             | own Prior Art finding #2                                         | Fixed — step 2                                                   |
| "Catalog is the source" false for OpenAI                                                                        | `openai/provider-definition.ts:36-40` — `status: 'unavailable'`  | Fixed — step 1 makes the provider qualify, not the catalog alone |
| Optional `model?` justified by "nothing breaks"                                                                 | `code-quality.md:50`                                             | Fixed — step 3                                                   |
| Forcing applies to the FIRST call only                                                                          | `interfaces/provider.ts:159-161`                                 | Fixed — step 7                                                   |

Two findings are recorded as **accepted but not adopted here**: the reviewer notes anthropic and gemini
provider-definitions also declare `json_schema` (`anthropic/provider-definition.ts:80`,
`gemini/provider-definition.ts:45`) — correct, and folded into step 1's audit rather than a separate
criterion; and that `project-structure.md:113` ("no invented prompt/protocol directives") is the rule
that supports scoping out DeepSeek's `json_object` prompt requirement — now cited rather than argued
freehand.

**Migration cost, stated rather than used as a veto.** This is materially larger than the first draft:
eight capability producers updated (one newly created for Gemini), two emission seams plus the
resolved-provider type widened in agent-core, catalog corrections across five provider packages, the
`TProviderModelCapability` vocabulary extended and made live, PROV-006 closed as part of the work, and
PROV-007 sequenced ahead of the OpenAI fallback path. It is the size the defect is: this fact has been
filed **three times in three days from three channels** because no layer owns it, and a fourth partial
representation is how that continues.

## Landing sequence — corrected by depth triage

> **Superseded 2026-08-16.** The first version of this section split the work into four **delivery**
> units (A/B/C/D) by blast radius. `finding-depth-triager` judged the ten expansions and returned
> **7 FOUNDATIONAL of 10** — three of them **already filed** as open items three days before CORE-043
> existed. A delivery split and a depth split are not the same question, and this section had
> conflated them: its own opening sentence ("the `area` grew from three packages to thirteen") is a
> _size_ observation, and a size remedy was the answer given.

**What belongs to CORE-043** — its own thesis, plus the two defects this change itself creates:

| Content                                                                      | Depth                                                                                    |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Transport selection, terminal extraction, the outcome report (§ 4, 4b, 6, 7) | LOCAL — this item's thesis                                                               |
| Replay discriminator + `session-log-events.ts`                               | LOCAL — the desync exists only because this design adds a second call in a round         |
| DeepSeek catalog `json_schema` → `json_object`                               | LOCAL — a data fix in a file this work rewrites                                          |
| `agent-provider-gemini` gains `getCapabilities`                              | LOCAL — its inherited default is correct **today**; this change's own contract breaks it |

**What was absorbed and is being returned to its owner:**

| Absorbed as                                                 | Real owner                                                                                      | Blocks CORE-043?                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Unify capability channels, close PROV-006 for all six flags | **PROV-006** (2026-08-13, open) — its Direction _is_ this decision                              | **Yes** — now in `depends_on`                                                                 |
| `LocalExecutor.supportsTools()` disjunction                 | **PROV-006** — cites `local-executor.ts:180-182` verbatim                                       | No                                                                                            |
| `forceSummaryCall` drops `responseFormat`                   | **CORE-033** (2026-08-13, open) — enumerates `signal`, `effort`, idle-timeout at the same lines | No — a run that exhausts its rounds is not the extraction's path                              |
| Catalog struct split + cost move                            | **PROV-008** (filed with this change)                                                           | Partly — a declared source is needed; the **cost move is not**, and had no forcing constraint |
| Provider construction-level format                          | **PROV-009** (filed with this change)                                                           | No — scopes one criterion (TC-08e)                                                            |
| CLI `--json-schema` prompt append                           | **CLI-081** (filed with this change)                                                            | No — the coupling was rhetorical                                                              |

**Why this is not scope-shrinking for churn reasons.** [code-quality.md](../../rules/code-quality.md)
`:51` says a defect found along the way must be absorbed, not bypassed. A defect that **already has a
filed owner** is not "found along the way" — absorbing it does not fix it sooner, it hides an open
item under a different number and inflates one `area`. [finding-depth.md](../../rules/finding-depth.md)
is the owner of that distinction and says to file the root item, never a third option. The correct
design in this document is unchanged; only which item carries each part of it.

**Order:** PROV-006 decides consume-or-delete → PROV-008 gives the answer a home → CORE-043 lands its
transport and extraction, with PROV-007 ahead of its OpenAI path. All three are in `depends_on` —
PROV-008 was omitted in the first rescope while this table already marked it blocking, which would
have let an orchestrator gating on the machine-readable field start CORE-043 in an order this document
forbids. PROV-009, CLI-081 and CORE-033 run
independently. The replay discriminator can land any time.

**One number, for the record.** CORE-043's `area` reached 13 packages. PROV-006's is 4, CORE-033's is
1, CLI-081's is 1. This item's own thesis is now scoped to 7 — `agent-core` plus the five provider
packages that must answer their own structured-output mechanism for transport selection to work, plus
`agent-session` for the replay-log discriminator.

**A correction to the first rescope, from PR review.** That pass cut `agent-provider-openai` and never
included `agent-provider-anthropic`, which is wrong in the opposite direction to the growth it was
correcting: step 3's producer table and step 5's `baseURL` provenance both require work in exactly
those two packages, so a scoped `harness:verify` would not have covered what this design says it
touches. Trimming past the thesis is the same failure as growing past it — the test is what the item
actually changes, not whether the number went up or down.

## Completion Criteria (draft)

- **TC-01** Given provider _P_ and model _M_, the emitted request carries or omits the schema exactly
  as the resolved capability says — asserted on the request, not on the presence of a type member.
  (The first draft's "the member exists and the resolver returns it" was a compile-time tautology.)
- **TC-02** **Both** gateway-capable providers — `agent-provider-openai` and
  `agent-provider-anthropic` — resolve `provenance: 'vendor-default'` without a `baseURL` and
  `'unverified-endpoint'` with one; a test pins each, and a further one pins the step-5 override
  restoring `response_schema` for a declared Azure/vLLM endpoint. Anthropic is named explicitly
  because every revision before the seventh gave it a flat `response_schema` and missed that
  `types.ts:41-48` advertises the same gateway configuration.
- **TC-03** Catalog entry ↔ resolved capability ↔ emitted request are mutually consistent for every
  provider, tested. Vendor verification is recorded as a dated source on the catalog entry
  (`lastVerifiedAt` / `sourceUrl` already exist on `IProviderModelCatalogEntry`) — a human act with an
  auditable stamp, not a machine check pretending to be one. DeepSeek's entry states `json_object`.
  The stamp gets a keeper: a scan fails on any capability entry whose `lastVerifiedAt` is past a
  staleness threshold. Without it the field records a date and enforces nothing — the DeepSeek entries
  are stamped `2026-05-07` and were wrong for the whole interval.
- **TC-03b** A model slug absent from the declared capability table resolves to the provider's
  vendor-default with `provenance: 'undeclared-model'`, and **`tools` stays enabled** — the miss case
  pinned for an unrecognised OpenAI snapshot, since that is the common case and a negative there would
  silently disable tool calling.
- **TC-04** A structured run against a non-`response_schema` provider emits an outcome report saying
  which transport carried the schema and whether an extraction call was issued — and does **not**
  report early enforcement. Asserted on **both** entry points: `run(input, { output })` and
  `runStream`'s structured form, since the event channel is what makes the streaming path reportable
  at all.
- **TC-04b** The extraction call's tool `arguments` become the value the validator sees, **without
  being committed to history**. A run whose extraction succeeds returns the object, not `''` — the
  conversion step 7 names, pinned, because without it the whole mechanism yields nothing.
- **TC-05** With `outputRetries: 0` against a non-`response_schema` provider, a run whose first
  response is prose still returns a validated object — via the extraction call, and **without a second
  full run**. Scriptable deterministically against the scripted provider, and it asserts the property
  this item exists to restore rather than the implementation that delivers it. (The first draft
  asserted the run _succeeds_, which is a property of the model; the third pinned the unconditional
  design by asserting attempt 1 always carries the schema.)
- **TC-05b** A run whose first response already validates issues **no** extraction call — the lucky
  path pays nothing.
- **TC-06** The forced-tool rules from step 7 are implemented and tested: named-tool forcing, the
  reserved-prefix collision error raised at registration, and — for a run that also carries real tools
  — the real tool rounds complete first and the schema tool is carried by a **terminal extraction call
  issued after the run converged**, not by a round inside the loop. (The first draft's TC-06 tested a
  rule the design had deferred; the second revision's tested one that was undecidable where it was
  placed.)
- **TC-06b** `forceSummaryCall` carries the same schema signal as any other terminal call, or is
  excluded with the reason recorded — it carries none today, on native providers included.
- **TC-07** `agent-core/docs/SPEC.md:979` no longer says providers without a native surface "ignore
  it" — PROV-004 classifies that as a violation, so the SPEC currently documents the violation as
  intent. § Structured Output Contract's **History** clause (`:986-987`) additionally states the
  out-of-band rule for the extraction call, since that clause is what governs it.
- **TC-07b** After a structured run that used the extraction transport, history **ends on the object
  the caller received**, contains **exactly one assistant message for that turn**, contains **no
  unanswered tool call**, and a subsequent turn on the same conversation both **succeeds** against an
  alternation-enforcing converter and **can reference the structured answer**. One criterion pinning
  wire validity and conversation semantics together — separating them is what let three successive
  formulations each fix one and break the other.
- **TC-07d** The streaming structured path commits the same thing the non-streaming one does: the
  extracted object, even though the prose deltas were already yielded. Pinned so the two entry points
  cannot diverge.
- **TC-08d** `agent-command-workflows/src/authoring/author.ts:60` — a **live in-repo caller** passing
  `responseFormat: { type: 'json_object' }` — is not reinterpreted as a structured-output request (no
  extraction fires), and on a provider whose mechanism cannot carry it the caller is **told** rather
  than silently dropped. Covers the same arm published by `agent-framework` (`query.ts:30`,
  `agent-runtime.ts:58`, `interactive-session-options.ts:157,279`) and `agent-session`
  (`session-types.ts:154`).
- **TC-08e** A structured request made through `agent-provider-openai` **construction options**
  (`responseFormat: 'json_schema'` + `jsonSchema`) resolves through the same capability gate as a
  core-issued one, and step 4b's report describes what the wire actually carried. Without this, the
  design's central claim is bypassed by a documented option and the report lies about it.
- **TC-08f** The CLI `--json-schema` flag routes through the gated path rather than appending a schema
  instruction to the system prompt — removing the contradiction with step 4's own scope-out of prompt
  injection under `project-structure.md:113`.
- **TC-08b** A replayed structured run reproduces the recorded run exactly: the extraction's response
  is in the corpus, the cursor does not desynchronise, and `ReplayProvider` resolves an explicit
  capability rather than a vendor default. Determinism is that package's whole purpose, so it is
  pinned rather than assumed.
- **TC-08c** `LocalExecutor` answers `tools` through the step-1 seam per (provider, model), or its
  exemption is recorded — without this TC-08's claim that all six flags resolve through the seam is
  false on the executor path, which is exactly where a wrong `tools` answer disables tool calling.
- **TC-07f** On a converging round **after round 1**, the extraction request carries the named forcing
  directive, and the run's reported `tokensUsed` includes the extraction call. The two failures that
  are otherwise silent, pinned together: stripped forcing returns prose that looks like an ordinary
  miss, and an uncounted call looks like a cheap run.
- **TC-07e** A structured run on a non-native provider issues **no** `forceSummaryCall`, and emits
  **exactly one** `history_mutation` append for the converging turn with the index matching the
  committed message. This pins the breakage class of a deferred commit directly rather than through
  its symptoms — a spurious summary call and a replay event for an append that never happened.
- **TC-07g** Every touched provider package's `docs/SPEC.md` states its capability-table contract,
  and `agent-provider-openai`'s records the removal of the provider-level `responseFormat` /
  `jsonSchema` option — which that SPEC does not mention today, while the option is published. A
  package SSOT silent on its own published option is the defect class this item is _about_: a
  declaration nobody updated after the fact under it changed. Distributes across the children under
  the landing sequence below.
- **TC-07c** A validation failure on attempt _n_ causes attempt _n+1_ to use the extraction transport
  on a non-native provider **unconditionally**, without re-consulting the structural predicate — the
  subset-vs-Zod divergence, pinned with a schema whose constraints live outside the universal subset
  (`z.string().email()` is the canonical case).
- **TC-08** PROV-006 is closed: all six `TProviderModelCapability` flags resolve through the step-1
  seam, and the deepseek `supportsTools()`-vs-catalog contradiction is gone as a consequence rather
  than as a separate fix.

## User Execution Test Scenarios

Both scenarios are `agent-executable` and provider-free — no API key, no network, no live credential.
They were authored before implementation and executed against the landed change; the full observed
output is recorded as the gate evidence in
[the Task](../../tasks/completed/CORE-043-structured-output-capability-has-no-runtime-representation.md#user-execution-test-scenarios),
which is the SSOT for the evidence and is not duplicated here.

| #   | Command                                                                                      | Expected observable result                                                                                                                                                                                                                           | Outcome |
| --- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | `cd scratch && node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-043-s1.ts` | A structured `run` against a provider whose capability is `json_object` resolves in ONE provider call, the wire option is downgraded from `json_schema`, and the schema is stated to the model on attempt one.                                       | PASS    |
| 2   | `cd scratch && node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-043-s2.ts` | The real `OpenAIProvider` reports `endpointIsVendorDefault()` as `false` behind a configured `baseURL` while declaring no capability table, and a structured turn emits a `structured_output_transport` event naming what the request actually sent. | PASS    |

The end-to-end gateway half is deliberately not claimed: scenario 2 proves the provider reports the
gateway honestly, which is the part this repository owns. What an arbitrary gateway does with the
parameter is not ours to assert.

## Evidence Log

| Claim                                               | Verified at                                                                                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spec.jsonSchema` has two consumers                 | `agent-core/src/core/robota-execution.ts:173,186`                                                                                                                                           |
| compat family never reads `responseFormat`          | `grep -rn responseFormat packages/agent-provider-openai-compatible/src` → no hits                                                                                                           |
| deepseek catalog claims `json_schema`               | `deepseek/model-catalog.ts:16,25,35,45`                                                                                                                                                     |
| nothing reads the catalog `capabilities` array      | `grep -rn "\.capabilities" packages/agent-provider-openai-compatible/src packages/agent-cli/src` → no hits                                                                                  |
| `IProviderCapabilities` shape and default           | `agent-core/src/interfaces/provider-capabilities.ts:20-23,33-50`                                                                                                                            |
| resolver is exported and consumed                   | `agent-core/src/index.ts:91`, `agent-session/src/session-run.ts:164`                                                                                                                        |
| **eight** capability producers, not four            | `abstract-ai-provider.ts:210`, `openai/provider.ts:162`, `anthropic:284` and `:311`, `deepseek:186`, `qwen/provider-capabilities.ts`, `gemma:185`, and **`agent-provider-gemini` has none** |
| finality is posterior to the round call             | `execution-pipeline.ts:69-85` — loop ends on `executeRound`'s `shouldBreak`                                                                                                                 |
| the terminal call bypasses the emission seam        | `execution-pipeline.ts:122-170` — `forceSummaryCall` builds `{ model, onTextDelta? }` only                                                                                                  |
| `refreshModelCatalog` is invoked by nothing         | declared in six provider-definitions; no caller and no `modelCatalog.entries` reader in any `src`                                                                                           |
| OpenAI's catalog declares discovery, not capability | `openai/provider-definition.ts:36-40`; `IOpenAIModelCatalogResource` carries `id` only                                                                                                      |
| gateway configuration is advertised                 | `llms.txt:22`                                                                                                                                                                               |
| SPEC documents the drop as intent                   | `agent-core/docs/SPEC.md:979`                                                                                                                                                               |
| PROV-004 calls the same behaviour a violation       | `.agents/tasks/PROV-004-*.md:33`                                                                                                                                                            |
| no stable release exists                            | npm `@robota-sdk/agent-core`: 71 versions, 0 non-prerelease                                                                                                                                 |
| DeepSeek supports `json_object` only                | <https://api-docs.deepseek.com/guides/json_mode>                                                                                                                                            |
| OpenAI documents two mechanisms                     | <https://developers.openai.com/api/docs/guides/structured-outputs>                                                                                                                          |
| Anthropic documents strict tools + forcing          | <https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview>                                                                                                                    |
| Gemini limits schema depth and features             | <https://ai.google.dev/gemini-api/docs/structured-output>                                                                                                                                   |

## Sources

- [DeepSeek — JSON Output](https://api-docs.deepseek.com/guides/json_mode)
- [OpenAI — Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Anthropic — Tool use with Claude](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
- [Google — Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)
