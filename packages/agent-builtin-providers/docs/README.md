# agent-builtin-providers Docs Index

- `SPEC.md`: Composition leaf that aggregates the built-in chat provider definitions. `createDefaultProviderDefinitions()` returns the anthropic/openai/gemini/gemma/qwen/deepseek definitions; `bytedance` (video) is intentionally excluded.
- [Offline DeepSeek example](../examples/deepseek-provider-demo.mjs): from the package directory,
  run `node examples/deepseek-provider-demo.mjs` after building this package and its provider
  prerequisites. It checks definition metadata and default composition without API keys or requests;
  see [Test Strategy](SPEC.md) for the separate CLI verification boundary.
