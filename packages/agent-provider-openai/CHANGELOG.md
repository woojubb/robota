# @robota-sdk/agent-provider-openai

## 3.0.0-beta.87

### Patch Changes

- Release the migrated Robota product with its public SDK namespace, robota command, compatible SDK exports, internal product configuration, and verified CLI startup and delivery corrections.
- 7d9cc66: Add owner-hosted organization control and OpenAI-wire gateway composition with anchored authority, mandatory verified audit, durable effect reservations, provider inventory cleanup and private content receipts. OpenAI profiles can opt into operation identities preserved across SDK retries.
- 7d9cc66: Retain typed text and image observations alongside structured tool data through runtime settlement, history, and recovery. Deliver tool images as native content in OpenAI Responses and Anthropic requests, retain structured error receipts, include media in bounded result admission, and reject malformed MCP image observations with reconciliation state intact.
- 7d9cc66: Preserve admitted tool text and source attribution on Chat Completions requests and transmit tool images as call-linked native vision observations.
- 7d9cc66: Retain typed resource and audio observations alongside structured tool results through history, durable receipts, recovery, size admission, and session persistence. Preserve opaque resource references without fetching them, project embedded text and explicit unsupported binary/audio diagnostics into provider requests and compaction transcripts, and validate persisted observation shapes on reload.
- Updated dependencies
- Updated dependencies [66af868]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
  - @robota-sdk/agent-core@3.0.0-beta.87
  - @robota-sdk/agent-provider-openai-compatible@3.0.0-beta.87

## 3.0.0-beta.86

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.86
- @robota-sdk/agent-provider-openai-compatible@3.0.0-beta.86

## 3.0.0-beta.85

### Patch Changes

- 3ab2eca: - External presets accept every permission mode a session does, `auto` included; `auto` used to fail validation.
  - `createDagFramework({ ports: { costMeta } })` wires cost-metadata management; without it cost operations still report that they are unsupported.
  - `startCli()` runs the subagent worker when a subagent starts the embedder's entry script again, as the `__PRODUCT_CLI_NAME__` executable already did; an embedded CLI used to start a second CLI there.
  - The provider `executor` option docs no longer import a `RemoteExecutor` that does not exist, and `IRemoteExecutorConfig` is marked deprecated: nothing implements a remote executor.
- Updated dependencies [41cca13]
- Updated dependencies [ada3841]
- Updated dependencies [5093a30]
- Updated dependencies [94b2c87]
- Updated dependencies [3ab2eca]
  - @robota-sdk/agent-core@3.0.0-beta.85
  - @robota-sdk/agent-provider-openai-compatible@3.0.0-beta.85

## 3.0.0-beta.84

### Patch Changes

- 9c6a8db: Provider adapters now throw the specific typed failure a vendor response describes, instead of a
  generic `ProviderError` carrying only its status. A 401/403 (or a vendor-specific authentication type)
  becomes an `AuthenticationError`; a response naming an unavailable model — by code or, when the vendor
  gives neither (Anthropic's and Gemini's real bodies carry no distinguishing code), by its message —
  becomes a `ModelNotAvailableError`, whose `model` is now optional since a bare HTTP status does not
  always name one; a transport failure becomes a `NetworkError`, which now also carries the provider
  name. A 429's `retry-after` header (a delta or an HTTP-date) is read into `RateLimitError.retryAfter`
  when the vendor sends one.

  Vendor error text is scrubbed of anything that reads like a credential — an `Authorization`/`Bearer`
  value, an API key in a header, query string or JSON body, a bare `sk-`/`AIza…` token — before it is
  kept on any of these typed errors, so a misconfigured self-hosted gateway that echoes a request back
  can no longer leak one into a message or a "Details" disclosure. The new `scrubSecrets` export applies
  the same scrubbing to arbitrary text.

- Updated dependencies [9f46375]
- Updated dependencies [9c6a8db]
  - @robota-sdk/agent-core@3.0.0-beta.84
  - @robota-sdk/agent-provider-openai-compatible@3.0.0-beta.84

## 3.0.0-beta.83

### Patch Changes

- 8bd5fac: Cached input tokens are no longer dropped (#3209 R3). The OpenAI and OpenAI-compatible adapters read
  `prompt_tokens_details.cached_tokens` (Chat Completions, including the final streamed usage chunk) and
  `input_tokens_details.cached_tokens` (Responses, OpenAI and Qwen) into `cacheReadTokens` on the message
  usage: the part of the prompt served from the provider's prompt cache, present only when reported.
  It reaches the committed assistant message, `readTokenUsageFromMessage()`, and the
  `provider_call_completed` execution event, so a consumer can apply the cache discount.

  New `sumMessagesUsage(messages)` sums the usage on assistant messages (with `cacheReadTokens` when any
  reported it), so one run's usage is `sumMessagesUsage(agent.getHistory().slice(before))` without
  converting through `messageToHistoryEntry` (#3209 S1). `sumHistoryUsage` returns the same triple as before.

  A forced-summary reply now keeps the usage its provider reported the same way a tool round's reply
  does: an endpoint that omits `total_tokens` no longer loses exactly the summary call's usage (#3209 N3). Counts
  the adapter could not attest as a consistent total are recorded with `usageProvenance: 'partial'`.

- 274328f: `OpenAIProvider({ strictTools: true })` now requests strict function calling on the Chat Completions
  surface too (each tool is sent with `function.strict: true`), not only on the Responses surface. This
  matters for every provider created with a `baseURL`, which defaults to Chat Completions. With
  `strictTools` off the request is unchanged. `convertToOpenAICompatibleTools` accepts an optional
  `{ strict }` argument.
- 57280bf: Every published package now declares `"engines": { "node": ">=22.12.0" }`. Before, 27 of the 38
  packages declared no floor (`agent-core`, `agent-tools` and every provider among them),
  `agent-session` and `agent-file-authority` declared `>=20.19.0`, and the other nine declared
  `>=22.0.0`, so a consumer on Node 20 saw at most a warning from a transitive dependency.

  Why 22.12: `agent-cli` and `agent-ui-terminal` need Node 22 through `ink` 7, and the CommonJS entries
  of `agent-tools` and its dependents, `agent-transport`/`node` and its dependents, and
  `agent-ui-terminal` `require()` ESM-only dependencies (`p-limit`, `jose`, `chalk`), which Node 22
  supports unflagged only from 22.12. `engines` is advisory unless the consumer enables `engine-strict`.

  No code changes: `tsdown` now reads `node22.12.0` as its build target from the field.

- 643effb: Aborting a run now cancels the provider's HTTP request on every call path. The non-streaming
  `chat()` request — the one a forced end-of-round summary makes — sent no `AbortSignal` on OpenAI
  Chat Completions, DeepSeek, Qwen (Chat Completions) and Gemma, so an aborted run left that request
  running to completion; the same held for `chatStream()` on DeepSeek, Qwen (Chat Completions), Gemma
  and Anthropic. Each now hands the call's `signal` to the SDK request.
- 18c0d5c: Every published package now exports `./package.json`, so `require('<package>/package.json')` and
  `import('<package>/package.json', { with: { type: 'json' } })` work instead of failing with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`, and each tarball now ships the package's `CHANGELOG.md`.
- Updated dependencies [e689c8e]
- Updated dependencies [be0e53c]
- Updated dependencies [8bd5fac]
- Updated dependencies [274328f]
- Updated dependencies [57280bf]
- Updated dependencies [5033dd9]
- Updated dependencies [643effb]
- Updated dependencies [18c0d5c]
- Updated dependencies [dbd888d]
- Updated dependencies [1887e54]
  - @robota-sdk/agent-core@3.0.0-beta.83
  - @robota-sdk/agent-provider-openai-compatible@3.0.0-beta.83

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
