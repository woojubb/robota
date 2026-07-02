# Agent Provider

Consolidated package for all official AI provider implementations in the Robota SDK.

## Installation

```bash
npm install @robota-sdk/agent-provider
```

## Available Providers

Providers are protocol clients, not model-vendor locks: each one speaks an API surface, and any
endpoint that speaks the same surface works via `baseURL` — AI gateways (Vercel AI Gateway,
LiteLLM, OpenRouter), Azure, vLLM, Ollama, LM Studio. Gateway model slugs (e.g.
`anthropic/claude-*` through an OpenAI-protocol gateway) pass through verbatim.

| Provider  | Sub-path      | API surface it speaks                                                                                                                   |
| --------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI    | `./openai`    | OpenAI API (Responses + Chat Completions) — official OpenAI or ANY OpenAI-compatible endpoint: gateways, Azure, vLLM, Ollama, LM Studio |
| Anthropic | `./anthropic` | Anthropic Messages API (Claude models; Messages-compatible proxies via `baseURL`)                                                       |
| Google    | `./gemini`    | Google GenAI API (Gemini models)                                                                                                        |
| DeepSeek  | `./deepseek`  | OpenAI-compatible (DeepSeek endpoint by default; any compatible endpoint via `baseURL`)                                                 |
| Qwen      | `./qwen`      | OpenAI-compatible (DashScope endpoint by default; any compatible endpoint via `baseURL`)                                                |
| Gemma     | `./gemma`     | OpenAI-compatible (bring your own endpoint — local or hosted)                                                                           |
| Bytedance | `./bytedance` | OpenAI-compatible (Doubao/Ark endpoint by default)                                                                                      |

## Quick Start

```typescript
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';
import { Robota } from '@robota-sdk/agent-core';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });

const agent = new Robota({
  name: 'MyAgent',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
});
```

## Provider Examples

### OpenAI

```typescript
import { OpenAIProvider } from '@robota-sdk/agent-provider/openai';

const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });
```

### AI Gateway / any OpenAI-compatible endpoint

Set `baseURL` on the OpenAI provider to route through a gateway or a self-hosted server. Non-OpenAI
model slugs pass through verbatim; streaming and tool calling work over the same protocol.

```typescript
import { OpenAIProvider } from '@robota-sdk/agent-provider/openai';

const provider = new OpenAIProvider({
  apiKey: process.env.AI_GATEWAY_API_KEY,
  baseURL: 'https://ai-gateway.vercel.sh/v1',
  defaultModel: 'anthropic/claude-sonnet-4-5',
});
```

### DeepSeek

```typescript
import { DeepSeekProvider } from '@robota-sdk/agent-provider/deepseek';

const provider = new DeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY });
```

### Google Gemini

```typescript
import { GeminiProvider } from '@robota-sdk/agent-provider/gemini';

const provider = new GeminiProvider({ apiKey: process.env.GOOGLE_API_KEY ?? '' });
```

### Local / OpenAI-compatible

```typescript
import { GemmaProvider } from '@robota-sdk/agent-provider/gemma';

const provider = new GemmaProvider({
  baseURL: 'http://localhost:11434/v1',
  defaultModel: 'gemma3',
});
```

## Root Export

All providers are available from the root entry point for convenience:

```typescript
import { AnthropicProvider, OpenAIProvider } from '@robota-sdk/agent-provider';
```

Use sub-path imports in production to enable tree-shaking.

## Dependencies

- `@robota-sdk/agent-core` — `IAIProvider` interface and core types

## Links

- [npm](https://www.npmjs.com/package/@robota-sdk/agent-provider)
- [GitHub](https://github.com/woojubb/robota)
