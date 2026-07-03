---
title: Providers Reference
description: All supported AI providers, their configuration options, and how to swap between them.
---

# Providers Reference

All providers implement the same `IAIProvider` interface. You can pass any provider to
`Robota`, `createQuery`, or `createAgentRuntime` — the calling code never needs to change.

> **Swap with zero code changes.** The only thing you change when switching providers is
> which provider object you construct and pass in. All agent logic, tools, and session
> handling remain identical.

---

## Provider Overview

Each provider is a **protocol client**, not a model-vendor lock: it speaks an API surface, and any
endpoint speaking that surface works via `baseURL` — AI gateways (Vercel AI Gateway, LiteLLM,
OpenRouter), Azure, vLLM, Ollama, LM Studio. Model slugs pass through verbatim, so routing
`anthropic/claude-*` or `meta-llama/*` through an OpenAI-protocol gateway is a one-line config.

| Provider                  | Import path                            | API surface it speaks                                                           | Auth method                       |
| ------------------------- | -------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------- |
| OpenAI                    | `@robota-sdk/agent-provider/openai`    | OpenAI API — official or ANY compatible endpoint (gateways, Azure, vLLM, local) | `OPENAI_API_KEY` (or gateway key) |
| Anthropic                 | `@robota-sdk/agent-provider/anthropic` | Anthropic Messages API                                                          | `ANTHROPIC_API_KEY`               |
| Gemini                    | `@robota-sdk/agent-provider/gemini`    | Google GenAI API                                                                | `GEMINI_API_KEY`                  |
| DeepSeek                  | `@robota-sdk/agent-provider/deepseek`  | OpenAI-compatible (DeepSeek endpoint default)                                   | `DEEPSEEK_API_KEY`                |
| Qwen (Alibaba)            | `@robota-sdk/agent-provider/qwen`      | OpenAI-compatible (DashScope endpoint default)                                  | `DASHSCOPE_API_KEY`               |
| Gemma / OpenAI-compatible | `@robota-sdk/agent-provider/gemma`     | OpenAI-compatible (bring your own endpoint)                                     | varies                            |

> **AI gateways (Vercel AI Gateway, LiteLLM, OpenRouter):** Use the `OpenAIProvider` with the
> gateway's `baseURL` and a gateway model slug — see [Through an AI gateway](#through-an-ai-gateway).
>
> **Local models (Ollama, LM Studio, llama.cpp):** Use the `GemmaProvider` with a custom
> `baseURL`. See [Local LLM Setup](./local-llm.md) for a step-by-step guide.

---

## Anthropic

Claude models. Best for long-context tasks, code generation, and nuanced reasoning.

### Install

```bash
npm install @robota-sdk/agent-provider @anthropic-ai/sdk
```

### Basic usage

```typescript
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});
```

### Configuration options

| Option     | Type        | Required                       | Description                                                    |
| ---------- | ----------- | ------------------------------ | -------------------------------------------------------------- |
| `apiKey`   | `string`    | Yes (unless `client` provided) | Anthropic API key                                              |
| `client`   | `Anthropic` | No                             | Pre-built Anthropic SDK client                                 |
| `baseURL`  | `string`    | No                             | Any Anthropic-Messages-API-compatible endpoint (proxy/gateway) |
| `timeout`  | `number`    | No                             | Request timeout in milliseconds                                |
| `executor` | `IExecutor` | No                             | Remote or local executor override                              |

### With a pre-built client

<!-- doc-example-skip: imports the external `@anthropic-ai/sdk` package, which consumers install themselves -->

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxRetries: 3,
});

const provider = new AnthropicProvider({ client });
```

---

## OpenAI

The OpenAI **protocol** client. Official OpenAI models (GPT and o-series) with native JSON mode,
structured outputs, and the Responses API — and, via `baseURL`, any OpenAI-compatible endpoint:
AI gateways, Azure OpenAI, vLLM, Ollama, LM Studio.

### Install

```bash
npm install @robota-sdk/agent-provider openai
```

### Basic usage

```typescript
import { OpenAIProvider } from '@robota-sdk/agent-provider/openai';

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
});
```

### Configuration options

| Option           | Type                                       | Required                       | Description                                                                                   |
| ---------------- | ------------------------------------------ | ------------------------------ | --------------------------------------------------------------------------------------------- |
| `apiKey`         | `string`                                   | Yes (unless `client` provided) | OpenAI API key                                                                                |
| `client`         | `OpenAI`                                   | No                             | Pre-built OpenAI SDK client                                                                   |
| `organization`   | `string`                                   | No                             | OpenAI organization ID                                                                        |
| `baseURL`        | `string`                                   | No                             | Any OpenAI-compatible endpoint — gateways, Azure, vLLM, local                                 |
| `timeout`        | `number`                                   | No                             | Request timeout in milliseconds                                                               |
| `apiSurface`     | `'responses' \| 'chat-completions'`        | No                             | API surface to use (default: `responses` for OpenAI, `chat-completions` for custom endpoints) |
| `responseFormat` | `'text' \| 'json_object' \| 'json_schema'` | No                             | Response format                                                                               |
| `reasoning`      | `IOpenAIResponsesReasoningOptions`         | No                             | Reasoning effort for o-series models                                                          |
| `strictTools`    | `boolean`                                  | No                             | Enable strict function parameter validation                                                   |
| `executor`       | `IExecutor`                                | No                             | Remote or local executor override                                                             |

### Through an AI gateway

Point `baseURL` at any OpenAI-compatible gateway and use the gateway's model slug — non-OpenAI
models route through the same provider. Streaming and tool calling work unchanged; the slug is
passed to the endpoint verbatim.

```typescript
import { OpenAIProvider } from '@robota-sdk/agent-provider/openai';

// Vercel AI Gateway serving an Anthropic model
const provider = new OpenAIProvider({
  apiKey: process.env.AI_GATEWAY_API_KEY!,
  baseURL: 'https://ai-gateway.vercel.sh/v1',
  defaultModel: 'anthropic/claude-sonnet-4-5',
});
```

The same pattern covers LiteLLM (`http://localhost:4000/v1`), OpenRouter
(`https://openrouter.ai/api/v1`), and Azure OpenAI deployments. Setting `baseURL` switches the
default `apiSurface` to `chat-completions` for endpoint compatibility.

### JSON output

```typescript
import { OpenAIProvider } from '@robota-sdk/agent-provider/openai';

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  responseFormat: 'json_object',
});
```

### o-series reasoning

```typescript
import { OpenAIProvider } from '@robota-sdk/agent-provider/openai';

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  reasoning: { effort: 'high', summary: 'auto' },
});
```

---

## Gemini

Google's Gemini models. Supports image generation, thinking mode, and native
multimodal inputs.

### Install

```bash
npm install @robota-sdk/agent-provider @google/genai
```

### Basic usage

```typescript
import { GeminiProvider } from '@robota-sdk/agent-provider/gemini';

const provider = new GeminiProvider({
  apiKey: process.env.GEMINI_API_KEY!,
});
```

### Configuration options

| Option             | Type                                 | Required | Description                       |
| ------------------ | ------------------------------------ | -------- | --------------------------------- |
| `apiKey`           | `string`                             | Yes      | Google AI API key                 |
| `defaultModel`     | `string`                             | No       | Default model name                |
| `responseMimeType` | `'text/plain' \| 'application/json'` | No       | Response format                   |
| `thinkingConfig`   | `IGeminiThinkingConfig`              | No       | Thinking mode settings            |
| `safetySettings`   | `IGeminiSafetySetting[]`             | No       | Per-category safety thresholds    |
| `executor`         | `IExecutor`                          | No       | Remote or local executor override |

### Thinking mode

```typescript
import { GeminiProvider } from '@robota-sdk/agent-provider/gemini';
import type { IGeminiThinkingConfig } from '@robota-sdk/agent-provider/gemini';

const thinkingConfig: IGeminiThinkingConfig = {
  includeThoughts: true,
  thinkingBudget: 8192,
};

const provider = new GeminiProvider({
  apiKey: process.env.GEMINI_API_KEY!,
  thinkingConfig,
});
```

---

## DeepSeek

DeepSeek models including the R-series reasoning models. Uses the OpenAI-compatible
API under the hood.

### Install

```bash
npm install @robota-sdk/agent-provider openai
```

### Basic usage

```typescript
import { DeepSeekProvider } from '@robota-sdk/agent-provider/deepseek';

const provider = new DeepSeekProvider({
  apiKey: process.env.DEEPSEEK_API_KEY!,
});
```

### Configuration options

| Option            | Type                                              | Required                       | Description                                     |
| ----------------- | ------------------------------------------------- | ------------------------------ | ----------------------------------------------- |
| `apiKey`          | `string`                                          | Yes (unless `client` provided) | DeepSeek API key                                |
| `client`          | `OpenAI`                                          | No                             | Pre-built OpenAI SDK client pointed at DeepSeek |
| `baseURL`         | `string`                                          | No                             | Default: `https://api.deepseek.com`             |
| `defaultModel`    | `string`                                          | No                             | Default: `deepseek-v4-flash`                    |
| `thinking`        | `'enabled' \| 'disabled'`                         | No                             | Enable extended thinking                        |
| `reasoningEffort` | `'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'` | No                             | Reasoning depth                                 |
| `timeout`         | `number`                                          | No                             | Request timeout in milliseconds                 |
| `executor`        | `IExecutor`                                       | No                             | Remote or local executor override               |

### Reasoning model with extended thinking

```typescript
import { DeepSeekProvider } from '@robota-sdk/agent-provider/deepseek';

const provider = new DeepSeekProvider({
  apiKey: process.env.DEEPSEEK_API_KEY!,
  thinking: 'enabled',
  reasoningEffort: 'high',
});
```

---

## Qwen (Alibaba Cloud)

Alibaba's Qwen models, accessed via DashScope. Supports built-in web search and
web extraction tools.

### Install

```bash
npm install @robota-sdk/agent-provider openai
```

### Basic usage

```typescript
import { QwenProvider } from '@robota-sdk/agent-provider/qwen';

const provider = new QwenProvider({
  apiKey: process.env.DASHSCOPE_API_KEY!,
});
```

### Configuration options

| Option            | Type                          | Required                       | Description                               |
| ----------------- | ----------------------------- | ------------------------------ | ----------------------------------------- |
| `apiKey`          | `string`                      | Yes (unless `client` provided) | DashScope API key                         |
| `baseURL`         | `string`                      | No                             | Regional endpoint (see below)             |
| `defaultModel`    | `string`                      | No                             | Default: `qwen-plus`                      |
| `builtInWebTools` | `IQwenBuiltInWebToolsOptions` | No                             | Enable Qwen-native web search / web fetch |
| `timeout`         | `number`                      | No                             | Request timeout in milliseconds           |
| `executor`        | `IExecutor`                   | No                             | Remote or local executor override         |

### Regional endpoints

DashScope has region-specific endpoints. The default is Singapore
(`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`). For other regions:

```typescript
import { QwenProvider } from '@robota-sdk/agent-provider/qwen';
import { QWEN_PROVIDER_BASE_URLS } from '@robota-sdk/agent-provider/qwen';

const provider = new QwenProvider({
  apiKey: process.env.DASHSCOPE_API_KEY!,
  baseURL: QWEN_PROVIDER_BASE_URLS.usVirginia,
});
```

### Native web tools

```typescript
import { QwenProvider } from '@robota-sdk/agent-provider/qwen';

const provider = new QwenProvider({
  apiKey: process.env.DASHSCOPE_API_KEY!,
  builtInWebTools: { webSearch: true, webFetch: true },
});
```

---

## Gemma / OpenAI-Compatible

A generic OpenAI-compatible provider. Use this for:

- **Gemma** models via Google AI
- **Ollama** (local)
- **LM Studio** (local)
- **llama.cpp** server
- Any other endpoint that implements the OpenAI Chat Completions API

### Install

```bash
npm install @robota-sdk/agent-provider openai
```

### Basic usage

```typescript
import { GemmaProvider } from '@robota-sdk/agent-provider/gemma';

const provider = new GemmaProvider({
  apiKey: 'any-value', // many local servers do not validate this
  baseURL: 'http://localhost:11434/v1', // Ollama default
  defaultModel: 'llama3.2',
});
```

### Configuration options

| Option         | Type        | Required | Description                                                           |
| -------------- | ----------- | -------- | --------------------------------------------------------------------- |
| `apiKey`       | `string`    | No       | API key (required by the SDK but not validated by most local servers) |
| `baseURL`      | `string`    | No       | Server URL including `/v1` path                                       |
| `defaultModel` | `string`    | No       | Model name as recognised by the server                                |
| `timeout`      | `number`    | No       | Request timeout in milliseconds                                       |
| `client`       | `OpenAI`    | No       | Pre-built OpenAI SDK client                                           |
| `executor`     | `IExecutor` | No       | Remote or local executor override                                     |

### LM Studio

```typescript
import { GemmaProvider } from '@robota-sdk/agent-provider/gemma';

const provider = new GemmaProvider({
  apiKey: 'lm-studio',
  baseURL: 'http://localhost:1234/v1',
  defaultModel: 'gemma-3-12b', // match name shown in LM Studio Local Server tab
});
```

See the [Local LLM Setup guide](./local-llm.md) for Ollama, LM Studio, and
llama.cpp configuration details.

---

## Switching Providers

Because all providers implement `IAIProvider`, switching is a one-line change:

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';
import { OpenAIProvider } from '@robota-sdk/agent-provider/openai';
import { GeminiProvider } from '@robota-sdk/agent-provider/gemini';

// Register multiple providers — agent picks the right one from defaultModel.provider
const agent = new Robota({
  name: 'MultiProviderAgent',
  aiProviders: [
    new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
    new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! }),
    new GeminiProvider({ apiKey: process.env.GEMINI_API_KEY! }),
  ],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
  },
  systemMessage: 'You are a helpful assistant.',
});

// Use default provider
const r1 = await agent.run('Summarise this document.');

// Switch provider and model at runtime — no other code changes needed
agent.setModel({ provider: 'openai', model: 'gpt-4o' });
const r2 = await agent.run('Now translate that summary to French.');

// Switch to Gemini
agent.setModel({ provider: 'gemini', model: 'gemini-2.0-flash' });
const r3 = await agent.run('Rate the translation quality.');
```

The same pattern works with `createQuery` and `createAgentRuntime` — simply pass
a different provider object at construction time.

---

## Related

- [Local LLM Setup](./local-llm.md) — run models locally with Ollama or LM Studio
- [Getting Started](../getting-started/README.md) — first agent in 5 lines
- [Embedding agent-framework](./embedding.md) — server, bot, and serverless patterns
