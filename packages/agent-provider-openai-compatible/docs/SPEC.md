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

## Structured Output — not mapped here (CORE-043)

**`IChatOptions.responseFormat` is not read by any adapter in this package.** `deepseek`, `qwen` and
`gemma` build their requests without it, so a `run(input, { output })` call against them carries
**no schema signal on the first attempt at all** — not a native `response_format`, and not a prose
instruction either. `spec.jsonSchema` reaches the model only through the retry-feedback turn that
agent-core's enforcement loop sends _after_ a first attempt has already failed validation.

The consequence is worth stating plainly rather than leaving to be measured: a structured run against
this family costs at least one extra turn by construction, and `outputRetries: 0` can only succeed by
luck. agent-core's bounded validate-and-retry loop still guarantees the returned object matches the
schema or throws — the guarantee holds; the cost is real.

**This is a stated gap, not a design.** It is recorded here because a user currently has no way to
learn it except by measuring: the SPEC's § Structured Output Contract says providers without a native
surface "ignore it — the core-side enforcement loop is the universal contract either way", which is
true of the guarantee and silent about the cost. The per-model catalog makes it worse:
`src/deepseek/model-catalog.ts` declares `'json_schema'` on all three entries, a capability this
package does not implement, and nothing reads that flag anyway (PROV-006).

Fixing it — threading `responseFormat` through the shared request builder, and deciding where
capability is represented so the runtime can tell a mapped provider from a discarding one — is
**CORE-043** (issue #1750), whose load-bearing decisions are reserved for the project owner. PROV-004
carries the same row. Until then, treat structured output on this family as retry-driven.
