# agent-builtin-providers Docs Index

This package is the default provider set that ships with Robota: the definitions of the built-in chat
providers (anthropic, openai, gemini, gemma, qwen, deepseek), the default media provider definitions
(Gemini image and Seedance video), and the default role-to-model mapping (`DEFAULT_ROLE_MODELS`). The
[package README](../README.md) shows how to use each.

- [SPEC.md](SPEC.md): the package contract and its dependency boundary.
- [Offline DeepSeek example](../examples/deepseek-provider-demo.mjs): run
  `node examples/deepseek-provider-demo.mjs` from the package directory after building this package
  and its provider dependencies. It checks the DeepSeek definition and the default composition
  without API keys or requests.
