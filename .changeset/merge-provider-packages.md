---
'@robota-sdk/agent-provider': minor
'@robota-sdk/agent-framework': patch
---

The provider packages are now one package, `@robota-sdk/agent-provider`, with one subpath per vendor: `anthropic`, `openai`, `gemini`, `google`, `bytedance`, `deepseek`, `qwen`, `gemma`, `openai-compatible` and `builtin`. Import the subpath of the vendor you use (`@robota-sdk/agent-provider/anthropic`); the vendor SDKs (`@anthropic-ai/sdk`, `openai`, `@google/genai`) are optional peers, so installing the package adds only the SDK you install yourself, and a bundle that imports one subpath contains no other vendor. The abstract classes, interfaces and helpers you implement to write your own provider are unchanged. `@robota-sdk/agent-provider-anthropic`, `-openai`, `-openai-compatible`, `-gemini`, `-bytedance` and `@robota-sdk/agent-builtin-providers` no longer receive releases. The shipped type comment of the framework package names the new import path.
