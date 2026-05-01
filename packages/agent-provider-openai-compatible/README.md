# @robota-sdk/agent-provider-openai-compatible

Reusable OpenAI-compatible Chat Completions transport primitives for Robota provider packages.

This package is a building block. End-user provider packages such as `agent-provider-openai`, `agent-provider-gemma`, and `agent-provider-qwen` compose it and own their product or model-family semantics.

Provider packages may inject text projectors for documented model-family output, including native tool-call text projection. This package only calls injected strategies and does not infer model names, prompt directives, or provider-specific syntax.

See [docs/SPEC.md](docs/SPEC.md) for the package contract.
