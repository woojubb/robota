# SPEC: agent-builtin-providers

## Overview

Composition leaf that aggregates the built-in chat provider definitions. `createDefaultProviderDefinitions()` returns the anthropic/openai/gemini/gemma/qwen/deepseek definitions; `bytedance` (video) is intentionally excluded.

Users who need a provider not included here can implement `IAIProvider` from `@robota-sdk/agent-core` and register it directly.

## Package Identity

- **npm name**: `@robota-sdk/agent-builtin-providers`
- **Layer**: Layer 1 — the dependency set that places it there is declared in this package\'s manifest and enforced by `check-dependency-direction.mjs`; not restated here
- **SDK**: (none directly — composes the LLM leaf packages)
- **Platform**: node

## Public API

Every runtime export of the package entry (`src/index.ts`). Provider option/config **types** are also exported (see `src/**/types.ts`); consult the source for the full type surface.

| Symbol                                  |
| --------------------------------------- |
| `createDefaultProviderDefinitions`      |
| `DEFAULT_ROLE_MODELS`                   |
| `createDefaultMediaProviderDefinitions` | Default image/video provider definitions |
| `createGeminiImageProviderDefinition`   | Gemini image provider definition         |
| `createSeedanceVideoProviderDefinition` | Seedance video provider definition       |
| `GEMINI_IMAGE_MEDIA_PROVIDER_TYPE`      | Canonical Gemini image provider type     |
| `SEEDANCE_VIDEO_MEDIA_PROVIDER_TYPE`    | Canonical Seedance video provider type   |

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

## Test Strategy

`src/default-role-models.test.ts` verifies the concrete default role chains and cross-provider
fallback. Neutral role-map contract checks belong to agent-core's owner-local tests; this package
does not read agent-core's internal source to verify them.

`examples/deepseek-provider-demo.mjs` verifies the public DeepSeek definition from
`@robota-sdk/agent-provider-openai-compatible` and this package's public
`createDefaultProviderDefinitions()` composition. From this package, run
`node examples/deepseek-provider-demo.mjs` after the package and its provider prerequisites
have been built. The example checks definition defaults, active/deprecated catalog entries,
and DeepSeek's presence and position in the default list. It never creates a provider, resolves
an API-key environment reference, or sends a request. A failed assertion exits nonzero.

`pnpm scenario:verify` runs this offline example. `pnpm scenario:record` uses the existing
repository scenario recorder to capture a successful verification in
`examples/scenarios/offline-verify.record.json`; it does not contact a live provider.

`src/deepseek-provider-demo.test.ts` runs the real example and checks failure reporting with an
in-memory catalog mutation in a separate process. These are offline composition checks, not
proof of CLI integration. The CLI owns that proof in
`packages/agent-cli/src/__tests__/robota-assembly-equivalence.test.ts`, under
`offers the same provider surface`; no compiled CLI chunk names are inspected here.

## Build Output Contract

```
dist/
└── node/
    └── index.js / index.cjs / index.d.ts   # root export
```
