# SPEC: agent-provider-openai

## Overview

OpenAI provider implementation (`openai` SDK). The OpenAI-compatible protocol base lives in `@robota-sdk/agent-provider-openai-compatible` and is consumed via its `./shared` entry.

Users who need a provider not included here can implement `IAIProvider` from `@robota-sdk/agent-core` and register it directly.

## Package Identity

- **npm name**: `@robota-sdk/agent-provider-openai`
- **Layer**: Layer 1 (depends on `agent-core` only among framework packages; never imports from `agent-framework`, `agent-session`, `agent-tools`, `agent-command`, or `agent-transport`)
- **SDK**: `openai`
- **Platform**: node

## Public API

Every runtime export of the package entry (`src/index.ts`). Provider option/config **types** are also exported (see `src/**/types.ts`); consult the source for the full type surface.

| Symbol                                      |
| ------------------------------------------- |
| `OpenAIProvider`                            |
| `OpenAIConversationAdapter`                 |
| `createOpenAIProviderDefinition`            |
| `refreshOpenAIModelCatalog`                 |
| `DEFAULT_OPENAI_PROVIDER_API_KEY_REFERENCE` |
| `DEFAULT_OPENAI_PROVIDER_MODEL`             |
| `FilePayloadLogger`                         |
| `ConsolePayloadLogger`                      |

`FilePayloadLogger` and `ConsolePayloadLogger` are surfaced via the `./loggers` sub-path entry (`src/openai/loggers/index.ts`).

## Dependencies

| Package                                        | Role                                             |
| ---------------------------------------------- | ------------------------------------------------ |
| `@robota-sdk/agent-core`                       | `IAIProvider`, `IProviderDefinition`, hook types |
| `@robota-sdk/agent-provider-openai-compatible` | OpenAI-compatible protocol base (via `./shared`) |
| `openai`                                       | OpenAI SDK                                       |

## Circular Dependency Policy

This package depends on `@robota-sdk/agent-core` only among framework packages (plus its one vendor SDK where applicable). `agent-framework`, `agent-session`, and all higher-layer packages must never be imported.

## Build Output Contract

```
dist/
└── node/
    └── index.js / index.cjs / index.d.ts   # root export
    └── loggers ...             # sub-path entry
```

## Reasoning Effort (per-call)

The framework threads a per-call reasoning-effort dial through `IChatOptions.effort`
(`TModelEffort` = `'low' | 'medium' | 'high' | 'xhigh' | 'max'`, defaulting to `'high'` at
the framework→provider seam). Each provider's request builder handles it as follows:

| Provider              | Native effort support | Behavior                                                                                                                                                                            |
| --------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI (Responses)    | Yes                   | Maps `effort` onto the Responses API `reasoning.effort` parameter. `'low'`/`'medium'`/`'high'` pass through; `'xhigh'`/`'max'` clamp to `'high'` (OpenAI's highest supported tier). |
| Anthropic             | No (documented no-op) | The Anthropic Messages API exposes no per-request reasoning-effort enum, so `effort` is **ignored without error** — the built request carries no effort parameter.                  |
| DeepSeek              | No (documented no-op) | Per-call `effort` is **ignored without error**; the built request has no effort parameter. (DeepSeek's static `reasoningEffort` constructor option is a separate, unrelated knob.)  |
| Qwen / Gemma / Gemini | No (documented no-op) | No native per-request reasoning-effort parameter; `effort` is **ignored without error** (no effort key on the built request).                                                       |

No-op providers must never throw on a populated `effort`; they simply omit it from the
outgoing request so an effort-setting preset degrades gracefully.
