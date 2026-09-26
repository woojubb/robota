# @robota-sdk/agent-provider-openai

## 3.0.0-beta.82

### Patch Changes

- Updated dependencies [c7f9203]
  - @robota-sdk/agent-core@3.0.0-beta.82
  - @robota-sdk/agent-provider-openai-compatible@3.0.0-beta.82

## 3.0.0-beta.81

### Patch Changes

- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [ec5e477]
  - @robota-sdk/agent-core@3.0.0-beta.81
  - @robota-sdk/agent-provider-openai-compatible@3.0.0-beta.81

## 3.0.0-beta.80

### Minor Changes

- 1698be4: A child-process subagent can no longer send the parent's provider credential to a different
  endpoint.

  - **Before spawning a child**, the parent compares every environment variable that decides where
    the provider connects or which credential it sends. If the child's environment differs, the job
    is refused before the credential leaves the parent. The error names the variable, never its
    value. The variables compared are:
    - the proxy and TLS variables;
    - the variables the provider's SDK reads, such as `OPENAI_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` and
      the Vertex settings;
    - the credential's own variable.
  - **The child** repeats the check before it builds its provider. It builds that provider from the
    parent's effective connection exactly: it no longer fills in a base URL, options or a default
    credential from its own registry, and a credential reference that resolves to nothing is refused.
  - **Where the effective connection comes from:** the parent applies its own definition defaults
    (base URL, options). `profileName` is sent only when it names the connection actually sent.
  - **New contracts:**
    - `IProviderDefinition.destinationEnvironment`, declared by every built-in provider.
    - `createProviderFromExactProfile`, `connectionEnvironmentNames`,
      `findConnectionEnvironmentDivergence`, `sealConnectionEnvironment`,
      `verifyConnectionEnvironment` and `TRANSPORT_ENVIRONMENT`.
    - The start payload's `connectionCheck`.
    - The child-process runner's `providerDefinitions` option, now required: a provider with no
      definition there is refused, because its connection cannot be checked.

- 4c73a0b: Provider failures keep the vendor's HTTP status and error type. `ProviderError` gains `status` and `type`, adapters throw `ProviderError` (or `RateLimitError` for a rate limit) instead of a bare `Error`, an Anthropic mid-stream `overloaded_error` event surfaces as a `ProviderError` with that type, and media errors carry `status`. New `classifyProviderFailure` says whether a failure is worth retrying on another model, and `toProviderError` is the shared adapter mapping.
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
- b6d14ce: Make the universal JSON-schema subset able to express an object, so a nested `z.object()` keeps its
  properties and required fields instead of reaching the model as `{ "type": "object" }`. Tools and
  structured-output schemas with one level of nesting are now advertised in full and enforced on the
  tool-input path; `z.union` / `z.discriminatedUnion` / `z.literal` are supported and map to `anyOf`
  and single-value enums; `.nullable()` keeps its null branch; and Zod's `strip`, `strict` and
  `passthrough` modes stop collapsing into two `additionalProperties` emissions. Fixes the shipped
  `Computer` and `AskUserQuestion` built-ins, whose action and question fields were being dropped
  entirely.

  `agent-core` is **minor**, not patch: `IObjectParameterSchema` is a new export, and
  `IParameterSchema.type` became optional (a union node carries `anyOf` instead of a type), which is a
  consumer-visible type change — two call sites in this repo needed editing to keep compiling.
  `additionalProperties` also widened to `boolean | IParameterSchema`, and `required` and `anyOf` are
  new members. The provider packages are **patch**: each adapts to the widened subset without changing
  its own public surface.

- 93d061d: CORE-043: structured output now knows which transport can carry the schema before the first call

  `run(input, { output })` asked every provider for `responseFormat: { type: 'json_schema' }`. A
  provider whose surface cannot express that accepted the option and dropped it — and the schema was
  stated in words only by the RETRY feedback turn, which runs on attempt two. So against such a
  provider, attempt one carried nothing describing the required shape and could only succeed by luck:
  the advertised three attempts were really two, and the first was spent discovering something the
  capability table already knew.

  A `(provider, model)` pair now resolves to a mechanism (`response_schema` / `json_object` / `none`)
  and a provenance (`catalog` / `vendor-default` / `undeclared` / `unverified-endpoint`), and the
  request is shaped to match at the one seam that holds both the resolved provider and the outgoing
  messages. When the wire cannot carry the shape, the schema is stated in the prompt on the FIRST
  attempt. Each structured request emits a `structured_output_transport` event reporting what the
  request actually did.

  - `IAIProvider.endpointIsVendorDefault?()` — a provider configured with a custom `baseURL` reports
    it, so the runtime stops claiming enforcement a gateway may not provide. Separate from
    `capabilityTable?()` on purpose: `@robota-sdk/agent-provider-openai` declares no table (nobody has
    verified one) and must still be able to answer.
  - DeepSeek's capability table declared `json_schema`; DeepSeek guarantees the response PARSES but
    takes no schema parameter. Corrected to `json_object`.
  - A provider that declares nothing is still sent the request unchanged — silence is not a denial.

- ebd40a0: Harden on-disk log permissions against CWE-377 (SEC-003, CodeQL `js/insecure-temporary-file`).

  Session logs, externalized session payloads, and OpenAI request/response payload logs all carry
  conversation and prompt content, but were created with the process umask (typically `0644`) inside a
  caller-supplied directory that may be shared or world-writable. They are now created owner-only
  (`0600`), and the directories that hold them are created `0700`.

  This is a permissions change only — file locations, names, formats, and APIs are unchanged. Anything
  that read these logs as a _different_ OS user will no longer be able to; the owning user is
  unaffected.

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
- Updated dependencies [d6b9404]
- Updated dependencies [9814afc]
  - @robota-sdk/agent-core@3.0.0-beta.80
  - @robota-sdk/agent-provider-openai-compatible@3.0.0-beta.80
