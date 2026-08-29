# SPEC: agent-provider-gemini

## Overview

Google Gemini provider implementation (`@google/genai`). Also implements `IImageGenerationProvider`. The deprecated `GoogleProvider` compatibility alias is re-exported via the `./google` entry.

Users who need a provider not included here can implement `IAIProvider` from `@robota-sdk/agent-core` and register it directly.

## Package Identity

- **npm name**: `@robota-sdk/agent-provider-gemini`
- **Layer**: Layer 1 — the dependency set that places it there is declared in this package\'s manifest and enforced by `check-dependency-direction.mjs`; not restated here
- **SDK**: `@google/genai`
- **Platform**: node

## Public API

Every runtime export of the package entry (`src/index.ts`). Provider option/config **types** are also exported (see `src/**/types.ts`); consult the source for the full type surface.

| Symbol                                      |
| ------------------------------------------- |
| `GeminiProvider`                            |
| `createGeminiProviderDefinition`            |
| `GEMINI_MODEL_LAST_VERIFIED_AT`             |
| `GEMINI_MODEL_SOURCE_URL`                   |
| `DEFAULT_GEMINI_PROVIDER_API_KEY_ENV`       |
| `DEFAULT_GEMINI_PROVIDER_API_KEY_REFERENCE` |
| `DEFAULT_GEMINI_PROVIDER_MODEL`             |

### Sub-path exports

| Sub-path   | Entry           | Description                                                          |
| ---------- | --------------- | -------------------------------------------------------------------- |
| `./google` | `src/google.ts` | `GoogleProvider` deprecated compatibility alias for `GeminiProvider` |

## Dependencies

| Package                  | Role                                             |
| ------------------------ | ------------------------------------------------ |
| `@robota-sdk/agent-core` | `IAIProvider`, `IProviderDefinition`, hook types |
| `@google/genai`          | Google GenAI SDK                                 |

## Circular Dependency Policy

This package depends on `@robota-sdk/agent-core` only among framework packages (plus its one vendor SDK where applicable). `agent-framework`, `agent-session`, and all higher-layer packages must never be imported.

## Build Output Contract

```
dist/
└── node/
    └── index.js / index.cjs / index.d.ts   # root export
    └── google ...             # sub-path entry
```

## Streaming Response Contract

`GeminiProvider` preserves every assistant function call and `usageMetadata` value returned by
Gemini's streaming API. `chatStream()` emits text deltas as they arrive and also emits a universal
assistant message for a function-call chunk or a usage-only terminal chunk. When `chat()` uses its
streaming assembly path (`onTextDelta` is set), it returns one complete assistant message whose
text, `toolCalls`, and `metadata` are assembled from all stream chunks.

Requests containing `nativeWebTools` are validated by both `chat()` and `chatStream()` through the
provider capability contract. Gemini currently does not advertise native web tools, so such a
request fails explicitly instead of being silently ignored.
