# Context Management

## Token Tracking

`ContextWindowTracker` (in `agent-sessions`) accumulates input token counts from provider response metadata after each `run()` call.

```typescript
const state = session.getContextState();
// { maxTokens: 200000, usedTokens: 85000, usedPercentage: 42.5, remainingPercentage: 57.5 }
```

### Model Context Sizes

| Model                         | Context Window   |
| ----------------------------- | ---------------- |
| Claude Sonnet 4.6 / Haiku 4.5 | 200,000 tokens   |
| Claude Opus 4.6               | 1,000,000 tokens |

## Compaction

When the context window fills up, Robota compresses the conversation by generating an LLM summary.

### Auto-Compaction

Triggers at ~83.5% of the model's context window. The sequence:

1. `PreCompact` hook fires
2. Full conversation history sent to LLM with summarization prompt
3. History cleared and replaced with `[Context Summary]` message
4. Token tracking resets
5. `PostCompact` hook fires with the summary
6. `onCompact` callback notifies the UI

### Manual Compaction

```typescript
await session.compact('Focus on the API design decisions');
```

CLI: `/compact focus on API changes`

### Compact Instructions

CLAUDE.md can define a "Compact Instructions" section. These instructions are automatically extracted during context loading and included in the compaction prompt to preserve project-specific context.

## Streaming

The `onTextDelta` callback provides real-time text as the model generates it:

```typescript
const session = createSession({
  config,
  context,
  terminal,
  onTextDelta: (delta) => process.stdout.write(delta),
});
```

The completed response is returned by `session.run()` after streaming finishes.

### Web Search

The Anthropic provider supports server-side web search (`web_search_20250305`). When `enableWebTools` is set on the provider instance, the model can search the web during response generation. The `onServerToolUse` callback fires when search executes.

## Abort

Cancel a running `session.run()`:

```typescript
session.abort(); // Rejects run() with AbortError
```

Note: The underlying provider API call is not cancelled — the abort only rejects the Session-level promise.
