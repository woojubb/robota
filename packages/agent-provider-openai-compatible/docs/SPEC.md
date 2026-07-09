# SPEC: agent-provider-openai-compatible

## Overview

OpenAI-compatible providers (DeepSeek, Qwen, Gemma) plus the shared OpenAI-compatible protocol implementation used by them and by `@robota-sdk/agent-provider-openai`.

Users who need a provider not included here can implement `IAIProvider` from `@robota-sdk/agent-core` and register it directly.

## Package Identity

- **npm name**: `@robota-sdk/agent-provider-openai-compatible`
- **Layer**: Layer 1 (depends on `agent-core` only among framework packages; never imports from `agent-framework`, `agent-session`, `agent-tools`, `agent-command`, or `agent-transport`)
- **SDK**: `openai`
- **Platform**: node

## Public API

Every runtime export of the package entry (`src/index.ts`). Provider option/config **types** are also exported (see `src/**/types.ts`); consult the source for the full type surface.

| Symbol                                        |
| --------------------------------------------- |
| `DeepSeekProvider`                            |
| `QwenProvider`                                |
| `GemmaProvider`                               |
| `createDeepSeekProviderDefinition`            |
| `createQwenProviderDefinition`                |
| `createGemmaProviderDefinition`               |
| `refreshDeepSeekModelCatalog`                 |
| `refreshQwenModelCatalog`                     |
| `GemmaReasoningProjector`                     |
| `GemmaToolCallProjector`                      |
| `createGemmaToolCallProjector`                |
| `projectGemmaReasoningText`                   |
| `projectGemmaToolCallText`                    |
| `DEEPSEEK_DEPRECATED_ALIAS_RETIREMENT_DATE`   |
| `DEEPSEEK_MODEL_CATALOG_SOURCE_URL`           |
| `DEEPSEEK_MODEL_LAST_VERIFIED_AT`             |
| `DEEPSEEK_MODEL_LIST_SOURCE_URL`              |
| `DEFAULT_DEEPSEEK_PROVIDER_API_KEY_ENV`       |
| `DEFAULT_DEEPSEEK_PROVIDER_API_KEY_REFERENCE` |
| `DEFAULT_DEEPSEEK_PROVIDER_BASE_URL`          |
| `DEFAULT_DEEPSEEK_PROVIDER_MODEL`             |
| `DEFAULT_GEMMA_PROVIDER_API_KEY`              |
| `DEFAULT_GEMMA_PROVIDER_BASE_URL`             |
| `DEFAULT_GEMMA_PROVIDER_MODEL`                |
| `DEFAULT_QWEN_PROVIDER_API_KEY_ENV`           |
| `DEFAULT_QWEN_PROVIDER_API_KEY_REFERENCE`     |
| `DEFAULT_QWEN_PROVIDER_BASE_URL`              |
| `DEFAULT_QWEN_PROVIDER_MODEL`                 |
| `DEFAULT_QWEN_PROVIDER_RESPONSES_BASE_URL`    |
| `QWEN_MODEL_LAST_VERIFIED_AT`                 |
| `QWEN_MODEL_SOURCE_URL`                       |
| `QWEN_PROVIDER_BASE_URLS`                     |
| `QWEN_PROVIDER_RESPONSES_BASE_URLS`           |

### Sub-path exports

| Sub-path   | Entry           | Description                                                                                                                  |
| ---------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `./shared` | `src/shared.ts` | OpenAI-compatible protocol base (probe, response parser, stream assembler, converters) — consumed by `agent-provider-openai` |

## Dependencies

| Package                  | Role                                             |
| ------------------------ | ------------------------------------------------ |
| `@robota-sdk/agent-core` | `IAIProvider`, `IProviderDefinition`, hook types |
| `openai`                 | OpenAI SDK (compatible endpoints)                |

## Circular Dependency Policy

This package depends on `@robota-sdk/agent-core` only among framework packages (plus its one vendor SDK where applicable). `agent-framework`, `agent-session`, and all higher-layer packages must never be imported.

## Build Output Contract

```
dist/
└── node/
    └── index.js / index.cjs / index.d.ts   # root export
    └── shared ...             # sub-path entry
```
