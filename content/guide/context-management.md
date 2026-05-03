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

The `text_delta` event provides real-time text as the model generates it:

```typescript
import { InteractiveSession } from '@robota-sdk/agent-sdk';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });

const session = new InteractiveSession({ cwd: process.cwd(), provider });
session.on('text_delta', (delta) => process.stdout.write(delta));
```

The `complete` event carries the final response after streaming finishes.

### Web Search

Provider-side web tools are distinct from Robota local tools. Anthropic supports server-side web search (`web_search_20250305`) through provider-native capability configuration, and `onServerToolUse` fires when search executes. Qwen supports provider-side `web_search` and `web_extractor` through `builtInWebTools`; those hosted tools record provenance in assistant-message metadata and do not bypass local Robota permission checks. OpenAI-compatible local endpoints such as LM Studio are treated as custom function-tool capable, not provider-native web search/fetch capable, unless a concrete provider package documents and enables that hosted capability. Use Robota local `WebSearch` and `WebFetch` tools for explicit local-tool web access with those endpoints.

## Abort

Cancel a running `InteractiveSession.submit()` via AbortSignal:

```typescript
session.abort(); // Triggers AbortSignal, cancels streaming
```

The AbortSignal flows through the entire execution chain: `InteractiveSession` calls `Session.run()`, `Session.run()` passes the signal to `Robota.run()`, and `Robota.run()` passes it to the provider. `AbstractAIProvider.streamWithAbort()` provides a standard streaming wrapper that all providers use to handle abort — when the signal fires, the provider returns partial content with `stopReason: 'aborted'`. The partial response is committed to history with `state: 'interrupted'`.
