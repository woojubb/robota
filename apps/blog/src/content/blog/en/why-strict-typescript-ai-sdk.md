---
title: 'Why We Built a Strict TypeScript AI Agent SDK (and Banned `any`)'
subtitle: 'Type safety is not a style preference — it is a production requirement'
date: '2026-05-18'
author: 'Jung Youn Hwang'
authorUrl: 'https://github.com/woojubb'
lang: 'en'
---

When we started Robota SDK, we made one rule that caused the most friction during development:

**No `any` in production code. Ever.**

This single rule shaped the entire architecture. Here is why we did it, what it cost us, and what we got in return.

## The Problem with `any` in AI Tooling

AI agent SDKs involve a lot of unstructured data — JSON from APIs, tool call arguments, provider responses, event payloads. The easiest path is to type everything as `any` and move fast.

The problem surfaces when you add your second AI provider. Suddenly you discover that Anthropic's tool call format differs from OpenAI's. The `any` types that "worked" now silently swallow the difference. Your agent produces wrong results in production with no compile-time warning.

We saw this pattern in every major AI SDK we evaluated. TypeScript in name only.

## Zod-Based Tool Schemas

The most visible consequence of the `any` ban is in tool definitions. Robota uses [Zod](https://zod.dev/) for every tool schema:

```typescript
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { z } from 'zod';

const searchTool = createZodFunctionTool(
  'search_codebase',
  'Search for symbols or strings in the project',
  z.object({
    query: z.string().describe('Search term or regex pattern'),
    filePattern: z.string().optional().describe('Glob pattern to limit search scope'),
    caseSensitive: z.boolean().default(false),
  }),
  async ({ query, filePattern, caseSensitive }) => {
    // query is string, filePattern is string | undefined, caseSensitive is boolean
    // All typed. All validated before reaching your handler.
    const results = await searchFiles(query, { filePattern, caseSensitive });
    return { data: JSON.stringify(results) };
  },
);
```

The schema is used for three things automatically:

1. **AI provider serialization** — converted to the correct JSON Schema format for Anthropic, OpenAI, or any other provider
2. **Runtime validation** — tool arguments are validated against the schema before your handler runs
3. **TypeScript types** — your handler parameters are inferred directly from the Zod schema

If you add a required field to the schema, TypeScript will tell you every place in the codebase that needs to be updated. No runtime surprises.

## Typed Provider Interfaces

Every AI provider in Robota implements `IAIProvider`. The interface is strict:

```typescript
interface IAIProvider {
  readonly name: string;
  createCompletion(request: ICompletionRequest): Promise<ICompletionResponse>;
  createCompletionStream(request: ICompletionRequest): AsyncIterable<IStreamChunk>;
  isAvailable(): Promise<boolean>;
}
```

Provider responses are normalized to `ICompletionResponse` before they reach your agent. Anthropic's content block format and OpenAI's choices array are both hidden behind the same interface. You never write provider-specific parsing code in agent logic.

## Strict Discriminated Unions for Events

Robota emits typed events throughout the session lifecycle. Instead of `event.type === 'any string'`, every event is a discriminated union:

```typescript
type SessionEvent =
  | { kind: 'text_delta'; delta: string }
  | { kind: 'tool_start'; toolName: string; toolUseId: string; input: unknown }
  | { kind: 'tool_end'; toolUseId: string; result: IToolResult }
  | { kind: 'thinking'; text: string }
  | { kind: 'context_update'; state: TContextState }
  | { kind: 'complete'; response: string }
  | { kind: 'error'; error: Error };
```

TypeScript exhaustiveness checking catches unhandled event types at compile time. When we added the `thinking` event for Claude's extended thinking feature, the compiler immediately flagged every event handler that needed to be updated.

## What It Cost

The `any` ban added real friction. Writing proper types for every edge case in AI provider responses took weeks. We rewrote the provider normalization layer three times before the types felt right.

The plugin system required careful generic constraints. The session history type required careful thinking about append-only semantics. The transport layer required careful interface design for the attach/start/stop lifecycle.

We also caught genuine bugs this way. A type error in the tool serialization layer revealed that we were generating incorrect JSON Schema for optional Zod fields — something that would have been a silent wrong behavior with `any`.

## What We Got

A codebase where you can make significant architectural changes and trust the compiler to find the breakage. When we refactored the provider layer in v3.0.0, the TypeScript compiler pointed us to 47 call sites that needed updating. Every one was a real issue. None slipped through to production.

For teams adopting Robota in production codebases, this matters. Code review becomes easier. Onboarding new engineers takes less time. The contract between layers is enforced by the type system, not by convention and discipline.

---

Robota SDK is open source under the AGPL-3.0 (with a commercial license available). If this approach resonates with you, [try it out](https://robota.io/getting-started/) or [contribute on GitHub](https://github.com/woojubb/robota).
