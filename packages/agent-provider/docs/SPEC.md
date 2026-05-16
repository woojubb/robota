# SPEC: agent-provider

## Overview

Consolidated package for all official AI provider implementations. Replaces the nine separate `agent-provider-*` packages with a single package that exports all providers via sub-path exports.

Users who need a provider not included here can implement `IAIProvider` from `@robota-sdk/agent-core` and register it directly.

## Package Identity

- **npm name**: `@robota-sdk/agent-provider`
- **Layer**: Layer 1 (depends on `agent-core` only; never imports from `agent-framework`, `agent-session`, `agent-tools`, `agent-command`, or `agent-transport`)
- **Platform**: node + browser

## Public API

### Root export (`@robota-sdk/agent-provider`)

Re-exports all provider classes and factory functions for convenience.

### Sub-path exports

| Sub-path           | Entry                         | Description                                     |
| ------------------ | ----------------------------- | ----------------------------------------------- |
| `./anthropic`      | `src/anthropic/index.ts`      | Anthropic Claude provider                       |
| `./openai`         | `src/openai/index.ts`         | OpenAI provider                                 |
| `./openai/loggers` | `src/openai/loggers/index.ts` | OpenAI payload loggers (file, console)          |
| `./deepseek`       | `src/deepseek/index.ts`       | DeepSeek provider                               |
| `./gemini`         | `src/gemini/index.ts`         | Google Gemini provider                          |
| `./google`         | `src/google/index.ts`         | Compatibility alias for `./gemini` (deprecated) |
| `./gemma`          | `src/gemma/index.ts`          | Gemma / local-model provider                    |
| `./bytedance`      | `src/bytedance/index.ts`      | Bytedance provider (internal)                   |
| `./qwen`           | `src/qwen/index.ts`           | Qwen provider                                   |

### Internal (not exported)

`src/shared/openai-compatible/` contains the OpenAI-compatible protocol implementation used by openai, deepseek, gemma, and qwen sub-modules. It is not a public export.

## Source Structure

```
src/
├── index.ts                        # Re-exports all providers
├── anthropic/                      # Anthropic Claude implementation
├── openai/                         # OpenAI implementation (incl. loggers/)
├── deepseek/                       # DeepSeek implementation
├── gemini/                         # Google Gemini implementation
├── google/                         # Compatibility re-export of gemini (deprecated)
├── gemma/                          # Gemma / local-model implementation
├── bytedance/                      # Bytedance implementation
├── qwen/                           # Qwen implementation
└── shared/
    └── openai-compatible/          # Internal: OpenAI-compatible protocol
```

## Circular Dependency Policy

- This package depends on `@robota-sdk/agent-core` only.
- No sub-module may import from a sibling sub-module **except**:
  - Any sub-module may import from `shared/openai-compatible/`.
  - `google/` imports from `gemini/` (intentional: compatibility re-export, no cycle).
- `agent-framework`, `agent-session`, and all higher-layer packages must never be imported.

## Extension Contract

Custom providers must implement `IAIProvider` from `@robota-sdk/agent-core`:

```ts
import type { IAIProvider } from '@robota-sdk/agent-core';

export class MyProvider implements IAIProvider {
  // ...
}
```

Custom providers do not need to depend on `@robota-sdk/agent-provider`.

## Dependencies

| Package                  | Role                                                                  |
| ------------------------ | --------------------------------------------------------------------- |
| `@robota-sdk/agent-core` | `IAIProvider`, `IProviderDefinition`, hook types                      |
| `@anthropic-ai/sdk`      | Anthropic API client                                                  |
| `openai`                 | OpenAI SDK (used by openai, openai-compatible, deepseek, gemma, qwen) |
| `@google/genai`          | Google GenAI SDK (used by gemini)                                     |

## Build Output Contract

```
dist/
├── node/
│   ├── index.js / index.cjs / index.d.ts     # root export
│   ├── anthropic/index.js …                  # per-provider sub-paths
│   ├── openai/index.js …
│   ├── deepseek/index.js …
│   ├── gemini/index.js …
│   ├── google/index.js …
│   ├── gemma/index.js …
│   ├── bytedance/index.js …
│   └── qwen/index.js …
├── loggers/
│   ├── file.js / file.cjs / file.d.ts
│   └── console.js / console.cjs / console.d.ts
└── browser/
    └── index.js / index.d.ts                 # ESM-only, browser platform
```
