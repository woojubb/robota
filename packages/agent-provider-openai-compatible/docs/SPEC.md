# SPEC: agent-provider-openai-compatible

## Overview

OpenAI-compatible providers (DeepSeek, Qwen, Gemma) plus the shared OpenAI-compatible protocol implementation used by them and by `@robota-sdk/agent-provider-openai`.

Users who need a provider not included here can implement `IAIProvider` from `@robota-sdk/agent-core` and register it directly.

## Package Identity

- **npm name**: `@robota-sdk/agent-provider-openai-compatible`
- **Layer**: Layer 1 — the dependency set that places it there is declared in this package\'s manifest and enforced by `check-dependency-direction.mjs`; not restated here
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

## Structured Output — carried by the core transport seam (CORE-043)

**No adapter in this package reads `IChatOptions.responseFormat`.** `deepseek`, `qwen` and `gemma`
build their requests without it. That used to mean a `run(input, { output })` call against them
carried **no schema signal on the first attempt at all** — not a native `response_format`, and not a
prose instruction either, because `spec.jsonSchema` reached the model only through the retry-feedback
turn agent-core sends _after_ a first attempt has already failed. A structured run against this
family cost at least one extra turn by construction, and `outputRetries: 0` could only succeed by
luck.

CORE-043 closed that at the seam that assembles the request, not per adapter. agent-core now asks
this package's capability table which transport applies and, when no schema parameter exists, states
the schema as a system instruction on the FIRST attempt. So the extra turn is gone without any
adapter here gaining a `responseFormat` branch — the mapping belongs where the capability is known,
and duplicating it into three request builders is how the two answers would drift apart.

**The capability claims were also wrong, and are corrected.** `DEEPSEEK_CAPABILITY_TABLE` declared
`'json_schema'`; DeepSeek's JSON Output guarantees the response PARSES but takes no schema parameter
and enforces no shape. It now declares `'json_object'`, which agent-core maps to
`responseFormat: { type: 'json_object' }` plus the prompt statement of the schema. `qwen` declares
neither, so its structured requests omit the option entirely rather than sending one to be ignored.

agent-core's bounded validate-and-retry loop remains the guarantee: the returned object matches the
schema or it throws.
