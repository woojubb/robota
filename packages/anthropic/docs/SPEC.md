# Anthropic Specification

## Scope
- Owns Anthropic provider integration for Robota, including Claude model access and provider-bound request or response adaptation.

## Boundaries
- Does not own generic agent orchestration contracts that belong to `@robota-sdk/agents`.
- Keeps Anthropic-specific transport behavior explicit and provider-scoped.
