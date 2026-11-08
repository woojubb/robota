# agent-provider Docs Index

`@robota-sdk/agent-provider` holds the official provider implementations, one subpath per vendor. The
[package README](../README.md) lists the subpaths and what to install for each.

- [SPEC.md](SPEC.md): the package contract and the design decisions of every provider.
- [anthropic.md](anthropic.md), [openai.md](openai.md), [gemini.md](gemini.md),
  [openai-compatible.md](openai-compatible.md) (DeepSeek, Qwen, Gemma and the shared protocol base),
  [bytedance.md](bytedance.md), [builtin.md](builtin.md): installation, options and usage per provider.
- [Offline DeepSeek example](../examples/deepseek-provider-demo.mjs): run
  `node examples/deepseek-provider-demo.mjs` from the package directory after building it. It checks the DeepSeek
  definition and the default composition without API keys or requests.
