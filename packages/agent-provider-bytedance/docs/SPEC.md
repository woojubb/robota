# SPEC: agent-provider-bytedance

## Purpose

Bytedance (ModelArk) video-generation provider implementing `IVideoGenerationProvider`. Uses a bespoke HTTP client — no vendor SDK.

## Contract

- Implements `IVideoGenerationProvider` from `@robota-sdk/agent-core`.
- Consumers who need a provider not included here should implement `IAIProvider` from `@robota-sdk/agent-core` and register it directly, rather than extending this package.

## Boundaries

- Depends on `@robota-sdk/agent-core` only among framework packages (plus its one vendor SDK where applicable). `agent-framework`, `agent-session`, and all higher-layer packages must never be imported.
