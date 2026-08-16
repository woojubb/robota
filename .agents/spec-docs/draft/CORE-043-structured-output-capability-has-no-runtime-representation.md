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

### 5. The endpoint override lands in this change, not later

`'unverified-endpoint'` for every `baseURL` reverses a **correct** behaviour for a large documented
population: `llms.txt:22` names Azure, vLLM, Ollama and LM Studio alongside gateways, and Azure OpenAI
and vLLM do honour `response_format: json_schema`. For those users today's early enforcement is right,
and routing them to an extra-round fallback is a regression.

The first draft deferred the caller-side declaration to "a later override". That is the half-measure
`code-quality.md:50` forbids, applied to the mitigation instead of the fix: the override is what makes
the behaviour change safe, so it ships with it.

### 6. What the fallback actually emits — the previously "resolved" question, reopened

The first draft closed its gating question by citing Anthropic's `strict: true` and OpenAI's strict
function calling. **Those citations do not apply to either family that takes the fallback.** Under the
capability table, anthropic and gemini answer `response_schema` and never reach it. The two that do:

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
= await executeRound(…); if (shouldBreak) break; }` (`execution-pipeline.ts:67-83`). It ends
    because the model came back with text and no tool calls. `buildChatResponseFormat` runs _inside_
    the round, before the provider call, where the only decidable predicate is
    `currentRound === maxRounds` — budget exhaustion, which on the happy path never fires. A
    "force when round is last" implementation would force the schema tool essentially never.
  - **The structurally final call bypasses the seam.** `forceSummaryCall`
    (`execution-pipeline.ts:120-168`) builds its own options — `{ model, onTextDelta? }` and nothing
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

`forceSummaryCall` (`execution-pipeline.ts:120-168`) is already a pipeline-owned terminal provider call
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
filtered list (`execution-pipeline.ts:170-183`). Taking it as the structural sibling inherits that
tension.

**The extraction call is therefore out-of-band.** Its request and its raw tool-call response are not
committed; what is committed is a normal assistant **text** message carrying the converted JSON —
exactly the response text TC-04b already defines. History stays valid for every provider, no unpaired
tool call is ever persisted, and "every attempt is a real conversation turn" still holds, because the
attempt's turn is that assistant text. Nothing is edited, so `SPEC:987` is **satisfied rather than
worked around** — which is also why the same clause's tension with `forceSummaryCall` is recorded here
rather than copied.

**And that call is cheaper than the retry it displaces.** An attempt is a whole run, not a call:
`maxAttempts = (options.outputRetries ?? 2) + 1` and each attempt calls `robotaRun`
(`robota-execution.ts:202-208`), which runs the entire round loop with full history. So on the compat
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
supporting it, and leaves `agent-provider-openai`-through-a-gateway still misreporting. A strict subset
of this design; can land first as a step, not as the fix.

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

Five rounds with `proposal-reviewer`, 2026-08-16. All five returned **`REVIEW VERDICT: REVISE`**;
all were accepted in full, and in every round each load-bearing finding was independently
re-checked against the code before revising. No finding was refuted in any round.

**Round 3** (on the second revision) settled steps 1–6 — the discovery/capability split, the miss
policy, mechanism/provenance, the required model argument, the eight-producer enumeration, the
weakened fallback claim — and blocked on one thing: the new owner for injection.

| Round-3 finding                                                                  | Re-checked at                                       | Disposition                                                      |
| -------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| `robotaRunStructured` cannot learn its own trigger — no capability on the result | `execution-types.ts:150-161`                        | Fixed — step 4b                                                  |
| It cannot add a tool: the list comes from the ToolManager, not config            | `execution-service-helpers.ts:105`                  | Fixed — owner moved                                              |
| Mutating it via `registerTool`/`unregisterTool` is agent-global — a race         | `core/robota.ts:324,327`                            | Fixed — owner moved                                              |
| The document's own Problem is not closed by its own solution                     | Problem § vs. the seam decision                     | Fixed — step 4b                                                  |
| Steps 4 and 7 asserted opposite things about the same function                   | the two paragraphs                                  | Fixed — step 7 reconciles them                                   |
| Unconditional extraction charges the lucky path for nothing                      | `validateStructuredText`, `robota-execution.ts:209` | Fixed — conditional; TC-05b                                      |
| An attempt is a whole RUN, so extraction is cheaper than the retry it replaces   | `robota-execution.ts:202-208`                       | Adopted — the premise is stronger than claimed; stated in step 7 |
| A static table just relocates staleness unless its purpose changes               | DeepSeek stamped `2026-05-07`, wrong throughout     | Fixed — deviations-not-enumeration, in step 1                    |

The reviewer's correction on cost is worth keeping visible: this design's fallback was defended as
merely acceptable overhead, and it is in fact **cheaper** than what it displaces, because each retry
attempt is a full round loop and the extraction is one call.

**Rounds 1 and 2** are below. Round 2 (on the first revision):
the code before revising. No finding was refuted.

**Round 5** (on the fourth revision) confirmed the design's shape as final — the reviewer stated it
would approve steps 1–6, the pipeline ownership, the predicate's placement, the carrier decision and
the outcome framing as written — and blocked on three narrow points. Two were the ones this author had
flagged; the third neither party had looked at, and it is the most serious finding of all five rounds.

| Round-5 finding                                                                                   | Re-checked at                                                                              | Disposition                                            |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| **The extraction leaves an unpaired `tool_use` in history — the next provider call is a 400**     | `SPEC.md:986-987`; `anthropic/message-converter.ts:63-74`; `execution-pipeline.ts:170-183` | Fixed — out-of-band rule, TC-07b                       |
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
| "Force on the final call, the seam knows which" — undecidable; the seam runs mid-round | `execution-pipeline.ts:67-83`                                    | Fixed — step 7 moves injection to a run-level terminal phase |
| The structurally final call bypasses the seam and carries no schema on any provider    | `execution-pipeline.ts:150-168` — `{ model, onTextDelta? }` only | Fixed — absorbed as an existing defect, TC-06b               |
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

## Completion Criteria (draft)

- **TC-01** Given provider _P_ and model _M_, the emitted request carries or omits the schema exactly
  as the resolved capability says — asserted on the request, not on the presence of a type member.
  (The first draft's "the member exists and the resolver returns it" was a compile-time tautology.)
- **TC-02** `agent-provider-openai` resolves `provenance: 'vendor-default'` without a `baseURL` and
  `'unverified-endpoint'` with one; a test pins both, and a third pins the step-5 override restoring
  `response_schema` for a declared Azure/vLLM endpoint.
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
- **TC-04b** The extraction call's tool `arguments` become the response text the validator sees. A
  run whose extraction succeeds returns the object, not `''` — the conversion step 7 names, pinned,
  because without it the whole mechanism yields nothing.
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
- **TC-07b** After a structured run that used the extraction transport, the conversation contains **no
  assistant message with an unanswered tool call**, and a subsequent turn on the same conversation
  succeeds. This is the criterion that catches the 400 a naive implementation would ship — pinned on
  a provider whose converter emits `tool_use` blocks, so the failure is reproducible rather than
  theoretical.
- **TC-07c** A validation failure on attempt _n_ causes attempt _n+1_ to use the extraction transport
  on a non-native provider **unconditionally**, without re-consulting the structural predicate — the
  subset-vs-Zod divergence, pinned with a schema whose constraints live outside the universal subset
  (`z.string().email()` is the canonical case).
- **TC-08** PROV-006 is closed: all six `TProviderModelCapability` flags resolve through the step-1
  seam, and the deepseek `supportsTools()`-vs-catalog contradiction is gone as a consequence rather
  than as a separate fix.

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
| finality is posterior to the round call             | `execution-pipeline.ts:67-83` — loop ends on `executeRound`'s `shouldBreak`                                                                                                                 |
| the terminal call bypasses the emission seam        | `execution-pipeline.ts:120-168` — `forceSummaryCall` builds `{ model, onTextDelta? }` only                                                                                                  |
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
