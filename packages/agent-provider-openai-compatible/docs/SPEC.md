# SPEC: agent-provider-openai-compatible

## Purpose

OpenAI-compatible providers (DeepSeek, Qwen, Gemma) plus the shared OpenAI-compatible protocol
implementation used by them and by `@robota-sdk/agent-provider-openai`. Users who need a provider
not included here can implement `IAIProvider` from `@robota-sdk/agent-core` and register it
directly.

## Boundary

This package depends on `@robota-sdk/agent-core` only among framework packages (plus its one
vendor SDK where applicable). `agent-framework`, `agent-session`, and all higher-layer packages
must never be imported.

## Executor delegation

When a DeepSeek, Qwen, or Gemma provider is configured with an executor, the provider unwraps the
executor's non-streaming result and yields only the message stream events. The executor owns the
terminal event and its effort observer; providers do not expose the terminal envelope as a
provider message or invoke the observer a second time.

## Structured output

No adapter in this package reads a native response-format option directly — `deepseek`, `qwen`,
and `gemma` build their requests without it. Historically this meant a structured run against this
family carried no schema signal on the first attempt at all, costing at least one extra turn by
construction. Structured-output handling was moved to the core transport seam: agent-core now asks
this package's capability table which transport applies and, when no schema parameter exists,
states the schema as a system instruction on the first attempt. The mapping lives at the seam that
assembles the request rather than being duplicated into three request builders, so the two answers
cannot drift apart.

The capability declarations were corrected as part of that change: DeepSeek's JSON Output mode
guarantees the response parses but takes no schema parameter and enforces no shape, so it is
declared as an unstructured JSON capability rather than a schema-enforcing one. Qwen declares
neither, so its structured requests omit the option entirely rather than sending one to be ignored.

agent-core's bounded validate-and-retry loop remains the guarantee: the returned object matches the
schema or it throws.

## Tool schema projection

`gemma`, `qwen`, and `deepseek` each use the same permissive tool-schema profile from
`@robota-sdk/agent-core`, differing only in provider name — every sibling in this family accepts
standard JSON Schema, so no keyword stripping or object closure runs. Each provider projects tools
before handing options to the shared request builder, so the request that builder sees always
already carries projected tools; Qwen's Responses surface (live when built-in web tools are on)
projects the same way before building its own request.

A tool schema the projector rejects is omitted from that request alone and reported once per cache
identity via a dedicated log line on agent-core's global-sink schema-projection logger — audible
even though these providers construct with a silent logger by default.
