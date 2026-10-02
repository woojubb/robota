# Context Management

Every model has a context window — the number of tokens it can read in one request. A session sends
its whole conversation on every turn, so the conversation eventually outgrows the window. This page
explains how an Robota session tracks usage, compacts the conversation before it overflows, and what
happens when you interrupt a turn.

## Token tracking

`ContextWindowTracker` (in `agent-session`) keeps the session's current usage. After each model
reply it uses the token usage the provider reported. When new user or tool messages have been added
since then, it takes the largest of an estimate from the serialized history, the last reported
usage, and any usage floor the caller supplied — so a large prompt that has not been sent yet is
never hidden behind an older, smaller figure.

```typescript
import type { InteractiveSession } from '@robota-sdk/agent-framework';

declare const session: InteractiveSession;

const state = session.getContextState();
// { maxTokens: 200000, usedTokens: 85000, usedPercentage: 42.5, remainingPercentage: 57.5 }
```

The session emits `context_update` with the same `IContextWindowState` whenever usage changes.

### Model context sizes

The window size comes from the model metadata registry. For the Claude models with built-in
metadata:

| Model                        | Context window   |
| ---------------------------- | ---------------- |
| Claude Sonnet 4.6 / Opus 4.6 | 1,000,000 tokens |
| Claude Haiku 4.5             | 200,000 tokens   |
| Claude Sonnet 4.5 / Opus 4.5 | 200,000 tokens   |

## Compaction

Compaction replaces the conversation with an LLM-written summary, freeing room while keeping what
matters.

### Automatic compaction

Before each new turn, the session checks usage. If it has passed the threshold — about 83.5% of the
context window by default — it compacts first, then runs the turn. The sequence:

1. The `PreCompact` hook runs.
2. The full conversation is sent to the model with a summarization prompt.
3. The history is replaced by a `[Context Summary]` message.
4. Token tracking resets.
5. The `PostCompact` hook runs with the summary.
6. The session emits a `compact` event (`trigger`, and the context state `before` and `after`).

The threshold is adjustable: the `autoCompactThreshold` setting takes a fraction between 0 and 1, or
`false` to turn automatic compaction off, and `session.setAutoCompactThreshold()` changes it for a
running session.

As a last resort, `agent-core` checks capacity before every model call. Past 95% of the context
window it does not send the request; it adds a notice to the conversation with the measured usage
and a hint to reduce the history, instead of sending a request the provider would reject.

### Manual compaction

```typescript
import type { InteractiveSession } from '@robota-sdk/agent-framework';

declare const session: InteractiveSession;

await session.compactContext('Focus on the API design decisions');
```

The optional argument adds instructions to the summarization prompt. In the `__PRODUCT_CLI_NAME__` CLI the same
thing is `/compact focus on API changes`.

### Compact Instructions

A `CLAUDE.md` file can contain a heading named "Compact Instructions". The section under it is
extracted when project context is loaded and added to every compaction prompt, so project-specific
details survive compaction. Project files are read only when the session has trusted project access
(see [Project context and settings](./sdk.md#project-context-and-settings)).

## Streaming

The `text_delta` event delivers reply text as the model generates it; `complete` carries the final
result when the turn ends. The full event list is in [Using the SDK](./sdk.md#events).

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });

const session = new InteractiveSession({ cwd: process.cwd(), provider });
session.on('text_delta', (delta) => process.stdout.write(delta));
session.on('complete', (result) => console.log(`\n${result.contextState.usedPercentage}% used`));
```

## Aborting a turn

```typescript
import type { InteractiveSession } from '@robota-sdk/agent-framework';

declare const session: InteractiveSession;

session.abort();
```

`abort()` fires an `AbortSignal` that travels down the whole chain: `InteractiveSession` →
`Session.run()` → `Robota.run()` → the provider, which stops reading its response stream. The text
received so far is committed to the history with `state: 'interrupted'`, the session emits
`interrupted` with the partial result, and the next request tells the model that its previous reply
was cut off. `abort()` also clears any prompts waiting in the queue.
