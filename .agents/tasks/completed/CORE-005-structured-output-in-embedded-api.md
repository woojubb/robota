---
title: 'CORE-005: responseFormat end-to-end wiring — IAgentConfig → IChatOptions → provider'
status: done
done_at: 2026-05-25
pr: '616'
created: 2026-05-25
priority: medium
urgency: later
area: packages/agent-core, packages/agent-session, packages/agent-framework, packages/agent-provider
depends_on: []
---

## Background

`IAgentConfig.responseFormat?: IResponseFormatConfig` exists in agent-core's type interface,
but is **not wired into the execution path**. The field is declared but unused.

The actual execution path (`execution-stream.ts`) builds `IChatOptions` with only `model`
and `tools` — `responseFormat` is never passed. The OpenAI provider reads `responseFormat`
from its static `providerOptions` (provider-level config), not from per-call `IChatOptions`.

For batch processing (EX-006) and data-extraction pipelines to reliably receive structured
JSON, the full chain must be implemented.

## Corrected Architectural Analysis (post-investigation)

```
agent-core/src/interfaces/provider.ts  → IChatOptions: NO responseFormat field (gap)
agent-core/src/services/execution-stream.ts
  chatOptions = { model, tools }        → responseFormat never read from IAgentConfig (gap)

agent-provider/src/openai/             → reads providerOptions.responseFormat (static, not per-call)
agent-provider/src/anthropic/          → needs investigation
```

Original backlog assumption ("just wire through the assembly chain") was incorrect.
The gap is in agent-core's execution layer, not only in the assembly API surface.

## Full Change Scope (9 files across 4 packages)

### 1. `packages/agent-core/src/interfaces/provider.ts`

Add `responseFormat` to `IChatOptions`:

```typescript
export interface IChatOptions extends IProviderSpecificOptions {
  // ...existing...
  /** Request structured output. Providers map this to their native format. */
  responseFormat?: { type: 'text' | 'json_object' };
}
```

### 2. `packages/agent-core/src/services/execution-stream.ts`

Pass `config.responseFormat` to `chatOptions`:

```typescript
const chatOptions: IChatOptions = {
  model: config.defaultModel.model,
  ...(config.tools && config.tools.length > 0 && { tools: tools.getTools() }),
  ...(config.responseFormat ? { responseFormat: config.responseFormat } : {}),
};
```

(Same in `execution-round-provider.ts` if it builds `chatOptions` independently.)

### 3. `packages/agent-provider-openai/src/openai/chat-completions-chat.ts`

Read `responseFormat` from per-call `chatOptions` first, fall back to provider config:

```typescript
const responseFormat = buildOpenAIChatResponseFormat(
  input.chatOptions?.responseFormat ?? input.providerOptions,
);
```

### 4. `packages/agent-session/src/session-types.ts`

Add `responseFormat?: IResponseFormatConfig` to `ISessionOptions`.

### 5. `packages/agent-session/src/session-components.ts` (`buildRobota`)

Pass `options.responseFormat` to `agentConfig.responseFormat`.

### 6. `packages/agent-framework/src/assembly/create-session-types.ts`

Add `responseFormat?: { type: 'text' | 'json_object' }` to `ICreateSessionOptions`.

### 7. `packages/agent-framework/src/assembly/create-session.ts`

Pass `responseFormat` to `new Session({ ..., responseFormat })`.

### 8. `packages/agent-framework/src/runtime/agent-runtime.ts`

Add `responseFormat` to `IHeadlessSessionOptions`, thread to `InteractiveSession`.

### 9. `packages/agent-framework/src/query.ts`

Add `responseFormat` to `ICreateQueryOptions`, thread to `InteractiveSession`.

## Non-Goals

- Anthropic JSON mode (not the same as OpenAI) — investigate separately
- `json_schema` mode (requires schema field, different from `json_object`) — out of scope here

## Test Plan

- `createQuery({ responseFormat: { type: 'json_object' } })` → `JSON.parse(result)` succeeds
- `createStatelessRuntime` session with `responseFormat` → structured JSON response
- `pnpm test` across all affected packages passes
