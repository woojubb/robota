# SPEC: agent-provider-bytedance

## Overview

Bytedance (ModelArk) video-generation provider implementing `IVideoGenerationProvider`. Bespoke HTTP client — no vendor SDK.

Users who need a provider not included here can implement `IAIProvider` from `@robota-sdk/agent-core` and register it directly.

## Package Identity

- **npm name**: `@robota-sdk/agent-provider-bytedance`
- **Layer**: Layer 1 (depends on `agent-core` only among framework packages; never imports from `agent-framework`, `agent-session`, `agent-tools`, `agent-command`, or `agent-transport`)
- **SDK**: (bespoke HTTP — no vendor SDK)
- **Platform**: node

## Public API

Every runtime export of the package entry (`src/index.ts`). Provider option/config **types** are also exported (see `src/**/types.ts`); consult the source for the full type surface.

| Symbol              |
| ------------------- |
| `BytedanceProvider` |

## Dependencies

| Package                  | Role                                                  |
| ------------------------ | ----------------------------------------------------- |
| `@robota-sdk/agent-core` | `IAIProvider`, `IVideoGenerationProvider`, hook types |

## Circular Dependency Policy

This package depends on `@robota-sdk/agent-core` only among framework packages (plus its one vendor SDK where applicable). `agent-framework`, `agent-session`, and all higher-layer packages must never be imported.

## Build Output Contract

```
dist/
└── node/
    └── index.js / index.cjs / index.d.ts   # root export
```
