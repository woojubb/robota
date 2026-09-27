---
title: Providers Reference
description: All supported AI providers, their configuration options, and how to swap between them.
---

# Providers Reference

Every chat provider implements the same `IAIProvider` interface from `@robota-sdk/agent-core`.
You can pass any of them to `Robota`, `createQuery()` or `createAgentRuntime()`, and the calling code
does not change.

> **Swap with zero code changes.** The only thing you change when switching providers is
> which provider object you construct and pass in. All agent logic, tools, and session
> handling remain identical.

---

## Provider Overview

Each provider is a **protocol client**, not a model-vendor lock: it speaks an API surface, and any
endpoint speaking that surface works via `baseURL` — AI gateways (Vercel AI Gateway, LiteLLM,
OpenRouter), Azure, vLLM, Ollama, LM Studio. Model slugs pass through verbatim, so routing
`anthropic/claude-*` or `meta-llama/*` through an OpenAI-protocol gateway is a one-line config.

| Provider                  | Import path                                    | API surface it speaks                                                           | Auth method                       |
| ------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------- |
| OpenAI                    | `@robota-sdk/agent-provider-openai`            | OpenAI API — official or ANY compatible endpoint (gateways, Azure, vLLM, local) | `OPENAI_API_KEY` (or gateway key) |
| Anthropic                 | `@robota-sdk/agent-provider-anthropic`         | Anthropic Messages API                                                          | `ANTHROPIC_API_KEY`               |
| Gemini                    | `@robota-sdk/agent-provider-gemini`            | Google GenAI API                                                                | `GEMINI_API_KEY`                  |
| DeepSeek                  | `@robota-sdk/agent-provider-openai-compatible` | OpenAI-compatible (DeepSeek endpoint default)                                   | `DEEPSEEK_API_KEY`                |
| Qwen (Alibaba)            | `@robota-sdk/agent-provider-openai-compatible` | OpenAI-compatible (DashScope endpoint default)                                  | `DASHSCOPE_API_KEY`               |
| Gemma / OpenAI-compatible | `@robota-sdk/agent-provider-openai-compatible` | OpenAI-compatible (bring your own endpoint)                                     | none for local servers            |

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
npm install @robota-sdk/agent-provider-anthropic
```

The package depends on the Anthropic SDK itself; install `@anthropic-ai/sdk` in your project only if
you build the client yourself (below).

### Basic usage

```typescript
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

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
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

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
npm install @robota-sdk/agent-provider-openai
```

### Basic usage

```typescript
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
});
```

### Configuration options

| Option                      | Type                                       | Required                       | Description                                                                                          |
| --------------------------- | ------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `apiKey`                    | `string`                                   | Yes (unless `client` provided) | OpenAI API key                                                                                       |
| `client`                    | `OpenAI`                                   | No                             | Pre-built OpenAI SDK client                                                                          |
| `organization`              | `string`                                   | No                             | OpenAI organization ID                                                                               |
| `baseURL`                   | `string`                                   | No                             | Any OpenAI-compatible endpoint — gateways, Azure, vLLM, local                                        |
| `defaultModel`              | `string`                                   | No                             | Model used when a request names none                                                                 |
| `timeout`                   | `number`                                   | No                             | Request timeout in milliseconds                                                                      |
| `apiSurface`                | `'responses' \| 'chat-completions'`        | No                             | API surface (default: `responses` for OpenAI, `chat-completions` when `baseURL` is set)              |
| `responseFormat`            | `'text' \| 'json_object' \| 'json_schema'` | No                             | Response format                                                                                      |
| `jsonSchema`                | `IOpenAIJsonSchemaDefinition`              | No                             | Schema for `responseFormat: 'json_schema'`                                                           |
| `reasoning`                 | `IOpenAIResponsesReasoningOptions`         | No                             | Reasoning `effort` and `summary` for reasoning models (Responses API)                                |
| `store`                     | `boolean`                                  | No                             | Whether OpenAI stores Responses API results                                                          |
| `includeEncryptedReasoning` | `boolean`                                  | No                             | Include encrypted reasoning items for stateless continuation                                         |
| `strictTools`               | `boolean`                                  | No                             | Strict function-parameter validation (rewrites tool schemas for strict mode)                         |
| `nativeWebTools`            | `IOpenAINativeWebToolsOptions`             | No                             | OpenAI's hosted `webSearch` / `webFetch` tools (not available on custom endpoints)                   |
| `includeStreamUsage`        | `boolean`                                  | No                             | Request token usage on streaming turns (default `true`; turn off for endpoints that reject it)       |
| `payloadLogger`             | `IPayloadLogger`                           | No                             | Receives a summary of each Chat Completions request (loggers in `.../agent-provider-openai/loggers`) |
| `executor`                  | `IExecutor`                                | No                             | Remote or local executor override                                                                    |
| `logger`                    | `ILogger`                                  | No                             | Internal logger (default: silent)                                                                    |

### Through an AI gateway

Point `baseURL` at any OpenAI-compatible gateway and use the gateway's model slug — non-OpenAI
models route through the same provider. Streaming and tool calling work unchanged; the slug is
passed to the endpoint verbatim.

```typescript
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

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
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  responseFormat: 'json_object',
});
```

### o-series reasoning

```typescript
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

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
npm install @robota-sdk/agent-provider-gemini
```

### Basic usage

```typescript
import { GeminiProvider } from '@robota-sdk/agent-provider-gemini';

const provider = new GeminiProvider({
  apiKey: process.env.GEMINI_API_KEY!,
});
```

### Configuration options

| Option                      | Type                                 | Required | Description                                                     |
| --------------------------- | ------------------------------------ | -------- | --------------------------------------------------------------- |
| `apiKey`                    | `string`                             | Yes      | Google AI API key                                               |
| `defaultModel`              | `string`                             | No       | Model used when a request names none                            |
| `responseMimeType`          | `'text/plain' \| 'application/json'` | No       | Response format                                                 |
| `responseSchema`            | object                               | No       | Schema for JSON output                                          |
| `responseJsonSchema`        | object                               | No       | JSON Schema for structured output (instead of `responseSchema`) |
| `thinkingConfig`            | `IGeminiThinkingConfig`              | No       | Thinking mode settings                                          |
| `safetySettings`            | `IGeminiSafetySetting[]`             | No       | Per-category safety thresholds                                  |
| `toolConfig`                | object                               | No       | Function-calling config passed to Gemini                        |
| `defaultResponseModalities` | `Array<'TEXT' \| 'IMAGE'>`           | No       | Default response modalities, e.g. text and image                |
| `imageCapableModels`        | `string[]`                           | No       | Models allowed to return images; others are refused             |
| `executor`                  | `IExecutor`                          | No       | Remote or local executor override                               |

### Thinking mode

```typescript
import { GeminiProvider } from '@robota-sdk/agent-provider-gemini';
import type { IGeminiThinkingConfig } from '@robota-sdk/agent-provider-gemini';

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
npm install @robota-sdk/agent-provider-openai-compatible
```

### Basic usage

```typescript
import { DeepSeekProvider } from '@robota-sdk/agent-provider-openai-compatible';

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
| `logger`          | `ILogger`                                         | No                             | Internal logger                                 |

### Reasoning model with extended thinking

```typescript
import { DeepSeekProvider } from '@robota-sdk/agent-provider-openai-compatible';

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
npm install @robota-sdk/agent-provider-openai-compatible
```

### Basic usage

```typescript
import { QwenProvider } from '@robota-sdk/agent-provider-openai-compatible';

const provider = new QwenProvider({
  apiKey: process.env.DASHSCOPE_API_KEY!,
});
```

### Configuration options

| Option             | Type                          | Required                       | Description                                       |
| ------------------ | ----------------------------- | ------------------------------ | ------------------------------------------------- |
| `apiKey`           | `string`                      | Yes (unless `client` provided) | DashScope API key                                 |
| `client`           | `OpenAI`                      | No                             | Pre-built OpenAI SDK client pointed at DashScope  |
| `baseURL`          | `string`                      | No                             | Regional endpoint (see below)                     |
| `responsesBaseURL` | `string`                      | No                             | Endpoint for DashScope's Responses-compatible API |
| `defaultModel`     | `string`                      | No                             | Default: `qwen-plus`                              |
| `builtInWebTools`  | `IQwenBuiltInWebToolsOptions` | No                             | Qwen-native web search / web fetch                |
| `timeout`          | `number`                      | No                             | Request timeout in milliseconds                   |
| `executor`         | `IExecutor`                   | No                             | Remote or local executor override                 |
| `logger`           | `ILogger`                     | No                             | Internal logger                                   |

### Regional endpoints

DashScope has region-specific endpoints. The default is Singapore
(`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`). `QWEN_PROVIDER_BASE_URLS` holds the
endpoints for `singapore`, `usVirginia`, `beijing` and `hongKong`:

```typescript
import { QwenProvider } from '@robota-sdk/agent-provider-openai-compatible';
import { QWEN_PROVIDER_BASE_URLS } from '@robota-sdk/agent-provider-openai-compatible';

const provider = new QwenProvider({
  apiKey: process.env.DASHSCOPE_API_KEY!,
  baseURL: QWEN_PROVIDER_BASE_URLS.usVirginia,
});
```

### Native web tools

```typescript
import { QwenProvider } from '@robota-sdk/agent-provider-openai-compatible';

const provider = new QwenProvider({
  apiKey: process.env.DASHSCOPE_API_KEY!,
  builtInWebTools: { webSearch: true, webFetch: true },
});
```

---

## Gemma / OpenAI-Compatible

A generic OpenAI-compatible provider. Use it for:

- **Ollama**, **LM Studio** and the **llama.cpp** server (local)
- Any other endpoint that implements the OpenAI Chat Completions API

In the `robota` CLI this is the provider type `gemma`, listed in setup as
"Ollama / LM Studio / llama.cpp"; its setup defaults are LM Studio's `http://localhost:1234/v1` and
the placeholder key `lm-studio`.

### Install

```bash
npm install @robota-sdk/agent-provider-openai-compatible
```

### Basic usage

```typescript
import { GemmaProvider } from '@robota-sdk/agent-provider-openai-compatible';

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
| `logger`       | `ILogger`   | No       | Internal logger                                                       |

### LM Studio

```typescript
import { GemmaProvider } from '@robota-sdk/agent-provider-openai-compatible';

const provider = new GemmaProvider({
  apiKey: 'lm-studio',
  baseURL: 'http://localhost:1234/v1',
  defaultModel: 'gemma-3-12b', // the model name LM Studio shows for the loaded model
});
```

See the [Local LLM Setup guide](./local-llm.md) for Ollama, LM Studio, and
llama.cpp configuration details.

---

## Other provider packages

- **`@robota-sdk/agent-provider-bytedance`** — `BytedanceProvider`, a video-generation provider for
  ByteDance ModelArk (Seedance). It implements `IVideoGenerationProvider` (`createVideo`,
  `getVideoJob`, `cancelVideoJob`) rather than the chat `IAIProvider`, so it is not an agent's chat
  model.
- **`@robota-sdk/agent-builtin-providers`** — `createDefaultProviderDefinitions()`, the provider
  definitions (setup steps, defaults, model catalogs) the `robota` CLI offers for `anthropic`,
  `openai`, `gemini`, `gemma`, `qwen` and `deepseek`. Use it when your own host wants the same
  settings-driven provider selection.

---

## Switching Providers

Because all providers implement `IAIProvider`, switching is a one-line change:

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';
import { GeminiProvider } from '@robota-sdk/agent-provider-gemini';

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

- [Local LLM Setup](./local-llm.md) — run models locally with Ollama, LM Studio or llama.cpp
- [Getting Started](../getting-started/README.md) — your first agent
- [Embedding agent-framework](./embedding.md) — server, bot, and serverless patterns
