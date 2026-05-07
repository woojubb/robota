# Provider Credential Setup Audit

## Status

Completed on 2026-05-07.

## Recommendation Applied

Use one generic credential field, `apiKey`, for normal provider setup and profile storage.

Anthropic's normal API documentation requires an `x-api-key` header with an Anthropic API key. Claude
Code/LiteLLM guidance can use `ANTHROPIC_AUTH_TOKEN`, but that belongs to Claude Code/gateway
configuration rather than Robota's first-run Anthropic API provider profile. Exposing it in generic
Robota setup made users likely to paste Claude Code setup tokens into the Anthropic API profile.

Sources:

- <https://docs.anthropic.com/en/api/overview>
- <https://docs.anthropic.com/en/docs/claude-code/llm-gateway>

## Completed Changes

- [x] Removed `authToken` from generic provider config/profile/default contracts.
- [x] Removed `authToken` and `authTokenEnv` from provider setup input, setup flow output, SDK config
      loading, CLI provider factory, settings checks, and background provider profile handoff.
- [x] Changed Anthropic provider definition to `requiresApiKey: true`.
- [x] Added Anthropic's default API key reference, `$ENV:ANTHROPIC_API_KEY`, to provider-owned
      setup metadata.
- [x] Removed direct `authToken` construction from `AnthropicProvider`; advanced auth can still use
      a pre-configured Anthropic SDK client.
- [x] Updated active SDK/CLI/core/provider docs and `content/guide/sdk.md`.
- [x] Audited current first-class provider setup definitions:
      OpenAI, Anthropic, Gemini, Qwen, Gemma, and ByteDance all use API-key based normal setup.
- [x] Left DeepSeek planning aligned with API-key only setup.

## Verification

- [x] `pnpm install`
- [x] `pnpm build`
- [x] `pnpm --filter @robota-sdk/agent-provider-anthropic test`
- [x] `pnpm --filter @robota-sdk/agent-core test -- provider-definition`
- [x] `pnpm --filter @robota-sdk/agent-sdk test -- config-loader provider`
- [x] `pnpm --filter @robota-sdk/agent-cli test -- provider`
- [x] `pnpm --filter @robota-sdk/agent-core typecheck`
- [x] `pnpm --filter @robota-sdk/agent-sdk typecheck`
- [x] `pnpm --filter @robota-sdk/agent-cli typecheck`
- [x] `pnpm --filter @robota-sdk/agent-provider-anthropic lint` (existing warnings only)
- [x] `pnpm --filter @robota-sdk/agent-core lint` (existing warnings only)
- [x] `pnpm --filter @robota-sdk/agent-sdk lint` (existing warnings only)
- [x] `pnpm --filter @robota-sdk/agent-cli lint` (existing warnings only)
- [x] `pnpm --filter @robota-sdk/agent-runtime lint`
- [x] `pnpm run typecheck`
- [x] `pnpm run lint` (existing warnings only)
- [x] `pnpm run test`
