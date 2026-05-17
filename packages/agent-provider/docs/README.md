# @robota-sdk/agent-provider

Consolidated package for all official AI provider implementations (Anthropic, OpenAI,
OpenAI-compatible, DeepSeek, Gemma, Qwen, Gemini, Google, ByteDance). Providers are available
via sub-path exports to keep unused providers out of the bundle.

## Usage

```typescript
import { createAnthropicProvider } from '@robota-sdk/agent-provider/anthropic';
import { createOpenAIProvider } from '@robota-sdk/agent-provider/openai';
```

## Documents

- [SPEC.md](./SPEC.md) — package contract, sub-path API, and ownership boundaries.
