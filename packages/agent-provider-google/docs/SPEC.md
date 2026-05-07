# Google Provider Compatibility Specification

## Scope

This package is a compatibility wrapper for the canonical `@robota-sdk/agent-provider-gemini` package. It exists to preserve existing imports from `@robota-sdk/agent-provider-google` during the documented migration window.

## Boundaries

- Does not own Gemini API transport, message conversion, image operations, provider defaults, or provider-definition metadata. Those belong to `agent-provider-gemini`.
- Does not add CLI, SDK, or provider-name-specific branches.
- Does not duplicate Gemini implementation code.
- Does not own native replay payload capture mechanics. It inherits `agent-provider-gemini` behavior and only changes the compatibility provider label to `google`.

## Architecture Overview

```
src/
  index.ts               # public compatibility exports
  provider.ts            # GoogleProvider compatibility subclass
  provider-definition.ts # canonical Gemini provider definition re-export
  types.ts               # Google-named type aliases
```

## Type Ownership

| Type                         | Location          | Purpose                                                            |
| ---------------------------- | ----------------- | ------------------------------------------------------------------ |
| `IGoogleProviderOptions`     | `src/types.ts`    | Deprecated alias of `IGeminiProviderOptions`.                      |
| `TGoogleProviderOptionValue` | `src/types.ts`    | Deprecated alias of `TGeminiProviderOptionValue`.                  |
| `GoogleProvider`             | `src/provider.ts` | Compatibility subclass of `GeminiProvider` with `name = "google"`. |

## Public API Surface

| Export                           | Kind       | Description                              |
| -------------------------------- | ---------- | ---------------------------------------- |
| `GoogleProvider`                 | class      | Deprecated compatibility provider class. |
| `createGeminiProviderDefinition` | function   | Re-export from `agent-provider-gemini`.  |
| `DEFAULT_GEMINI_PROVIDER_MODEL`  | constant   | Re-export from `agent-provider-gemini`.  |
| `IGoogleProviderOptions`         | interface  | Deprecated compatibility alias.          |
| `TGoogleProviderOptionValue`     | type alias | Deprecated compatibility alias.          |

## Extension Points

None. New behavior must be added to `agent-provider-gemini`, not this wrapper.

## Native Replay Payload Capture

`GoogleProvider` inherits Gemini native replay payload capture. When `IChatOptions.onProviderNativeRawPayload` is provided, emitted events use `provider: "google"` and the same Google GenAI request/response/stream payload objects documented by `agent-provider-gemini`.

## Test Strategy

- Unit tests verify `GoogleProvider` remains constructible from this package.
- Unit tests verify `GoogleProvider` is backed by `GeminiProvider` behavior and keeps the compatibility `name` value.
- Unit tests verify the re-exported provider definition preserves canonical `type: "gemini"` and `google` alias metadata.

## Class Contract Registry

### Inheritance Chains

| Base (Owner)                             | Derived          | Location          | Notes                         |
| ---------------------------------------- | ---------------- | ----------------- | ----------------------------- |
| `GeminiProvider` (agent-provider-gemini) | `GoogleProvider` | `src/provider.ts` | Compatibility import surface. |

### Cross-Package Port Consumers

| Port (Owner)                   | Adapter          | Location          |
| ------------------------------ | ---------------- | ----------------- |
| Gemini provider implementation | `GoogleProvider` | `src/provider.ts` |
