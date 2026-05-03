# OpenAI-Compatible Web Capabilities Design

## Goal

Make provider-native web search/fetch capability explicit for OpenAI-compatible profiles such as LM Studio. Robota must not silently assume a local OpenAI-compatible endpoint can execute hosted search/fetch tools, and users must get an early, actionable error when they configure a native web feature the selected provider cannot supply.

## Prior Art Research

- LM Studio OpenAI compatibility documents `/v1/models`, `/v1/responses`, `/v1/chat/completions`, `/v1/embeddings`, and `/v1/completions`, and explains that clients can point their OpenAI base URL at LM Studio. It does not document provider-native web search/fetch tools for the OpenAI-compatible endpoint. Source: <https://lmstudio.ai/docs/developer/openai-compat>
- LM Studio's REST API comparison says OpenAI-compatible `/v1/responses` and `/v1/chat/completions` support custom tools, while MCP support is limited to `/api/v1/chat` and `/v1/responses`; `/v1/chat/completions` does not expose MCP. Source: <https://lmstudio.ai/docs/developer/rest>
- LM Studio tool-use docs describe function definitions in `tools`, model-generated tool calls, and caller-side execution of those functions. They state that models output text that LM Studio parses into OpenAI-compliant tool calls; the caller executes the tool and sends the result back. Source: <https://lmstudio.ai/docs/developer/openai-compat/tools>
- OpenAI official docs describe web search as a hosted tool in the Responses API and, for Chat Completions, as available only through specialized search models or search-specific parameters. Source: <https://platform.openai.com/docs/guides/tools-web-search>
- Existing Robota code has provider-owned hosted web paths for Anthropic (`enableWebTools`) and Qwen (`builtInWebTools`) plus Robota local tools `WebSearch` and `WebFetch`. The provider-neutral system prompt must not hardcode provider-specific web behavior.

## Recommendation

Implement a provider-neutral capability contract in `agent-core` and use it from provider/session code:

- `IAIProvider.getCapabilities()` returns function-calling support and native web tool support/enabled state.
- `IAIProvider.configureNativeWebTools()` is an optional provider hook. `agent-sessions` can call it without branching on provider names; Anthropic implements it to preserve current automatic server web search behavior.
- OpenAI-compatible Chat Completions paths report native web search/fetch as unsupported. If a profile tries to enable `builtInWebTools`/`nativeWebTools`, provider creation fails before a model request is sent.
- Qwen and Anthropic continue to own their provider-native web semantics. Qwen remains opt-in through `builtInWebTools`; Anthropic remains session-enabled through `configureNativeWebTools({ webSearch: true })`.
- Robota local `WebSearch` and `WebFetch` stay separate function tools and are the recommended path for LM Studio/OpenAI-compatible local servers.

This avoids hidden fallback behavior. Routing search/fetch through local Robota tools is possible only when the local tools are explicitly registered as ordinary function tools; the provider must not pretend that those are provider-native hosted tools.

## Architecture

### Data Flow

1. CLI resolves the active provider profile and passes the provider-owned `options` bag through the existing provider definition contract.
2. Provider definitions parse only their own options. OpenAI parses `builtInWebTools`/`nativeWebTools` only to reject unsupported native web configuration for OpenAI-compatible endpoints.
3. `agent-sessions` configures provider-native web tools through the optional `configureNativeWebTools()` hook instead of checking provider names.
4. `Session.run()` logs native web capability state from `getProviderCapabilities()` so diagnostics can distinguish supported/enabled/unsupported providers.
5. Providers validate request-level `IChatOptions.nativeWebTools` before transport execution. Unsupported or disabled native web requests fail before streaming starts.

### Affected Files

- `packages/agent-core/src/interfaces/provider.ts`
- `packages/agent-core/src/abstracts/abstract-ai-provider.ts`
- `packages/agent-core/src/index.ts`
- `packages/agent-core/docs/SPEC.md`
- `packages/agent-provider-anthropic/src/provider.ts`
- `packages/agent-provider-anthropic/docs/SPEC.md`
- `packages/agent-provider-qwen/src/provider.ts`
- `packages/agent-provider-qwen/docs/SPEC.md`
- `packages/agent-provider-openai/src/types.ts`
- `packages/agent-provider-openai/src/provider.ts`
- `packages/agent-provider-openai/src/provider-definition.ts`
- `packages/agent-provider-openai/docs/SPEC.md`
- `packages/agent-provider-gemma/src/provider.ts`
- `packages/agent-provider-gemma/docs/SPEC.md`
- `packages/agent-sessions/src/session-lifecycle.ts`
- `packages/agent-sessions/src/session-run.ts`
- `packages/agent-sessions/docs/SPEC.md`
- `packages/agent-sdk/src/assembly/create-tools.ts`
- `packages/agent-sdk/docs/SPEC.md`
- `packages/agent-cli/docs/SPEC.md`
- `content/guide/context-management.md`
- `content/guide/building-agents.md`

## Test Strategy

Use TDD around the contract and provider behavior. First add failing tests for default provider capabilities in `agent-core`, Anthropic generic session configuration, Qwen enabled/disabled capability state, and OpenAI profile rejection when LM Studio/OpenAI-compatible `baseURL` is configured with native web options. Then implement the provider contract and validation. Verification commands: targeted tests for `agent-core`, `agent-provider-anthropic`, `agent-provider-qwen`, `agent-provider-openai`, and `agent-sessions`; targeted typecheck/lint/build for the same packages; `pnpm docs:build`; root `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm harness:scan`.
