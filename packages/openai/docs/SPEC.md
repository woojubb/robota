# OpenAI Specification

## Scope
- Owns OpenAI provider integration for Robota, including GPT model access and provider-bound request or response adaptation.

## Boundaries
- Does not own generic agent orchestration contracts that belong to `@robota-sdk/agents`.
- Keeps OpenAI-specific transport behavior explicit and provider-scoped.
