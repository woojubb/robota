# @robota-sdk/agent-builtin-providers

## 3.0.0-beta.81

### Patch Changes

- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [ec5e477]
  - @robota-sdk/agent-core@3.0.0-beta.81
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.81
  - @robota-sdk/agent-provider-bytedance@3.0.0-beta.81
  - @robota-sdk/agent-provider-gemini@3.0.0-beta.81
  - @robota-sdk/agent-provider-openai@3.0.0-beta.81
  - @robota-sdk/agent-provider-openai-compatible@3.0.0-beta.81

## 3.0.0-beta.80

### Minor Changes

- 7937c19: Split the `@robota-sdk/agent-provider` monolith into SDK-aligned leaf packages (ARCH-PROVIDER-002 Stage A). The single package that hard-bundled all three vendor SDKs (`@anthropic-ai/sdk`, `openai`, `@google/genai`) is **removed** and replaced by per-vendor leaves, each depending only on `@robota-sdk/agent-core` + its one SDK: `@robota-sdk/agent-provider-anthropic`, `@robota-sdk/agent-provider-openai`, `@robota-sdk/agent-provider-openai-compatible` (DeepSeek/Qwen/Gemma over the shared OpenAI-compatible base), `@robota-sdk/agent-provider-gemini` (+ a `./google` entry), and `@robota-sdk/agent-provider-bytedance` (media/video `IVideoGenerationProvider`). The aggregated `createDefaultProviderDefinitions()` now lives in the new `@robota-sdk/agent-builtin-providers` leaf.

  Migration: replace `@robota-sdk/agent-provider/<vendor>` imports with the corresponding `@robota-sdk/agent-provider-<vendor>` package (`/deepseek`, `/qwen`, `/gemma` → `@robota-sdk/agent-provider-openai-compatible`; `/google` → `@robota-sdk/agent-provider-gemini/google`), and import `createDefaultProviderDefinitions` from `@robota-sdk/agent-builtin-providers`. Consumers now pull only the vendor SDK(s) they actually use.

### Patch Changes

- 9fbab1b: Provider DIP Stage B (ARCH-PROVIDER-003), part 1: collapse infrastructure. Adds the
  provider-registry-driven `@robota-sdk/dag-node-llm-text` node that supersedes the
  per-vendor LLM nodes + router, relocates the provider config resolver into
  `agent-core`, adds SSOT cost/allowedModels fields, inverts the `llm-text` validator
  tombstone, and wires `createDagFramework({ providers })`. Additive — the per-vendor
  nodes still exist; consumer migration + their removal follow in part 2.
- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
- Updated dependencies [7b6234c]
- Updated dependencies [4eea54b]
- Updated dependencies [1698be4]
- Updated dependencies [d4189b9]
- Updated dependencies [9edae52]
- Updated dependencies [4078a72]
- Updated dependencies [4c73a0b]
- Updated dependencies [196a900]
- Updated dependencies [f336838]
- Updated dependencies [34e50f0]
- Updated dependencies [722e88a]
- Updated dependencies [d23c848]
- Updated dependencies [fec722f]
- Updated dependencies [2d3b2c0]
- Updated dependencies [4772067]
- Updated dependencies [7937c19]
- Updated dependencies [9fbab1b]
- Updated dependencies [a009f5b]
- Updated dependencies [4f3c075]
- Updated dependencies [475e085]
- Updated dependencies [e477440]
- Updated dependencies [9dcb5da]
- Updated dependencies [a95ca85]
- Updated dependencies [b6d14ce]
- Updated dependencies [0382a51]
- Updated dependencies [93d061d]
- Updated dependencies [39554a1]
- Updated dependencies [d28430a]
- Updated dependencies [07b627f]
- Updated dependencies [d0de5b2]
- Updated dependencies [2916d00]
- Updated dependencies [7669851]
- Updated dependencies [ebd40a0]
- Updated dependencies [d6b9404]
- Updated dependencies [9814afc]
  - @robota-sdk/agent-core@3.0.0-beta.80
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.80
  - @robota-sdk/agent-provider-gemini@3.0.0-beta.80
  - @robota-sdk/agent-provider-openai@3.0.0-beta.80
  - @robota-sdk/agent-provider-openai-compatible@3.0.0-beta.80
  - @robota-sdk/agent-provider-bytedance@3.0.0-beta.80
