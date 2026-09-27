# agent-provider-openai Docs Index

This package owns `OpenAIProvider`, the OpenAI chat provider built on the `openai` SDK, which also
reaches any OpenAI-compatible endpoint through `baseURL`. The shared OpenAI-compatible protocol code
it uses lives in `@robota-sdk/agent-provider-openai-compatible` (its `./shared` entry). The
[package README](../README.md) covers installation, options and usage.

- [SPEC.md](SPEC.md): the package contract and its design decisions (reasoning effort, strict tool
  schemas, payload log permissions).
