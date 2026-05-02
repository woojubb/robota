# OpenAI-Compatible Provider Primitives Docs

`@robota-sdk/agent-provider-openai-compatible` owns reusable OpenAI-compatible transport primitives for providers and custom endpoints.

## Current Capabilities

- Endpoint probing and response parsing for OpenAI-compatible APIs.
- Streaming assembly helpers shared by compatible providers.
- Transport boundary kept separate from model-family behavior; Gemma and Qwen own their family-specific projections.

## Documents

- [Package README](../README.md) — installation and endpoint configuration.
- [SPEC.md](SPEC.md) — package contract, boundaries, public API, and test strategy.
