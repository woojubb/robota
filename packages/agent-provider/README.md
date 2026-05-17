# Agent Provider

Consolidated package for all official AI provider implementations in the Robota SDK.

## Installation

```bash
npm install @robota-sdk/agent-provider
```

## Available Providers

| Provider  | Sub-path      | Models                              |
| --------- | ------------- | ----------------------------------- |
| Anthropic | `./anthropic` | Claude 3.5, Claude 4.x              |
| OpenAI    | `./openai`    | GPT-4o, GPT-4, o1, o3               |
| DeepSeek  | `./deepseek`  | DeepSeek-V3, DeepSeek-R1            |
| Google    | `./gemini`    | Gemini 2.0, Gemini 1.5              |
| Gemma     | `./gemma`     | Gemma 3 (local / OpenAI-compatible) |
| Qwen      | `./qwen`      | Qwen 2.5, QwQ                       |
| Bytedance | `./bytedance` | Doubao                              |

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

### DeepSeek

```typescript
import { DeepSeekProvider } from '@robota-sdk/agent-provider/deepseek';

const provider = new DeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY });
```

### Google Gemini

```typescript
import { GeminiProvider } from '@robota-sdk/agent-provider/gemini';

const provider = new GeminiProvider({ apiKey: process.env.GOOGLE_API_KEY });
```

### Local / OpenAI-compatible

```typescript
import { GemmaProvider } from '@robota-sdk/agent-provider/gemma';

const provider = new GemmaProvider({ baseUrl: 'http://localhost:11434/v1', model: 'gemma3' });
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
