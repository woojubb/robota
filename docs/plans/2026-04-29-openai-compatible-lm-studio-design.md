# OpenAI-Compatible LM Studio Provider Design

## Goal

Enable Robota CLI to use a local LM Studio model through the OpenAI-compatible Chat Completions API. The initial target profile is `providers.openai` with `type: "openai"`, `baseURL: "http://localhost:1234/v1"`, and model `supergemma4-26b-uncensored-v2`.

The implementation must keep `agent-sdk` provider-neutral and keep concrete provider construction in `agent-cli`.

## Architecture

The design introduces provider profiles in settings while keeping the existing legacy `provider` object supported.

```json
{
  "currentProvider": "openai",
  "providers": {
    "openai": {
      "type": "openai",
      "model": "supergemma4-26b-uncensored-v2",
      "apiKey": "lm-studio",
      "baseURL": "http://localhost:1234/v1"
    }
  }
}
```

Resolution order:

1. `currentProvider` plus `providers[currentProvider]`
2. Legacy `provider`
3. Existing defaults

`agent-sdk` owns config parsing and resolved provider metadata. `agent-cli` owns provider construction and maps the resolved provider profile to `AnthropicProvider` or `OpenAIProvider`.

LM Studio is not represented as a native provider. It is an OpenAI-compatible endpoint selected by `baseURL`.

## Data Flow

1. CLI starts and reads provider settings from the configured settings file chain.
2. The active profile is resolved from `currentProvider` and `providers`.
3. For `type: "openai"`, CLI creates `OpenAIProvider` with `apiKey`, `baseURL`, and optional `timeout`.
4. CLI passes the provider to `InteractiveSession`.
5. `InteractiveSession` loads SDK config and uses the same resolved model in session assembly.
6. The execution loop calls `provider.chat(messages, options)`.
7. `OpenAIProvider.chat()` uses Chat Completions.
8. When `options.onTextDelta` is present, `OpenAIProvider.chat()` streams internally, emits text deltas, assembles text and tool-call chunks, and returns the final assistant message.

## Affected Files

- `packages/agent-sdk/docs/SPEC.md`
- `packages/agent-cli/docs/SPEC.md`
- `packages/agent-provider-openai/docs/SPEC.md`
- `packages/agent-sdk/src/config/config-types.ts`
- `packages/agent-sdk/src/config/config-loader.ts`
- `packages/agent-sdk/src/config/*.test.ts`
- `packages/agent-cli/src/utils/provider-factory.ts`
- `packages/agent-cli/src/utils/*.test.ts`
- `packages/agent-cli/package.json`
- `packages/agent-provider-openai/src/provider.ts`
- `packages/agent-provider-openai/src/streaming/*`
- `packages/agent-provider-openai/src/*.test.ts`

## Test Strategy

Use unit tests for config resolution, provider factory behavior, and OpenAI streaming assembly.

- SDK config tests verify active provider profile resolution, `baseURL` preservation, `$ENV:` api key resolution, and legacy `provider` fallback.
- CLI provider factory tests verify `type: "openai"` creates `OpenAIProvider` with LM Studio-compatible options and `type: "anthropic"` keeps existing behavior.
- OpenAI provider tests verify non-streaming regression, streaming text delta assembly, streaming tool-call assembly, and abort signal propagation where the SDK accepts a request option.
- Package verification commands:

```bash
pnpm --filter @robota-sdk/agent-sdk test
pnpm --filter @robota-sdk/agent-provider-openai test
pnpm --filter @robota-sdk/agent-cli test
pnpm --filter @robota-sdk/agent-cli build
pnpm harness:scan
```

Local smoke verification uses LM Studio:

```bash
curl -sS http://localhost:1234/v1/models
curl -sS http://localhost:1234/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"supergemma4-26b-uncensored-v2","messages":[{"role":"user","content":"Say hello in one sentence."}],"max_tokens":32}'
```

## Risks

- `agent-provider-openai` is currently private and non-publishable. Local workspace integration is straightforward, but public CLI publication needs a release-policy decision.
- The CLI currently has its own settings reader while `InteractiveSession` loads config internally. The implementation must keep active provider/model resolution aligned.
- OpenAI-compatible servers vary. The provider must target the common Chat Completions subset used by LM Studio and avoid assuming full OpenAI platform support.
- Streaming tool calls can arrive as partial chunks, so provider-level assembly is required before returning final tool calls to the Robota execution loop.
