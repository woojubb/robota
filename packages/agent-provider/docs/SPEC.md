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

Re-exports all provider classes, factory functions, and types from all providers (except `google/`, which is omitted as a deprecated compatibility alias). Also exports `createDefaultProviderDefinitions()`.

| Symbol                             | Kind     | Description                                                                                                                                                                         |
| ---------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createDefaultProviderDefinitions` | function | Returns `readonly IProviderDefinition[]` for all built-in chat providers (anthropic, openai, gemini, gemma, qwen, deepseek); `bytedance` (video/internal) is intentionally excluded |

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

### Anthropic sub-path (`@robota-sdk/agent-provider/anthropic`)

| Symbol                              | Kind      | Description                                                                 |
| ----------------------------------- | --------- | --------------------------------------------------------------------------- |
| `AnthropicProvider`                 | class     | Extends `AbstractAIProvider`; implements `IAIProvider`                      |
| `createAnthropicProvider`           | function  | `(options: IAnthropicProviderOptions) => IAIProvider` — convenience factory |
| `createAnthropicProviderDefinition` | function  | Returns `IProviderDefinition` for use with provider registries              |
| `refreshAnthropicModelCatalog`      | function  | Fetches live model list from Anthropic API; returns `IProviderModelCatalog` |
| `IAnthropicProviderOptions`         | interface | Options: `apiKey?`, `timeout?`, `baseURL?`, `client?`, `executor?`          |
| `TAnthropicProviderOptionValue`     | type      | Union of valid option value types                                           |

`createAnthropicProvider` returns `IAIProvider` (typed as `AnthropicProvider` at runtime). This is the recommended way to instantiate the provider when a concrete class reference is not required.

### Other provider sub-paths

Unlike Anthropic, the remaining providers do **not** ship a `create<Name>Provider` convenience
factory — instantiate them with `new <Name>Provider({ apiKey })`. Each sub-path exports its
provider class plus a `create<Name>ProviderDefinition()` for use with provider registries, and
provider-specific `DEFAULT_*` constants.

| Sub-path      | Class (instantiate via `new`) | Definition factory                 | Notes                                          |
| ------------- | ----------------------------- | ---------------------------------- | ---------------------------------------------- |
| `./openai`    | `OpenAIProvider`              | `createOpenAIProviderDefinition`   | OpenAI-compatible base; `./openai/loggers` too |
| `./deepseek`  | `DeepSeekProvider`            | `createDeepSeekProviderDefinition` | OpenAI-compatible endpoint                     |
| `./gemini`    | `GeminiProvider`              | `createGeminiProviderDefinition`   | also implements `IImageGenerationProvider`     |
| `./gemma`     | `GemmaProvider`               | `createGemmaProviderDefinition`    | local models (LM Studio / OpenAI-compatible)   |
| `./qwen`      | `QwenProvider`                | `createQwenProviderDefinition`     | OpenAI-compatible endpoint                     |
| `./bytedance` | `BytedanceProvider`           | —                                  | `IVideoGenerationProvider` (video, internal)   |

`./google` is a deprecated compatibility alias re-exporting `./gemini`.

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

## Tool Choice (per-call)

The framework threads a per-call tool-invocation directive through `IChatOptions.toolChoice`
(`TToolChoice` = `'auto' | 'none' | 'required' | { tool: name }`; agent-core validates named
directives against the run's tool list before the provider is called). Every chat adapter
maps it onto its wire format when tools are present; an unset directive keeps the wire
default (`'auto'` for OpenAI-shaped surfaces, parameter omitted for Anthropic/Gemini/Qwen
Responses):

| Provider surface                                             | Wire mapping                                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| OpenAI Chat Completions + compatible (Qwen, DeepSeek, Gemma) | `tool_choice`: `'auto'` / `'none'` / `'required'` / `{ type: 'function', function: { name } }` (shared mapper)      |
| OpenAI Responses (+ Qwen Responses)                          | `tool_choice`: `'auto'` / `'none'` / `'required'` / flat `{ type: 'function', name }`                               |
| Anthropic                                                    | `tool_choice`: `{ type: 'auto' }` / `{ type: 'none' }` / `{ type: 'any' }` (required) / `{ type: 'tool', name }`    |
| Gemini (Google inherits)                                     | `toolConfig.functionCallingConfig`: mode `AUTO` / `NONE` / `ANY` (required); named = `ANY` + `allowedFunctionNames` |

## Streaming Token Usage

OpenAI-compatible surfaces (openai, openai-compatible, qwen, deepseek, gemma) request token
usage on streaming turns and expose it on the assembled assistant message so that the
streaming path carries the **same** usage contract as the non-streaming path.

- **Request.** Streaming requests (both the `onTextDelta` assembly path and the `chatStream`
  generator) include `stream_options: { include_usage: true }`. It is only sent on streaming
  requests — never on the non-streaming `create`. Endpoints emit a final chunk (with
  `choices: []`) carrying `usage` only when this is present.
- **Assembly.** The shared stream assembler
  (`shared/openai-compatible/stream-assembler.ts`) captures that final-chunk `usage` (including
  the empty-`choices` chunk) and attaches a top-level
  `usage: { promptTokens, completionTokens, totalTokens }` to the assembled `TUniversalMessage`
  — byte-for-byte the shape the non-streaming `response-parser.ts` `parseUsage` produces. The
  `chatStream` generator attaches the same shape via `parseStreamingChunk`. Consumers
  (`readTokenUsageFromMessage`, `collectAssistantUsageMetadata` in agent-core) read it unchanged.
  When a provider sends no usage, the field is simply absent (treated as "no usage", as before).
- **Opt-out.** `IOpenAIProviderOptions.includeStreamUsage?: boolean` (default `true`) disables
  sending `stream_options` for OpenAI-compatible endpoints that reject it; usage is then absent
  on streaming turns for that provider.

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
│   └── index.js / index.cjs / index.d.ts       # ./openai/loggers sub-path
└── browser/
    └── index.js / index.d.ts                 # ESM-only, browser platform
```

> Note: the `dist/browser` bundle is built by `tsdown` (`platform: 'browser'`), but `package.json`
> `exports` currently declares only `node`/`default` conditions — the browser bundle is produced
> but not yet consumer-resolvable via the exports map.
