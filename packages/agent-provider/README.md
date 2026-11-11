# @robota-sdk/agent-provider

The official AI provider implementations of the Robota SDK, one subpath per vendor. Every provider implements
`IAIProvider` from [`@robota-sdk/agent-core`](../agent-core/README.md), so swapping providers changes only which
object you construct.

## Install

```bash
npm install @robota-sdk/agent-provider @robota-sdk/agent-core
```

The vendor SDKs are optional peer dependencies (`@anthropic-ai/sdk` `^0.114.0`, `@google/genai` `^1.52.0`,
`openai` `^6.0.0`). Install the ones for the providers you import:

| Import path                                    | Provider                                           | Install alongside     |
| ---------------------------------------------- | -------------------------------------------------- | --------------------- |
| `@robota-sdk/agent-provider/anthropic`         | Anthropic Claude                                   | `@anthropic-ai/sdk`   |
| `@robota-sdk/agent-provider/openai`            | OpenAI, and any OpenAI-compatible endpoint         | `openai`              |
| `@robota-sdk/agent-provider/gemini`            | Google Gemini (`/google` is a compatibility alias) | `@google/genai`       |
| `@robota-sdk/agent-provider/deepseek`          | DeepSeek                                           | `openai`              |
| `@robota-sdk/agent-provider/qwen`              | Qwen (Alibaba DashScope)                           | `openai`              |
| `@robota-sdk/agent-provider/gemma`             | Gemma and local OpenAI-compatible servers          | `openai`              |
| `@robota-sdk/agent-provider/bytedance`         | ByteDance ModelArk video generation                | nothing               |
| `@robota-sdk/agent-provider/openai-compatible` | OpenAI wire-protocol base for your own provider    | `openai`              |
| `@robota-sdk/agent-provider/builtin`           | Default provider definitions for an application    | all three vendor SDKs |
| `@robota-sdk/agent-provider/openai/loggers`    | Console payload logger (any runtime)               | nothing               |
| `@robota-sdk/agent-provider/openai/node`       | File payload logger (Node only)                    | nothing               |

```typescript
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });
```

## What a bundle contains

There is no root entry. A subpath loads only that vendor's code and its SDK, so importing
`@robota-sdk/agent-provider/openai` does not bring in the Anthropic or Gemini code. The package declares
`sideEffects: false` so a bundler can also drop the exports you do not use. `./builtin` imports every provider and
belongs at an application's composition root.

## Writing your own provider

- Implement `IAIProvider`, or extend `AbstractAIProvider`, from `@robota-sdk/agent-core`. Provider definitions and
  capability types are there too. This package does not re-export them.
- For an OpenAI-compatible endpoint, build on `@robota-sdk/agent-provider/openai-compatible`: the message converter,
  request builder, response parser and stream assembler that `openai`, `deepseek`, `qwen` and `gemma` share.

## Documentation

- [docs/README.md](docs/README.md): index
- [docs/SPEC.md](docs/SPEC.md): the contract and design decisions
- Per provider: [Anthropic](docs/anthropic.md), [OpenAI](docs/openai.md), [Gemini](docs/gemini.md),
  [DeepSeek, Qwen, Gemma and the OpenAI-compatible base](docs/openai-compatible.md),
  [ByteDance](docs/bytedance.md), [built-in definitions](docs/builtin.md)

## License

Dual-licensed under AGPL-3.0-only or a commercial license; see [LICENSE](../../LICENSE),
[LICENSING.md](../../LICENSING.md) and [COMMERCIAL.md](../../COMMERCIAL.md).
