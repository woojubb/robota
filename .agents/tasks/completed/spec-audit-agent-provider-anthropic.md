---
title: 'Spec Audit: agent-provider-anthropic'
status: completed
priority: medium
created: 2026-03-20
packages:
  - agent-provider-anthropic
---

# Spec Audit: agent-provider-anthropic

## Goal

agent-provider-anthropic SPEC.md has behavioral inaccuracies and undocumented public fields.

## Issues Found (8)

### HIGH (3)

1. **AnthropicResponseParser not exported**: Listed in Public API table but not exported from `src/index.ts`.
2. **chatStream() feature gap**: Does not apply `enableWebTools`, system message extraction, or `onServerToolUse` — SPEC treats it as a full peer of `chat()`.
3. **createAnthropicProvider is a void stub**: Returns void/undefined, not an AnthropicProvider instance. Misleadingly described as a "factory function."

### MEDIUM (4)

4. `formatWebSearchResults` described as utility function — actually a private method on AnthropicProvider.
5. Two coexisting response parsers (AnthropicResponseParser vs convertFromAnthropicResponse) with divergent null/empty content behavior — undocumented.
6. `enableWebTools`, `onTextDelta`, `onServerToolUse` are public class fields not documented in Public API or IAnthropicProviderOptions.
7. Local `IAnthropicStreamChunk` type is structurally misaligned with real SDK event shapes; provider uses SDK types directly.

### LOW (1)

8. `validateConfig()` returns false for executor-based providers — undocumented edge case.
