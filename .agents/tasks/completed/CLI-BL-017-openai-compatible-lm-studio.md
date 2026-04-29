# CLI OpenAI-Compatible LM Studio Provider

- **Status**: completed
- **Created**: 2026-04-29
- **Branch**: feat/openai-compatible-lm-studio
- **Scope**: packages/agent-cli, packages/agent-sdk, packages/agent-provider-openai

## Objective

Add Robota CLI support for an OpenAI-compatible provider profile that can connect to LM Studio through the `/v1/chat/completions` API. The initial target is a local LM Studio server at `http://localhost:1234/v1` using the model `supergemma4-26b-uncensored-v2`.

This work must keep provider creation in the CLI, keep session assembly provider-neutral, and reuse the existing `OpenAIProvider` rather than introducing an LM Studio native provider.

## Current Findings

- LM Studio exposes an OpenAI-compatible API under `http://localhost:1234/v1`.
- Local smoke checks succeeded for:
  - `GET /v1/models`
  - `POST /v1/chat/completions`
  - `stream: true` server-sent event streaming
  - OpenAI-style `tools` / function calling
- The local LM Studio model `supergemma4-26b-uncensored-v2` successfully returned text responses and tool calls.
- Robota CLI currently supports only the Anthropic provider in `packages/agent-cli/src/utils/provider-factory.ts`.
- `OpenAIProvider` already supports `baseURL`, non-streaming chat completions, tool calls, and `chatStream()`.
- `OpenAIProvider.chat()` is behind `AnthropicProvider.chat()` for CLI parity because it does not use `options.onTextDelta` and does not assemble streamed tool-call deltas.
- `agent-provider-openai` is currently `private: true` and marked non-publishable in `.agents/publish-registry.md`, which affects public CLI packaging.

## Target Configuration

Use provider profiles plus an active provider key:

```json
{
  "currentProvider": "openai",
  "providers": {
    "openai": {
      "type": "openai",
      "model": "supergemma4-26b-uncensored-v2",
      "apiKey": "lm-studio",
      "baseURL": "http://localhost:1234/v1"
    },
    "anthropic": {
      "type": "anthropic",
      "model": "claude-sonnet-4-6",
      "apiKey": "$ENV:ANTHROPIC_API_KEY"
    }
  }
}
```

Legacy settings must continue to work during the migration:

```json
{
  "provider": {
    "name": "anthropic",
    "model": "claude-sonnet-4-6",
    "apiKey": "$ENV:ANTHROPIC_API_KEY"
  }
}
```

Provider resolution order:

1. `currentProvider` plus `providers[currentProvider]`
2. Legacy `provider`
3. Existing defaults

## Design Decisions

- Use `providers.openai` and `type: "openai"` for LM Studio because the transport is OpenAI-compatible, not LM Studio native.
- Treat LM Studio as a `baseURL` override for `OpenAIProvider`.
- Do not use LM Studio native `/api/v1/*` APIs.
- Do not use LM Studio Anthropic compatibility.
- Do not migrate to OpenAI Responses API for this work. Chat Completions is the correct compatibility layer for LM Studio.
- Keep `lmstudio` out of the first schema unless a preset UX is added later.
- Keep legacy `provider` support to avoid breaking existing Anthropic CLI users.

## Plan

- [x] Update package specs before code changes.
  - [x] `packages/agent-cli/docs/SPEC.md`: document provider profile selection and OpenAI-compatible provider creation.
  - [x] `packages/agent-sdk/docs/SPEC.md`: document `currentProvider`, `providers`, and resolved provider profile fields.
  - [x] `packages/agent-provider-openai/docs/SPEC.md`: document CLI-oriented OpenAI-compatible usage and streaming parity expectations if provider behavior changes.
- [x] Extend SDK config schema and resolution.
  - [x] Add `currentProvider?: string`.
  - [x] Add `providers?: Record<string, ProviderProfile>`.
  - [x] Add provider profile fields: `type`, `model`, `apiKey`, `baseURL`, optional `timeout`.
  - [x] Preserve legacy `provider` support.
  - [x] Ensure `IResolvedConfig.provider` resolves to the active profile with `name`, `model`, `apiKey`, and `baseURL`.
  - [x] Add tests for active provider resolution and legacy fallback.
- [x] Update CLI provider factory.
  - [x] Read the active provider profile from the same settings chain.
  - [x] Support `type: "anthropic"` with existing `AnthropicProvider`.
  - [x] Support `type: "openai"` with `OpenAIProvider`.
  - [x] Pass `apiKey`, `baseURL`, `timeout`, and model defaults correctly.
  - [x] Add tests for the LM Studio OpenAI-compatible profile.
- [x] Decide the package dependency path for `agent-provider-openai`.
  - [x] For local development, add it as a workspace dependency of `agent-cli`.
  - [x] Document the public publishing risk for the `private: true` / publish registry conflict.
- [x] Modernize `OpenAIProvider` only as much as needed for CLI parity.
  - [x] Keep the existing non-streaming `chat()` path as a fallback.
  - [x] When `options.onTextDelta` is present, use streaming internally and return an assembled final `TUniversalMessage`.
  - [x] Accumulate `delta.content` and call `onTextDelta` for text chunks.
  - [x] Accumulate streamed `tool_calls` by index and return final tool calls.
  - [x] Pass `AbortSignal` into OpenAI SDK requests where supported.
  - [x] Add tests for text streaming, tool-call streaming assembly, abort behavior, and non-streaming regression.
- [x] Add local smoke verification notes.
  - [x] Confirm LM Studio server is running.
  - [x] Confirm `GET http://localhost:1234/v1/models` includes `supergemma4-26b-uncensored-v2`.
  - [x] Run a chat completion request.
  - [x] Run a tool-calling request.
  - [x] Run `robota` with the OpenAI-compatible profile.

## Test Strategy

Targeted commands:

```bash
pnpm --filter @robota-sdk/agent-sdk test
pnpm --filter @robota-sdk/agent-provider-openai test
pnpm --filter @robota-sdk/agent-cli test
pnpm --filter @robota-sdk/agent-cli build
pnpm harness:scan
```

Local smoke commands:

```bash
curl -sS http://localhost:1234/v1/models
curl -sS http://localhost:1234/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"supergemma4-26b-uncensored-v2","messages":[{"role":"user","content":"Say hello in one sentence."}],"max_tokens":32}'
```

## Risks

- `agent-provider-openai` is private and not currently approved for publishing. Adding it to a published CLI package needs a release-policy decision before npm publication.
- The CLI and SDK both currently read config in different places. Provider profile resolution must stay behaviorally aligned or the CLI provider and SDK `defaultModel` can drift.
- Streaming tool-call chunks from OpenAI-compatible servers may arrive as partial arguments. The provider must assemble them before returning final tool calls.
- LM Studio model availability is local state. The CLI should surface provider errors clearly when the server is down or the model is not loaded.
- OpenAI-compatible implementations vary. The first implementation should be tested against LM Studio and avoid assuming full OpenAI API coverage.

## Open Questions

- Should `baseURL` support `$ENV:` substitution, or should env substitution remain limited to `apiKey` for now?
- Should `timeout` be part of the first provider profile schema?
- Should `providers.openai` be the only supported OpenAI-compatible profile key, or should arbitrary keys with `type: "openai"` be allowed?
- Should public CLI packaging make `agent-provider-openai` publishable, or should a smaller public OpenAI-compatible provider package be introduced later?

## Progress

### 2026-04-29

- Researched LM Studio OpenAI-compatible behavior with the local server.
- Verified `supergemma4-26b-uncensored-v2` can produce text responses and OpenAI-style tool calls.
- Compared `AnthropicProvider` and `OpenAIProvider` implementation gaps.
- Chose the provider profile shape using `providers.openai` and `type: "openai"`.
- Created this implementation plan.
- Updated package SPECs, READMEs, and current guide docs for provider profiles and OpenAI-compatible LM Studio configuration.
- Added SDK config support for `currentProvider` plus `providers`, including deep profile merge, `$ENV:` API key resolution, `baseURL`, `timeout`, and legacy `provider` fallback.
- Added CLI provider creation for `type: "openai"` using `OpenAIProvider`; Anthropic provider creation remains supported.
- Added first-run settings detection for active provider profiles so local OpenAI-compatible profiles do not trigger the Anthropic setup prompt.
- Aligned first-run settings detection with the same `.robota` and `.claude` settings paths used by provider resolution.
- Added OpenAIProvider streaming assembly for `chat()` when `onTextDelta` is provided, including streamed tool-call reconstruction and abort signal propagation.
- Added tests for SDK provider profile resolution, CLI provider factory behavior, first-run settings detection, and OpenAIProvider streaming assembly.
- Verified LM Studio local model discovery, chat completions, tool calling, and CLI print mode with `supergemma4-26b-uncensored-v2`.

## Blockers

- No implementation blocker for local development.
- Public publishing requires a decision on `agent-provider-openai` package status.

## Result

Implemented.

Verification completed:

- `pnpm --filter @robota-sdk/agent-sdk test`
- `pnpm --filter @robota-sdk/agent-sdk typecheck`
- `pnpm --filter @robota-sdk/agent-sdk build`
- `pnpm --filter @robota-sdk/agent-sdk lint` (exit 0; existing warnings remain)
- `pnpm --filter @robota-sdk/agent-provider-openai test -- src/provider.test.ts`
- `pnpm --filter @robota-sdk/agent-provider-openai typecheck`
- `pnpm --filter @robota-sdk/agent-provider-openai build`
- `pnpm --filter @robota-sdk/agent-provider-openai lint` (exit 0; existing warnings remain)
- `pnpm --filter @robota-sdk/agent-cli test`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
- `pnpm --filter @robota-sdk/agent-cli build`
- `pnpm --filter @robota-sdk/agent-cli lint` (exit 0; existing warnings remain)
- `pnpm build` in `apps/docs`
- `pnpm harness:scan`
- Local LM Studio smoke: `curl /v1/models`, chat completion, streaming, tool-call request, and built CLI print mode returned `CLI_SMOKE_OK`.
