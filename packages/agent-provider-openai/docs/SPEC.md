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
| `DEFAULT_OPENAI_PROVIDER_API_KEY_REFERENCE` |
| `DEFAULT_OPENAI_PROVIDER_MODEL`             |
| `FilePayloadLogger`                         |
| `ConsolePayloadLogger`                      |

`FilePayloadLogger` and `ConsolePayloadLogger` are surfaced via the `./loggers` sub-path entry (`src/openai/loggers/index.ts`).

`FilePayloadLogger` writes prompt/response content to a caller-supplied `logDir`, so it creates that
directory with mode `0700` and each payload file with mode `0600` rather than inheriting the process
umask (SEC-003 / CWE-377). Paths, names, and formats are unchanged.

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

## Tool Schema Forwarding and `strictTools` (PROV-007)

Tool schemas reach OpenAI unchanged: `convertToOpenAIResponsesTools` forwards `tool.parameters` —
the universal JSON-schema subset owned by agent-core (see its SPEC § Universal JSON-Schema Subset) —
verbatim, and sets `strict: strictTools ?? false`.

**Known limitation.** OpenAI strict mode does not accept an arbitrary JSON Schema. It requires
**every** object node, nested ones included, to carry `additionalProperties: false` and to list
**all** of its properties in `required`. The universal subset does neither. A Zod-derived schema
emits `additionalProperties: true` for Zod's default `strip` and for `.passthrough()`, and `false`
only for `.strict()`; a hand-written one may omit the member, which the subset reads as closed
relative to its declared properties. Either way `required` lists only the genuinely required
fields.
This adapter has no seam that rewrites the schema for strict mode — the Anthropic adapter has the
analogous `closeObjectSchemas`, and there is no OpenAI equivalent on either the tool seam or the
structured-output seam.

Consequence: with `strictTools: true`, **every** `createZodFunctionTool` tool is rejected by
OpenAI — flat ones included, since `additionalProperties: true` is as unacceptable to strict mode as
omitting it — and any tool with a nested object is rejected regardless of how its schema was
authored. The same tools are invoked correctly on every other provider. Neither half is a
regression introduced by CORE-039 (a bare nested object failed strict mode before it too, and a
`strip` object was rejected for listing no `additionalProperties`), but CORE-039 is what made nested
schemas reach providers intact, so the exception is worth stating rather than leaving to be
discovered. Leave `strictTools` off until PROV-007 lands.
