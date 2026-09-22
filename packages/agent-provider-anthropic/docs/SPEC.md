# SPEC: agent-provider-anthropic

## Overview

Anthropic Claude provider implementation (`@anthropic-ai/sdk`).

Users who need a provider not included here can implement `IAIProvider` from `@robota-sdk/agent-core` and register it directly.

## Package Identity

- **npm name**: `@robota-sdk/agent-provider-anthropic`
- **Layer**: Layer 1 — the dependency set that places it there is declared in this package\'s manifest and enforced by `check-dependency-direction.mjs`; not restated here
- **SDK**: `@anthropic-ai/sdk`
- **Platform**: node

## Public API

Every runtime export of the package entry (`src/index.ts`). Provider option/config **types** are also exported (see `src/**/types.ts`); consult the source for the full type surface.

| Symbol                                         |
| ---------------------------------------------- |
| `AnthropicProvider`                            |
| `createAnthropicProvider`                      |
| `createAnthropicProviderDefinition`            |
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

## Diagnostic endpoint (OBSERVABILITY-1991)

The definition declares `endpoint: { host: 'api.anthropic.com', port: 443 }` — the vendor SDK's embedded
endpoint, stated on the Robota side for the pre-session doctor's TCP reachability check only. It is
deliberately **not** `defaults.baseURL`: that field is runtime-effective (it is persisted into created
profiles and passed to `createProvider`), while `endpoint` is read by no setup, persistence or
provider-construction path. A profile that sets its own `baseURL` is probed at that host instead.

## Circular Dependency Policy

This package depends on `@robota-sdk/agent-core` only among framework packages (plus its one vendor SDK where applicable). `agent-framework`, `agent-session`, and all higher-layer packages must never be imported.

## Build Output Contract

```
dist/
└── node/
    └── index.js / index.cjs / index.d.ts   # root export
```

## Model Effort (API-001)

`src/anthropic/model-effort-table.ts` owns source-dated Anthropic Messages facts and exposes them
through `AnthropicProvider.effortTable()` only at the vendor endpoint. For a documented model, a
concrete Core selection is serialized as `output_config.effort` and merged with an existing
`output_config.format`; `auto` reports the table default while omitting the native effort field. An
unknown model or configured `baseURL` reports `not-applied` and sends no unverified control. A terminal
observer receives exactly one serializable resolution/native-control/dispatch outcome after success.

`examples/verify-model-effort.ts` is typechecked with this package and source-runs with
`ANTHROPIC_API_KEY` loaded from the Git-ignored repository-root `.env.local`; it selects the active
`claude-sonnet-4-6` model itself, then prints results for `high`, `max`, and `auto` without writing
settings or cache files.

## Tool Schema Projection (MCP-005)

`AnthropicProvider.projectionProfile()` returns `@robota-sdk/agent-core`'s
`PERMISSIVE_TOOL_SCHEMA_PROFILE` with `providerName: 'anthropic'` — Anthropic accepts standard JSON
Schema with an `object` root, so no keyword stripping or object closure runs. `AbstractAIProvider.
projectTools()` calls `projectToolSchema()` at both request-building sites (`provider.ts:138` for
`chat()`, `:235` for `chatStream()`) before `convertToolsToAnthropicFormat` ever sees a tool's
`parameters`. A tool `projectToolSchema` rejects (a non-`object` root, a prototype-key property name,
a cycle, or a schema over the shared depth/node ceiling) is omitted from that request alone — every
other tool on the turn is unaffected — and reported once per cache identity as one
`tool_schema_quarantined` line on `agent-core`'s global-sink `ToolSchemaProjection` logger.
