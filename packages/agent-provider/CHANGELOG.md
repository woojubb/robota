# @robota-sdk/agent-provider

## 3.3.1
### Patch Changes

- The previous version of this package was tagged but never published to npm, because `main` moved past its release commit first. This version carries the same consolidated package set from the current `main`, with comment and test-name cleanups and no behavior change.

## 3.3.0
### Minor Changes

- 589df44: The provider packages are now one package, `@robota-sdk/agent-provider`, with one subpath per vendor: `anthropic`, `openai`, `gemini`, `google`, `bytedance`, `deepseek`, `qwen`, `gemma`, `openai-compatible` and `builtin`. Import the subpath of the vendor you use (`@robota-sdk/agent-provider/anthropic`); the vendor SDKs (`@anthropic-ai/sdk`, `openai`, `@google/genai`) are optional peers, so installing the package adds only the SDK you install yourself, and a bundle that imports one subpath contains no other vendor. The abstract classes, interfaces and helpers you implement to write your own provider are unchanged. `@robota-sdk/agent-provider-anthropic`, `-openai`, `-openai-compatible`, `-gemini`, `-bytedance` and `@robota-sdk/agent-builtin-providers` no longer receive releases. The shipped type comment of the framework package names the new import path.

### Patch Changes

- Updated dependencies [1f900da]
- Updated dependencies [bf901d7]
  - @robota-sdk/agent-core@3.2.3
