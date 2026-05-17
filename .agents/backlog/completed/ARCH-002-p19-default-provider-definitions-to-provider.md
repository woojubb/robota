---
title: 'ARCH-002-p19: Move DEFAULT_PROVIDER_DEFINITIONS to agent-provider'
status: done
---

# ARCH-002-p19: Move DEFAULT_PROVIDER_DEFINITIONS to agent-provider

## Problem

`packages/agent-cli/src/utils/provider-default-definitions.ts` (16 lines) assembles the
standard set of all `IProviderDefinition` instances from every `@robota-sdk/agent-provider/*`
sub-path:

```typescript
export const DEFAULT_PROVIDER_DEFINITIONS: readonly IProviderDefinition[] = [
  createAnthropicProviderDefinition(),
  createOpenAIProviderDefinition(),
  createGeminiProviderDefinition(),
  createGemmaProviderDefinition(),
  createQwenProviderDefinition(),
  createDeepSeekProviderDefinition(),
];
```

This has **zero CLI-specific type dependencies** — it uses only `IProviderDefinition` from
`agent-core` and factory functions from `agent-provider/*` sub-paths.

Per CLI-AUDIT-009: the decision of "which providers are available by default" is a provider
package concern, not a CLI concern. `agent-provider` already re-exports all providers from its
root `index.ts`. A `createDefaultProviderDefinitions()` factory belongs there.

Additionally, `child-process-subagent-worker.ts` in agent-cli also imports
`DEFAULT_PROVIDER_DEFINITIONS` — if this constant lives in agent-provider, the worker can
import it directly without a CLI-scoped utility file.

## Fix

1. Add to `packages/agent-provider/src/index.ts`:
   ```typescript
   export function createDefaultProviderDefinitions(): readonly IProviderDefinition[] {
     return [
       createAnthropicProviderDefinition(),
       createOpenAIProviderDefinition(),
       createGeminiProviderDefinition(),
       createGemmaProviderDefinition(),
       createQwenProviderDefinition(),
       createDeepSeekProviderDefinition(),
     ];
   }
   ```
2. Update all callers in `agent-cli` to import `createDefaultProviderDefinitions` from
   `@robota-sdk/agent-provider` and call it where needed.
3. Delete `packages/agent-cli/src/utils/provider-default-definitions.ts`.
4. Build and typecheck both packages; run tests.

## Architecture map update

- Add `CLI-AUDIT-020` to layering-audit.md (new finding, immediately resolved)
