# SPEC: agent-provider-anthropic

## Overview

Anthropic Claude provider implementation (`@anthropic-ai/sdk`).

Users who need a provider not included here can implement `IAIProvider` from `@robota-sdk/agent-core` and register it directly.

## Package Identity

- **npm name**: `@robota-sdk/agent-provider-anthropic`
- **Layer**: Layer 1 (depends on `agent-core` only among framework packages; never imports from `agent-framework`, `agent-session`, `agent-tools`, `agent-command`, or `agent-transport`)
- **SDK**: `@anthropic-ai/sdk`
- **Platform**: node

## Public API

Every runtime export of the package entry (`src/index.ts`). Provider option/config **types** are also exported (see `src/**/types.ts`); consult the source for the full type surface.

| Symbol                                         |
| ---------------------------------------------- |
| `AnthropicProvider`                            |
| `createAnthropicProvider`                      |
| `createAnthropicProviderDefinition`            |
| `refreshAnthropicModelCatalog`                 |
| `ANTHROPIC_MODEL_LAST_VERIFIED_AT`             |
| `ANTHROPIC_MODEL_SOURCE_URL`                   |
| `DEFAULT_ANTHROPIC_PROVIDER_API_KEY_ENV`       |
| `DEFAULT_ANTHROPIC_PROVIDER_API_KEY_REFERENCE` |
| `DEFAULT_ANTHROPIC_PROVIDER_MODEL`             |

## Dependencies

| Package                  | Role                                             |
| ------------------------ | ------------------------------------------------ |
| `@robota-sdk/agent-core` | `IAIProvider`, `IProviderDefinition`, hook types |
| `@anthropic-ai/sdk`      | Anthropic API client                             |

## Circular Dependency Policy

This package depends on `@robota-sdk/agent-core` only among framework packages (plus its one vendor SDK where applicable). `agent-framework`, `agent-session`, and all higher-layer packages must never be imported.

## Build Output Contract

```
dist/
└── node/
    └── index.js / index.cjs / index.d.ts   # root export
```
