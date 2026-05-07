# Gemma Provider Docs

`@robota-sdk/agent-provider-gemma` supports Gemma-family local models served through LM Studio or other OpenAI-compatible endpoints.

## Current Capabilities

- OpenAI-compatible transport tuned for Gemma-family behavior.
- Reasoning marker projection from Gemma serving templates.
- Native tool-call text projection into Robota tool-call structures.
- Explicit capability report for unsupported provider-native hosted web search/fetch on LM Studio-style endpoints.
- Provider-definition metadata for CLI setup.

## Documents

- [Package README](../README.md) — installation and local endpoint setup.
- [SPEC.md](SPEC.md) — package contract, boundaries, public API, and test strategy.
