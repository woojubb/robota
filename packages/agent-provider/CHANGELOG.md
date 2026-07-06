# @robota-sdk/agent-provider

## 3.0.0-beta.79

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.79

## 3.0.0-beta.78

### Patch Changes

- 6f308d1: fix(streaming): expose token usage on the streaming execution path (BEHAVIOR-005)

  Token usage was silently dropped on streaming turns, so `readTokenUsageFromMessage` and robota's usage analytics returned empty/0 for every `run()`/`runStream()` (which always stream). OpenAI-compatible streaming requests now send `stream_options: { include_usage: true }`, the stream assembler and the `runStream` commit path attach the same top-level `usage` shape the non-streaming path already emits, and both `run()` and `runStream()` now expose usage. New opt-out `IOpenAIProviderOptions.includeStreamUsage` (default `true`) for OpenAI-compatible servers that reject `stream_options`.

- Updated dependencies [6f308d1]
  - @robota-sdk/agent-core@3.0.0-beta.78

## 3.0.0-beta.77

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.77

## 3.0.0-beta.76

### Patch Changes

- DQ-AUDIT-006 — error/observability hygiene: replace raw `throw new Error()` on core-service and provider hot paths with typed `RobotaError` subclasses (`ConfigurationError`/`ValidationError`) so error-handling can branch on category/recoverable; surface fire-and-forget hook failures via `logger.warn` instead of silent `.catch(() => {})`; wire the error-handling plugin's `totalRetries`/`successfulRecoveries` stats to real counters.
- DQ-AUDIT-007 — remove the silent `model || 'gpt-4o-mini'` default in the OpenAI streaming handler (a missing model now throws `ConfigurationError` instead of substituting a vendor default); document `IAIProvider`'s universal (`chat`) vs raw (`generateResponse`) dual surface as intentional in the agent-core SPEC.
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies [576af62]
  - @robota-sdk/agent-core@3.0.0-beta.76

## 3.0.0-beta.75

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.75

## 3.0.0-beta.74

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.74

## 3.0.0-beta.73

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.73

## 3.0.0-beta.72

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.72

## 3.0.0-beta.71

### Patch Changes

- fix(context): unify token estimation to single SSOT — status bar and /context list now use the same serialized JSON estimate
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.71

## 3.0.0-beta.70

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.70

## 3.0.0-beta.69

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.69

## 3.0.0-beta.68

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.68

## 3.0.0-beta.67

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.67

## 3.0.0-beta.66

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.66

## 3.0.0-beta.65

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.65

## 3.0.0-beta.64

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.64
