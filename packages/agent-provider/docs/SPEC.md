# SPEC: agent-provider

## Overview

The official AI provider implementations of the Robota SDK in one package, one subpath per vendor:
`./anthropic`, `./openai`, `./gemini` (with `./google`, a deprecated alias), `./bytedance`, `./deepseek`,
`./qwen`, `./gemma` and `./builtin`. `./openai-compatible` is the OpenAI wire-protocol base that `./openai`,
`./deepseek`, `./qwen` and `./gemma` share, and that the author of another OpenAI-compatible provider can build on.

The contracts a provider implements (`IAIProvider`, `AbstractAIProvider`, provider definitions and capability
types) stay in `@robota-sdk/agent-core`; this package does not re-export them. A user who needs a provider not
included here implements `IAIProvider` from `@robota-sdk/agent-core` (or extends `AbstractAIProvider`, or builds on
`./openai-compatible`) and registers it directly.

## Contract

- There is no root export. Each vendor is its own subpath, so importing one vendor never loads another vendor's
  code or SDK.
- The vendor SDKs (`openai`, `@anthropic-ai/sdk`, `@google/genai`) are optional peer dependencies: an application
  installs only the SDKs of the providers it imports. `./bytedance` uses a bespoke HTTP client and needs none.
- The package declares `sideEffects: false`. The one import-time effect is deliberate and safe under that flag: a
  Claude model module registers its models with the core registry, and only the code that uses those models imports it.
- Among framework packages this package depends on `@robota-sdk/agent-core` only; `agent-framework`,
  `agent-session` and every higher-layer package must never be imported. A vendor subpath imports no other vendor
  subpath, except that `./openai`, `./deepseek`, `./qwen` and `./gemma` build on `./openai-compatible` and
  `./builtin` composes the others; `./builtin` belongs at a composition root.

## Design decisions

- **One package with subpaths, no facade.** An earlier single package re-exported every vendor from its root and
  hard-depended on all three SDKs, so any importer installed them all and could bundle them all. Separate packages
  fixed that but left the OpenAI protocol base without a parent to hold it. Subpaths plus optional peers keep a
  one-vendor import the size of that vendor, with the shared base in the same package.

## Anthropic (`./anthropic`)

### Overview

Anthropic Claude provider implementation, built on the `@anthropic-ai/sdk`.

### Module ordering

Within the package, the shared source-URL/verification-date constants used by both the provider
definition and the capability table have a single owner module, and the definition re-exports them
rather than the capability table depending on the definition — so importing the definition first as
native ESM cannot read an uninitialized value through that path.

### Diagnostic endpoint

The provider definition declares a diagnostic endpoint (the vendor SDK's embedded host/port), stated
on the agent runtime side purely for the pre-session doctor's TCP reachability check. It is deliberately
**not** the runtime-effective base URL: that field is persisted into created profiles and passed to
provider construction, while the diagnostic endpoint is read by no setup, persistence, or
provider-construction path. A profile that sets its own base URL is probed at that host instead.

### Model Effort

The provider exposes a source-dated effort table only at the vendor endpoint. For a documented model,
a concrete Core effort selection is serialized as a native effort field and merged with an existing
output-format setting; `auto` reports the table default while omitting the native effort field. An
unknown model, or a configured non-default base URL, reports "not applied" and sends no unverified
control. A terminal observer receives exactly one serializable resolution/native-control/dispatch
outcome after success.

### Tool Schema Projection

The provider's schema projection profile is permissive: Anthropic accepts standard JSON Schema with an
`object` root, so no keyword stripping or object closure runs before a tool schema is handed to the
vendor SDK's conversion. A tool whose schema is rejected by projection (a non-`object` root, a
prototype-key property name, a cycle, or a schema over the shared depth/node ceiling) is omitted from
that request alone — every other tool on the turn is unaffected — and is reported once per cache
identity through the shared tool-schema-projection logger. When a call selects `toolChoice: none`,
the provider also omits its configured server-side web search, for both ordinary and streaming
calls, so a server tool cannot still execute when the core passed no local tool schemas.

### Server-side web search

Whether the provider attaches Anthropic's server-side web search is fixed when it is built, from the
profile option the definition declares; nothing enables it afterwards, so a session or a provider swap
cannot change what a provider runs. A malformed option fails at construction, because a misspelled key
that quietly left search off would look like a working configuration.

## OpenAI (`./openai`)

### Overview

The OpenAI provider (`openai` SDK) requests generation policy without hiding returned calls or guaranteeing result validity; callers own call-count and argument validation, and hosts own tool execution. Extra request-body fields a caller supplies are forwarded unchanged and are the caller's to interpret: they can never replace a field the provider writes or one its response parsing depends on, and the provider's own reports (effort outcome, capabilities) describe only what it writes. They belong to the provider's construction, so a configuration that would route them through an executor, whose contract carries no request body, is refused rather than dropped. The OpenAI-compatible protocol base lives in this package, in `./openai-compatible`, and `./openai` imports it directly.

### Design Decisions

#### Diagnostic endpoint vs. runtime base URL

The provider definition states the vendor SDK's default endpoint host/port on the agent runtime side purely for the pre-session doctor's TCP reachability check. This is deliberately kept separate from the runtime-effective base URL (the one persisted into profiles and passed to provider construction): a profile that sets its own base URL is probed at that host instead, not the vendor default.

#### Reasoning effort is verified per-model, not assumed

The framework threads a per-call reasoning-effort selection through chat options. This package owns a source-dated exact-model table and applies native effort control only for the official Responses endpoint against a verified model. `auto` resolves to the documented model default but omits the native effort field entirely. An unknown model, a Chat Completions surface, or a custom base URL is reported `not-applied` and emits no native control — support is never inferred from protocol compatibility alone.

When a selection resolves to `auto`/model-default or `not-applied`, a statically-set native effort field is treated as a conflict and rejected: silently keeping it would send a native control while reporting that none was sent.

#### Tool schema closure runs at the projection seam, not in the converters

Schema rewriting for OpenAI's strict tool mode happens in the provider's projection-profile seam (shared with agent-core's schema projector), not inside the Responses/Chat Completions request converters. The converters only shape an already-projected schema into the wire tool definition.

**Why:** OpenAI strict mode requires every object node (nested included) to carry `additionalProperties: false` and list all its properties in `required`. A Zod-derived schema does not guarantee either by default, so without a closure step, most Zod-defined tools would be rejected once strict mode is enabled.

**The lossy part, stated as a contract guarantee:** strict mode cannot express "optional", so an optional property is forced into `required` and compensated with a nullable union. A forced-optional field and a genuinely nullable one are therefore indistinguishable on the wire — this is a known, accepted limitation, not a bug. The model must supply the key; `null` means "not provided". A handler that needs to distinguish an absent key from an explicit null cannot rely on this provider to preserve that distinction.

Because the rewrite is lossy, it only runs when strict mode is actually being sent. With strict tools off, tool parameter schemas are forwarded as declared, except that a bare array gains `items` and a bare object `properties`: the API refuses those in either mode, and the declared schema still governs local validation.

A tool schema the projector rejects (non-object root, a prototype-key property name, a cycle, or a schema exceeding the shared depth/node ceiling) is dropped from that request alone rather than failing the whole call, and is logged once per cache identity so the omission is auditable.

#### No fabricated capability table

This package declares no per-model capability table for OpenAI, since none has been verified — inventing one would be a fabricated claim. The framework's miss policy already handles this silence correctly: a provider that declares nothing is sent a structured request unchanged.

It does declare whether the configured endpoint is the vendor default, as a boolean rather than a capability-table field, so a provider with no table can still answer that question. This matters because setting a custom base URL also switches the API surface to Chat Completions, which is the surface least likely to honor a structured-output parameter; a structured request through such a gateway is reported with an "unverified endpoint" provenance rather than being claimed as enforced.

#### Log file permissions

The file-based payload logger writes a summary of each Chat Completions request — request metadata, not prompt or response content — to a caller-supplied log directory. It creates that directory and each log file with owner-only permissions rather than inheriting the process umask, since the directory is caller-supplied and the files record the caller's own request history.

#### A searching reply goes back as OpenAI's items, only within its turn

Hosted search results exist only on OpenAI's side, named by a reply's output items, so a reply that searched and called functions is sent back whole on the later requests of its turn that carry the search tool. `previous_response_id` is not used: the conversation held here, which compaction can rewrite, stays what the model is given. Those items belong to the account and model that made them, OpenAI keeps them for a limited time, and it has none for an unstored response, so only the provider instance that recorded a reply sends it back, on the same model, until the next user message, and only on a request that declares the tool, since OpenAI backends are reported to refuse search items otherwise. Everything else is rebuilt from text, because losing the search costs less than failing: a fallback to another model or account, a resumed session and the forced summary must not fail on items they cannot use.

## Gemini (`./gemini` and `./google`)

### Purpose

Google Gemini provider implementation (`@google/genai`), also implementing `IImageGenerationProvider`.
A deprecated `GoogleProvider` compatibility alias is re-exported via the `./google` entry for callers
migrating off the old name.

### Contract

- **Streaming.** `GeminiProvider` preserves every assistant function call and `usageMetadata` value
  returned by Gemini's streaming API. `chatStream()` emits text deltas as they arrive plus a universal
  assistant message for a function-call chunk or a usage-only terminal chunk. When `chat()` uses its
  streaming assembly path (`onTextDelta` set), it returns one complete assistant message assembled from
  all stream chunks.
- Requests containing `nativeWebTools` are validated by both `chat()` and `chatStream()`, so a request
  that requires a hosted tool this provider is not running fails explicitly instead of being silently
  ignored. Google Search is a construction choice and rides only on requests that can carry it: a model
  that cannot search next to function tools keeps the function tools, because an agent's work needs them.
- **Model parts return as they came.** A reply's signed function calls and server-side tool steps reach
  the next request verbatim through the provider continuation, because Gemini refuses a signed call
  without its signature and expects those steps echoed. The steps go wherever the model can run them,
  whatever that request's tools, because a reply with its context cut can be refused. They stay out in
  Vertex mode, where the SDK refuses them, and on a model that cannot combine tools. If the parts no longer say what the
  message says, the message wins and they are rebuilt from it.
- **Model effort.** A verified model selection sends Gemini's `thinkingConfig.thinkingLevel` control,
  preserves unrelated `thinkingConfig` fields, and rejects a conflicting static `thinkingLevel` or
  `thinkingBudget`. `auto` reports the documented default while omitting a control; unknown models and
  unverified routes report `not-applied` rather than inventing a numeric `thinkingBudget` mapping.
- **Tool schema projection.** `GeminiProvider.projectionProfile()` strips foreign JSON-Schema keywords
  and `additionalProperties` before tool schemas reach Gemini's request builder, because Gemini's
  `Schema` type is a fixed OpenAPI-3.0 subset, not standard JSON Schema — a member the builder doesn't
  understand must not fail silently downstream. The builder then avoids what that subset refuses
  although JSON Schema allows it: a null type, which becomes `nullable`, a `required` name with no
  property, and an empty `parameters` or nested `properties`. A tool that projection rejects is omitted from that
  request alone and reported once per cache identity vian agent-core's `ToolSchemaProjection` logger.

### Design decisions

- The provider definition's diagnostic `endpoint` (`generativelanguage.googleapis.com:443`) is stated
  separately from `defaults.baseURL` on purpose: `endpoint` exists only for the pre-session doctor's TCP
  reachability check, while `baseURL` is the runtime-effective value persisted into profiles and passed
  to `createProvider`. A profile with its own `baseURL` is probed at that host instead.

## DeepSeek, Qwen and Gemma, and the OpenAI-compatible protocol base (`./deepseek`, `./qwen`, `./gemma` and `./openai-compatible`)

### Purpose

OpenAI-compatible providers (DeepSeek, Qwen, Gemma) and the shared protocol implementation used by
them and by `./openai` preserve admitted observations, call identity
and host source attribution without treating the wire role of native vision data as contributor
authority.

### Executor delegation

When a DeepSeek, Qwen, or Gemma provider is configured with an executor, the provider unwraps the
executor's non-streaming result and yields only the message stream events. The executor owns the
terminal event and its effort observer; providers do not expose the terminal envelope as a
provider message or invoke the observer a second time.

### Structured output

No adapter in this package reads a native response-format option directly — `deepseek`, `qwen`,
and `gemma` build their requests without it. Structured-output handling lives at the core transport
seam instead: agent-core asks this package's capability table which transport applies and, when no
schema parameter exists, states the schema as a system instruction on the first attempt, so a
structured run against this family does not spend an extra turn finding out the shape. The mapping
lives at the seam that assembles the request rather than being duplicated into three request
builders, so the two answers cannot drift apart.

The capability declarations say what each model really does: DeepSeek's JSON Output mode
guarantees the response parses but takes no schema parameter and enforces no shape, so it is
declared as an unstructured JSON capability rather than a schema-enforcing one. Qwen declares
neither, so its structured requests omit the option entirely rather than sending one to be ignored.

agent-core's bounded validate-and-retry loop remains the guarantee: the returned object matches the
schema or it throws.

### Tool schema projection

`gemma`, `qwen`, and `deepseek` each use the same permissive tool-schema profile from
`@robota-sdk/agent-core`, differing only in provider name — every sibling in this family accepts
standard JSON Schema, so no keyword stripping or object closure runs. Each provider projects tools
before handing options to the shared request builder, so the request that builder sees always
already carries projected tools; Qwen's Responses surface (live when built-in web tools are on)
projects the same way before building its own request. Qwen's Responses surface also omits its
configured server-side web search/extractor tools whenever a call selects `toolChoice: none`, for
both direct and streaming responses, so a text-only call cannot acquire hosted web actions merely
because the provider instance has them enabled.

A tool schema the projector rejects is omitted from that request alone and reported once per cache
identity via a dedicated log line on agent-core's global-sink schema-projection logger — audible
even though these providers construct with a silent logger by default.

## ByteDance (`./bytedance`)

### Purpose

Bytedance (ModelArk) video-generation provider implementing `IVideoGenerationProvider`. Uses a bespoke HTTP client — no vendor SDK.

### Contract

- Implements `IVideoGenerationProvider` from `@robota-sdk/agent-core`.

## Built-in definitions (`./builtin`)

### Purpose

Composition leaf that aggregates the built-in provider definitions a host composes: the chat
provider definitions, the media provider definitions (image and video generation), and a default
per-role model map (`DEFAULT_ROLE_MODELS`) — an app-workflow opinion that the neutral role-model
contract in `agent-core` deliberately does not embed. Video generation is a media provider, so the
chat definitions leave it out.
