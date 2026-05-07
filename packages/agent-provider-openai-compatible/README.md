# @robota-sdk/agent-provider-openai-compatible

Reusable OpenAI-compatible Chat Completions transport primitives for Robota provider packages.

This package is a building block. End-user provider packages such as `agent-provider-openai`, `agent-provider-gemma`, and `agent-provider-qwen` compose it and own their product or model-family semantics.

Provider packages may inject text projectors for documented model-family output, including native tool-call text projection. This package only calls injected strategies and does not infer model names, prompt directives, or provider-specific syntax.

## Boundary

- Owns shared OpenAI-compatible Chat Completions request/response and stream assembly utilities.
- Does not own product-specific setup defaults, model-family prompt directives, or provider profile metadata.
- Does not infer Gemma, Qwen, OpenAI, or local-model behavior from model names.
- Allows provider packages to inject explicit projection strategies when a model family documents native text forms for tool calls or reasoning channels.
- Provides `observeProviderNativeRawPayloadStream()` so concrete providers can mirror raw OpenAI-compatible stream events into replay logs without changing chunk assembly semantics.

End-user code usually imports a concrete provider package such as `agent-provider-openai`, `agent-provider-gemma`, or `agent-provider-qwen`.

See [docs/SPEC.md](docs/SPEC.md) for the package contract.
