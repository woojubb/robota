# DeepSeek API Provider Support

## Status

Completed.

## Priority

P2 - useful first-class provider coverage for an OpenAI-compatible API with provider-owned model
metadata and capability defaults.

## Problem

Robota could call DeepSeek through a manually configured OpenAI-compatible endpoint, but that left
provider setup, model catalog metadata, default API key environment names, capability labels,
deprecation handling, and provider-specific options outside the provider-definition layer.

## Research

Official DeepSeek API documentation says the API is compatible with OpenAI and Anthropic formats.
The documented OpenAI-format base URL is `https://api.deepseek.com`; the documented Anthropic-format
base URL is `https://api.deepseek.com/anthropic`. Authentication uses a DeepSeek API key.

Current documented model identifiers are:

- `deepseek-v4-flash`
- `deepseek-v4-pro`
- `deepseek-chat` (deprecated on 2026-07-24; compatibility alias for non-thinking
  `deepseek-v4-flash`)
- `deepseek-reasoner` (deprecated on 2026-07-24; compatibility alias for thinking
  `deepseek-v4-flash`)

The model page documents JSON output and tool calls for current models. The `/models` endpoint
returns currently available model identifiers and is used by the provider's model catalog refresh
adapter.

Sources:

- <https://api-docs.deepseek.com/>
- <https://api-docs.deepseek.com/quick_start/pricing>
- <https://api-docs.deepseek.com/api/list-models>
- <https://api-docs.deepseek.com/guides/thinking_mode>
- <https://api-docs.deepseek.com/guides/function_calling>

## Recommended Direction

Create a first-class `@robota-sdk/agent-provider-deepseek` package that composes
`agent-provider-openai-compatible` for the initial OpenAI-compatible Chat Completions path.

Implemented scope:

- Provider type: `deepseek`
- Default model: `deepseek-v4-flash`
- Default API key env: `DEEPSEEK_API_KEY`
- Default OpenAI-compatible base URL: `https://api.deepseek.com`
- Provider-owned fallback model catalog with source metadata and deprecation notes
- Live model catalog refresh using `GET /models`
- Provider-owned setup labels and validation through `IProviderDefinition`
- Provider-owned option mapping for DeepSeek thinking mode and reasoning effort

Out of initial scope:

- DeepSeek Anthropic-format API transport. This remains future work unless it provides capabilities
  the OpenAI-compatible path cannot cover.
- Generic CLI or SDK branches for DeepSeek. All provider-specific behavior stays inside the
  DeepSeek provider package.

## Acceptance Criteria

- [x] `@robota-sdk/agent-provider-deepseek` owns DeepSeek defaults, model catalog, setup steps, and
      error framing.
- [x] The provider composes OpenAI-compatible transport primitives instead of duplicating shared
      conversion and streaming logic.
- [x] CLI default provider definitions include DeepSeek without adding provider-name branches to
      generic provider resolution.
- [x] SDK and CLI docs show DeepSeek profile setup using `DEEPSEEK_API_KEY`.
- [x] Deprecated aliases (`deepseek-chat`, `deepseek-reasoner`) are represented as deprecated
      catalog entries with the official 2026-07-24 date.
- [x] Build, targeted provider tests, CLI provider tests, docs build, and harness verification pass.

## Result

Added `packages/agent-provider-deepseek` as a first-class provider package, wired it into the default
CLI provider definition list, documented the provider contract, and added provider/CLI tests.

## User Execution Test Scenarios

**Prerequisites:** `pnpm build` (agent-provider-deepseek and agent-cli dist must exist)

**Setup:** No API key required. Demo script uses `@robota-sdk/agent-provider-deepseek` public API and agent-cli compiled output directly.

**Scenarios:**

1. `createDeepSeekProviderDefinition()` returns correct type, displayName, defaults (model, apiKey env, baseURL), requiresApiKey, and model catalog entries (active + deprecated aliases)
2. `DEFAULT_PROVIDER_DEFINITIONS` in agent-cli contains a DeepSeek entry as the last provider

**Command:**

```
node scripts/examples/deepseek-provider-demo.mjs
```

**Expected observable result:**

```
=== Scenario 1: createDeepSeekProviderDefinition() returns correct definition ===

  type: deepseek
  displayName: DeepSeek
  defaults.model: deepseek-v4-flash
  defaults.apiKey: $ENV:DEEPSEEK_API_KEY
  defaults.baseURL: https://api.deepseek.com
  requiresApiKey: true
  modelCatalog.entries: deepseek-v4-flash, deepseek-v4-pro, deepseek-chat, deepseek-reasoner
  type === "deepseek": YES ✓
  displayName === "DeepSeek": YES ✓
  defaults.model === "deepseek-v4-flash": YES ✓
  defaults.apiKey references DEEPSEEK_API_KEY: YES ✓
  defaults.baseURL === "https://api.deepseek.com": YES ✓
  requiresApiKey === true: YES ✓
  model catalog has active deepseek-v4-flash: YES ✓
  model catalog has active deepseek-v4-pro: YES ✓
  deprecated alias deepseek-chat present: YES ✓
  deprecated alias deepseek-reasoner present: YES ✓

=== Scenario 2: DeepSeek is in CLI DEFAULT_PROVIDER_DEFINITIONS ===

  provider types in DEFAULT_PROVIDER_DEFINITIONS: anthropic, openai, gemini, gemma, qwen, deepseek
  DEFAULT_PROVIDER_DEFINITIONS exists: YES ✓
  deepseek entry present in DEFAULT_PROVIDER_DEFINITIONS: YES ✓
  deepseek is last in the list (after openai, gemini, qwen): YES ✓
  deepseek displayName === "DeepSeek": YES ✓

PASS — DeepSeek provider SDK package and CLI integration are correctly implemented.
```

**Cleanup:** No state to clean up.

## Execution Evidence (2026-05-10)

**Command executed:**

```
node scripts/examples/deepseek-provider-demo.mjs
```

**Actual output:**

```
=== Scenario 1: createDeepSeekProviderDefinition() returns correct definition ===

  type: deepseek
  displayName: DeepSeek
  defaults.model: deepseek-v4-flash
  defaults.apiKey: $ENV:DEEPSEEK_API_KEY
  defaults.baseURL: https://api.deepseek.com
  requiresApiKey: true
  modelCatalog.entries: deepseek-v4-flash, deepseek-v4-pro, deepseek-chat, deepseek-reasoner
  type === "deepseek": YES ✓
  displayName === "DeepSeek": YES ✓
  defaults.model === "deepseek-v4-flash": YES ✓
  defaults.apiKey references DEEPSEEK_API_KEY: YES ✓
  defaults.baseURL === "https://api.deepseek.com": YES ✓
  requiresApiKey === true: YES ✓
  model catalog has active deepseek-v4-flash: YES ✓
  model catalog has active deepseek-v4-pro: YES ✓
  deprecated alias deepseek-chat present: YES ✓
  deprecated alias deepseek-reasoner present: YES ✓

=== Scenario 2: DeepSeek is in CLI DEFAULT_PROVIDER_DEFINITIONS ===

  provider types in DEFAULT_PROVIDER_DEFINITIONS: anthropic, openai, gemini, gemma, qwen, deepseek
  DEFAULT_PROVIDER_DEFINITIONS exists: YES ✓
  deepseek entry present in DEFAULT_PROVIDER_DEFINITIONS: YES ✓
  deepseek is last in the list (after openai, gemini, qwen): YES ✓
  deepseek displayName === "DeepSeek": YES ✓

PASS — DeepSeek provider SDK package and CLI integration are correctly implemented.
```

**Exit code:** 0

**Observed result matches expected:** YES

## Verification Plan

- `pnpm --filter @robota-sdk/agent-provider-deepseek test`
- `pnpm --filter @robota-sdk/agent-provider-deepseek typecheck`
- `pnpm --filter @robota-sdk/agent-provider-deepseek lint`
- `pnpm --filter @robota-sdk/agent-provider-deepseek build`
- `pnpm --filter @robota-sdk/agent-cli test -- provider`
- `pnpm docs:build`
- `pnpm harness:verify -- --base-ref origin/develop --skip-record-check`
