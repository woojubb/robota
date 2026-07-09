# SPEC: agent-provider-defaults

## Overview

Composition leaf that aggregates the built-in chat provider definitions. `createDefaultProviderDefinitions()` returns the anthropic/openai/gemini/gemma/qwen/deepseek definitions; `bytedance` (video) is intentionally excluded.

Users who need a provider not included here can implement `IAIProvider` from `@robota-sdk/agent-core` and register it directly.

## Package Identity

- **npm name**: `@robota-sdk/agent-provider-defaults`
- **Layer**: Layer 1 (depends on `agent-core` only among framework packages; never imports from `agent-framework`, `agent-session`, `agent-tools`, `agent-command`, or `agent-transport`)
- **SDK**: (none directly — composes the LLM leaf packages)
- **Platform**: node

## Public API

Every runtime export of the package entry (`src/index.ts`). Provider option/config **types** are also exported (see `src/**/types.ts`); consult the source for the full type surface.

| Symbol                             |
| ---------------------------------- |
| `createDefaultProviderDefinitions` |

## Dependencies

| Package                                        | Role                            |
| ---------------------------------------------- | ------------------------------- |
| `@robota-sdk/agent-core`                       | `IProviderDefinition`           |
| `@robota-sdk/agent-provider-anthropic`         | anthropic definition            |
| `@robota-sdk/agent-provider-openai`            | openai definition               |
| `@robota-sdk/agent-provider-openai-compatible` | deepseek/qwen/gemma definitions |
| `@robota-sdk/agent-provider-gemini`            | gemini definition               |

## Circular Dependency Policy

This package depends on `@robota-sdk/agent-core` only among framework packages (plus its one vendor SDK where applicable). `agent-framework`, `agent-session`, and all higher-layer packages must never be imported.

## Build Output Contract

```
dist/
└── node/
    └── index.js / index.cjs / index.d.ts   # root export
```
