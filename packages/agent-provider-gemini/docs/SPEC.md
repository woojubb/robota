# SPEC: agent-provider-gemini

## Purpose

Google Gemini provider implementation (`@google/genai`), also implementing `IImageGenerationProvider`.
A deprecated `GoogleProvider` compatibility alias is re-exported via the `./google` entry for callers
migrating off the old name.

Users who need a provider not included here can implement `IAIProvider` from `@robota-sdk/agent-core`
and register it directly.

## Contract

- **Streaming.** `GeminiProvider` preserves every assistant function call and `usageMetadata` value
  returned by Gemini's streaming API. `chatStream()` emits text deltas as they arrive plus a universal
  assistant message for a function-call chunk or a usage-only terminal chunk. When `chat()` uses its
  streaming assembly path (`onTextDelta` set), it returns one complete assistant message assembled from
  all stream chunks.
- Requests containing `nativeWebTools` are validated by both `chat()` and `chatStream()`. Gemini does
  not advertise native web tools, so such a request fails explicitly instead of being silently ignored.
- **Model effort.** A verified model selection sends Gemini's `thinkingConfig.thinkingLevel` control,
  preserves unrelated `thinkingConfig` fields, and rejects a conflicting static `thinkingLevel` or
  `thinkingBudget`. `auto` reports the documented default while omitting a control; unknown models and
  unverified routes report `not-applied` rather than inventing a numeric `thinkingBudget` mapping.
- **Tool schema projection.** `GeminiProvider.projectionProfile()` strips foreign JSON-Schema keywords
  and `additionalProperties` before tool schemas reach Gemini's request builder, because Gemini's
  `Schema` type is a fixed OpenAPI-3.0 subset, not standard JSON Schema — a member the builder doesn't
  understand must not fail silently downstream. A tool that projection rejects is omitted from that
  request alone and reported once per cache identity via agent-core's `ToolSchemaProjection` logger.

## Non-goals

- Does not depend on `agent-framework`, `agent-session`, or any higher-layer package — only
  `@robota-sdk/agent-core` and its own vendor SDK.

## Design decisions

- The provider definition's diagnostic `endpoint` (`generativelanguage.googleapis.com:443`) is stated
  separately from `defaults.baseURL` on purpose: `endpoint` exists only for the pre-session doctor's TCP
  reachability check, while `baseURL` is the runtime-effective value persisted into profiles and passed
  to `createProvider`. A profile with its own `baseURL` is probed at that host instead.
