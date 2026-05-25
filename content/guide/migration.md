---
title: Migrating to 3.0.0
description: Step-by-step guide for upgrading from Robota SDK v2.x to 3.0.0.
---

# Migrating to 3.0.0

This guide covers every breaking change between v2.x and 3.0.0 and provides concrete
before/after examples for each one.

> **Note:** 3.0.0 is a significant overhaul. Most changes are mechanical renames that
> TypeScript will catch at compile time once you update your imports.

---

## What Changed in 3.0.0 — Summary

| Area           | What changed                                                            |
| -------------- | ----------------------------------------------------------------------- |
| Type naming    | All interfaces prefixed `I*`, type aliases prefixed `T*`                |
| Class rename   | `BaseAIProvider` → `AbstractAIProvider`                                 |
| Module path    | `Robota` internal path change (transparent for published package users) |
| Removed alias  | `FunctionSchema` alias for `ToolSchema` removed                         |
| Package rename | Provider sub-packages consolidated under `@robota-sdk/agent-provider/*` |
| agent-session  | Major rewrite — several classes removed                                 |
| agent-team     | Architecture change to relay-tool model                                 |

---

## Package Renames

### Provider packages

In v2.x, each provider was its own npm package:

```
@robota-sdk/agent-provider-anthropic
@robota-sdk/agent-provider-openai
@robota-sdk/agent-provider-google
@robota-sdk/agent-provider-deepseek
```

In 3.0.0, all providers are sub-path exports of a single package:

```
@robota-sdk/agent-provider/anthropic
@robota-sdk/agent-provider/openai
@robota-sdk/agent-provider/gemini
@robota-sdk/agent-provider/deepseek
@robota-sdk/agent-provider/qwen
@robota-sdk/agent-provider/gemma
```

Update your `package.json`:

```diff
-  "@robota-sdk/agent-provider-anthropic": "^2.x",
-  "@robota-sdk/agent-provider-openai": "^2.x",
-  "@robota-sdk/agent-provider-google": "^2.x",
+  "@robota-sdk/agent-provider": "^3.0.0",
```

Then install:

```bash
pnpm install
# or
npm install
```

---

## Import Path Changes

### Anthropic provider

```typescript
// v2.x
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

// 3.0.0
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';
```

### OpenAI provider

```typescript
// v2.x
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

// 3.0.0
import { OpenAIProvider } from '@robota-sdk/agent-provider/openai';
```

### Gemini / Google provider

```typescript
// v2.x
import { GeminiProvider } from '@robota-sdk/agent-provider-google';

// 3.0.0
import { GeminiProvider } from '@robota-sdk/agent-provider/gemini';
```

### DeepSeek provider

```typescript
// v2.x
import { DeepSeekProvider } from '@robota-sdk/agent-provider-deepseek';

// 3.0.0
import { DeepSeekProvider } from '@robota-sdk/agent-provider/deepseek';
```

---

## API Renames

### Type naming convention

All public interfaces now use the `I*` prefix and all type aliases use the `T*` prefix.
The TypeScript compiler will flag every usage at build time.

| v2.x name               | 3.0.0 name               |
| ----------------------- | ------------------------ |
| `ToolSchema`            | `IToolSchema`            |
| `ProviderOptions`       | `IProviderOptions`       |
| `AgentConfig`           | `IAgentConfig`           |
| `AgentTemplate`         | `IAgentTemplate`         |
| `ToolCall`              | `IToolCall`              |
| `UserMessage`           | `IUserMessage`           |
| `SystemMessage`         | `ISystemMessage`         |
| `ToolMessage`           | `IToolMessage`           |
| `UniversalMessage`      | `TUniversalMessage`      |
| `ErrorHandlingStrategy` | `TErrorHandlingStrategy` |
| `LimitsStrategy`        | `TLimitsStrategy`        |
| `EventType`             | `TEventName`             |
| `WebhookEventType`      | `TWebhookEventName`      |

Example:

```typescript
// v2.x
import type { ToolSchema, UniversalMessage, AgentConfig } from '@robota-sdk/agent-core';

function buildTool(schema: ToolSchema): void {
  /* ... */
}

// 3.0.0
import type { IToolSchema, TUniversalMessage, IAgentConfig } from '@robota-sdk/agent-core';

function buildTool(schema: IToolSchema): void {
  /* ... */
}
```

### Provider options interface

```typescript
// v2.x
import type { AnthropicProviderOptions } from '@robota-sdk/agent-provider-anthropic';

const options: AnthropicProviderOptions = { apiKey: '...' };

// 3.0.0
import type { IAnthropicProviderOptions } from '@robota-sdk/agent-provider/anthropic';

const options: IAnthropicProviderOptions = { apiKey: '...' };
```

### AbstractAIProvider (custom provider authors only)

If you wrote a custom provider that extends `BaseAIProvider`:

```typescript
// v2.x
import { BaseAIProvider } from '@robota-sdk/agent-core';

export class MyProvider extends BaseAIProvider {
  // ...
}

// 3.0.0
import { AbstractAIProvider } from '@robota-sdk/agent-core';

export class MyProvider extends AbstractAIProvider {
  // ...
}
```

### Removed alias: FunctionSchema

The `FunctionSchema` alias for `IToolSchema` was removed:

```typescript
// v2.x — still worked
import { ToolSchema as FunctionSchema } from '@robota-sdk/agent-core';

// 3.0.0 — use IToolSchema directly
import type { IToolSchema } from '@robota-sdk/agent-core';
```

---

## Removed Classes and Replacements

### agent-session package

The v2.x session package has been rewritten. If you used these classes directly, migrate
to the new alternatives:

| Removed (v2.x)                | Replacement (3.0.0)             |
| ----------------------------- | ------------------------------- |
| `ConversationServiceImpl`     | `SessionManager`                |
| `SystemMessageManagerImpl`    | `SessionManager`                |
| `MultiProviderAdapterManager` | `SessionManager`                |
| `ContextManager`              | Built into `SessionManager`     |
| `ProviderManager`             | Agent-level `aiProviders` array |
| `EnhancedConversationHistory` | `SessionManager` history        |

Message editing and deletion methods have been removed. Conversation history is now
append-only, which eliminates a class of state management bugs.

### agent-team package

The `TeamContainer` architecture was replaced with a relay-tool model.

```typescript
// v2.x
import { createTeam, TeamContainer } from '@robota-sdk/agent-team';

const team = createTeam({ agents: [...], coordinator: myAgent });

// 3.0.0 — use relay tools
import { createAssignTaskRelayTool } from '@robota-sdk/agent-team';

const assignTool = createAssignTaskRelayTool({ /* ... */ });
agent.addTool(assignTool);
```

Refer to the [agent-team package SPEC.md](../../packages/agent-team/docs/SPEC.md) for
the full relay-tool architecture.

---

## Step-by-Step Upgrade Instructions

### 1. Update package dependencies

```bash
# Remove old separate provider packages
npm uninstall @robota-sdk/agent-provider-anthropic \
              @robota-sdk/agent-provider-openai \
              @robota-sdk/agent-provider-google \
              @robota-sdk/agent-provider-deepseek

# Install 3.0.0 packages
npm install @robota-sdk/agent-core@^3.0.0 \
            @robota-sdk/agent-provider@^3.0.0 \
            @robota-sdk/agent-framework@^3.0.0
```

### 2. Fix provider import paths

Search your codebase for old provider imports and replace:

```bash
# Quick search
grep -r "agent-provider-" src/
```

Update each import to the sub-path form shown in [Import Path Changes](#import-path-changes).

### 3. Run TypeScript compiler to catch type renames

```bash
npx tsc --noEmit
```

The compiler will flag every place you use the old type names (`ToolSchema`,
`UniversalMessage`, `AgentConfig`, etc.). Rename each one using the table in
[API Renames](#api-renames).

### 4. Update custom providers (if applicable)

If you have a custom provider, rename `extends BaseAIProvider` to
`extends AbstractAIProvider` as shown above.

### 5. Verify the build passes

```bash
pnpm build
pnpm test
```

### 6. Check session usage

If you used `ConversationServiceImpl`, `ContextManager`, or `ProviderManager` directly,
migrate to `SessionManager`. See the [SDK guide](./sdk.md) for current session patterns.

---

## Need Help?

- [GitHub Issues](https://github.com/woojubb/robota/issues) — report upgrade problems
- [Getting Started](../getting-started/README.md) — start fresh with 3.0.0 patterns
- [Architecture guide](./architecture.md) — understand the new package structure
