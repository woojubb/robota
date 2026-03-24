# Abort Execution Design

## Goal

Enable users to abort a running AI execution via ESC key, with proper signal propagation through the entire stack: Session → Robota → ExecutionService → Provider → streaming/tools.

## Architecture

AbortSignal is threaded through the entire execution chain. The Session creates an AbortController, passes the signal down through Robota, ExecutionService, and Provider. Each layer checks the signal at appropriate points and performs cleanup. The provider interface defines signal support abstractly; each provider implements it using its SDK's native mechanism.

## Tech Stack

- AbortController / AbortSignal (Web API, available in Node 18+)
- Anthropic SDK `RequestOptions.signal` for streaming abort
- Existing Session.abort() and AbortController (partially implemented)

---

## Signal Propagation Chain

```
User presses ESC
  → App.tsx: session.abort()
  → Session: abortController.abort()
       ↓ signal
  → robota.run(message, { signal })           // IRunOptions.signal
       ↓
  → robotaRun() in robota-execution.ts
       ↓
  → ExecutionService.execute(..., { signal })  // IExecutionContext.signal
       ↓
  ├─ callProviderWithCache(..., { signal })    // passes to IChatOptions.signal
  │   └─ Provider.chat(messages, { signal })
  │       └─ Anthropic: messages.create(params, { signal })
  │           └─ streaming for-await breaks on abort
  └─ ToolExecutionService.executeTools(..., { signal })
      └─ signal passed to parallel tool runner
```

## Interfaces Requiring `signal` Addition

Three interfaces need `signal?: AbortSignal`:

```typescript
// 1. agent-core: IRunOptions (Robota.run() options)
interface IRunOptions {
  signal?: AbortSignal;
  // ...existing fields
}

// 2. agent-core: IExecutionContext (ExecutionService context)
interface IExecutionContext {
  signal?: AbortSignal;
  // ...existing fields
}

// 3. agent-core: IChatOptions (Provider.chat() options)
interface IChatOptions {
  signal?: AbortSignal;
  onTextDelta?: TTextDeltaCallback;
  // ...existing fields
}
```

All additions are optional — backward compatible.

## Provider Interface Contract

AbortSignal support is defined abstractly in agent-core's `IChatOptions`. Each provider implements abort using its SDK's native mechanism.

Provider behavior when `signal` is provided:

- If signal aborts during streaming: stop receiving, return partial content collected so far
- If signal is not provided: existing behavior unchanged (backward compatible)
- Provider does NOT throw AbortError — it returns partial content. The caller (ExecutionService) decides how to handle it.

| Provider        | Internal mechanism                                           |
| --------------- | ------------------------------------------------------------ |
| Anthropic       | `messages.create(params, { signal })` via SDK RequestOptions |
| Google          | `generateContent({ signal })` or manual stream abort         |
| OpenAI (future) | `chat.completions.create({ signal })`                        |

## Abort Handling by Case

### Case 1: Provider streaming abort

Signal aborts while provider is streaming text.

- Provider catches AbortError from SDK, returns partial text collected so far (may be empty string)
- ExecutionService detects `signal.aborted` after provider returns
- If partial content is non-empty: saves as assistant message with `metadata.interrupted = true`
- If partial content is empty: no assistant message saved
- No further rounds executed
- ExecutionService returns `IExecutionResult` with `interrupted: true`

### Case 2: Tool execution abort (parallel)

Signal aborts while tools are executing. Tools run in parallel (`mode: 'parallel'`, `maxConcurrency: 5`).

- `ToolExecutionService.executeTools()` receives signal
- Tools already running: complete naturally (can't safely interrupt mid-execution)
- Tools not yet started (queued in concurrency pool): skipped, recorded as `"Execution interrupted by user"`
- After all running tools complete, no further rounds executed
- ExecutionService returns with `interrupted: true`

### Case 3: Between rounds abort

Signal aborts between execution rounds.

- Previous round's results are fully recorded
- Signal checked at top of loop — next round does not start
- ExecutionService returns with `interrupted: true`

## Session Changes

**Replace the race-based abort wrapper with direct signal pass-through.**

Current implementation (lines 313-335): Creates AbortController, wraps `robota.run()` in a Promise that races against the abort signal. This is the source of the "abort only at Session level" problem.

New implementation: Remove the Promise wrapper race. Pass signal directly to `robota.run()`. The abort will propagate through the entire stack and `robota.run()` will return naturally (with partial results) when aborted.

```typescript
// session.ts run() method — REPLACE the Promise wrapper
this.abortController = new AbortController();
const { signal } = this.abortController;

try {
  response = await this.robota.run(enrichedMessage, { signal });
} finally {
  this.abortController = null;
}
```

Session.abort() and isRunning() remain unchanged.

## ExecutionService Changes

### IExecutionResult — add `interrupted` field

```typescript
interface IExecutionResult {
  interrupted?: boolean;
  // ...existing fields
}
```

### execute() round loop

```typescript
while (currentRound < maxRounds) {
  if (context?.signal?.aborted) break; // Case 3

  const providerResult = await callProviderWithCache(
    conversationMessages,
    config,
    resolved,
    cacheService,
    context?.signal,
  );

  if (context?.signal?.aborted) {
    // Case 1: save partial response if content exists
    if (providerResult.content) {
      saveMessage({ ...providerResult, metadata: { interrupted: true } });
    }
    break;
  }

  // ... existing tool call handling
  if (hasPendingToolCalls) {
    await executeAndRecordToolCalls(toolCalls, context?.signal);
    if (context?.signal?.aborted) break;
  }
}

// Return result with interrupted flag
return { ...result, interrupted: context?.signal?.aborted ?? false };
```

### callProviderWithCache() — add signal parameter

Pass `signal` through to `IChatOptions`:

```typescript
function callProviderWithCache(
  messages,
  config,
  resolved,
  cacheService,
  signal?: AbortSignal, // NEW
) {
  const chatOptions: IChatOptions = {
    ...existingOptions,
    signal,
  };
  return resolved.provider.chat(messages, chatOptions);
}
```

### Forced summary call — also passes signal

The forced summary provider call (when maxRounds exhausted without text) must also receive signal via `callProviderWithCache()`.

### ExecutionService.execute() error handling

The outer catch block must distinguish AbortError from other errors:

```typescript
try {
  // ... round loop
} catch (err) {
  if (err instanceof Error && err.name === 'AbortError') {
    // Abort propagated as exception — return interrupted result
    return { ...partialResult, interrupted: true };
  }
  // ... existing error handling
}
```

## ToolExecutionService Changes

### executeTools() — accept signal

```typescript
async executeTools(
  toolCalls: IToolCall[],
  tools: IToolWithEventService[],
  options?: { signal?: AbortSignal; mode?: string; maxConcurrency?: number },
): Promise<IToolResult[]> {
  // Before starting each tool in the concurrency pool:
  // if signal.aborted, return interrupted result instead of executing
}
```

For tools already running in parallel: they complete naturally. For tools queued but not yet started: skip with `"Execution interrupted by user"`.

## Anthropic Provider Changes

Pass signal to Anthropic SDK's `messages.create()` and catch AbortError:

```typescript
private async chatWithStreaming(
  params: Anthropic.MessageCreateParamsStreaming,
  onTextDelta: TTextDeltaCallback,
  signal?: AbortSignal,  // NEW
): Promise<TUniversalMessage> {
  const stream = await this.client.messages.create(
    params,
    signal ? { signal } : undefined,  // RequestOptions
  );

  try {
    for await (const event of stream) {
      // ... collect text, tool_use blocks (existing logic)
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // Return partial content collected so far
      return buildMessageFromCollected(collectedContent, collectedToolCalls);
    }
    throw err;
  }

  return buildMessage(fullContent, toolCalls);
}

// chat() passes signal to chatWithStreaming()
override async chat(messages, options?: IChatOptions): Promise<TUniversalMessage> {
  return this.chatWithStreaming(baseParams, textDeltaCb, options?.signal);
}
```

## UI Changes

### useSubmitHandler

On abort, Session.run() now returns normally (with partial/empty response) instead of throwing AbortError. The `interrupted` flag in the result indicates abort.

However, Session.run() currently returns a string (response text), not an IExecutionResult. Two options:

**Option A (minimal)**: Session.run() still throws AbortError on abort. The catch block in useSubmitHandler handles it. The partial streaming text is captured from the React state.

```typescript
catch (err) {
  clearStreamingText();
  if (err instanceof DOMException && err.name === 'AbortError') {
    // streamingText from useSession contains partial text
    // Session already saved partial content to history internally
    addMessage({ role: 'system', content: 'Cancelled.' });
  }
}
```

**Option A is chosen** — it requires the least changes to useSubmitHandler and Session's return type.

Session.run() behavior on abort:

1. Signal propagates through stack
2. ExecutionService returns with `interrupted: true` and partial history saved
3. Session.run() sees `interrupted` result → throws AbortError
4. useSubmitHandler catches AbortError → shows "Cancelled."

### App.tsx

No changes needed — ESC → session.abort() already works.

## History Integrity

After abort, conversation history contains:

1. All completed messages from previous rounds
2. Partial assistant message with `metadata.interrupted = true` (if text was streamed, content non-empty)
3. Completed tool results (if any tools finished before abort)
4. Interrupted tool results with `"Execution interrupted by user"` (for queued/skipped tools)

If abort fires before any streaming text arrives: no partial assistant message is saved. History ends at the user message.

## File Structure

```
packages/agent-core/
├─ src/interfaces/
│  ├─ agent.ts              [MODIFY] IRunOptions + signal
│  ├─ chat-options.ts       [MODIFY] IChatOptions + signal
│  └─ execution-types.ts    [MODIFY] IExecutionContext + signal, IExecutionResult + interrupted
├─ src/services/
│  ├─ execution-service.ts  [MODIFY] Signal checks in round loop, error handling
│  ├─ execution-round.ts    [MODIFY] callProviderWithCache + signal, executeAndRecordToolCalls + signal
│  └─ tool-execution-service.ts [MODIFY] executeTools + signal for parallel abort

packages/agent-sessions/
└─ src/session.ts           [MODIFY] Remove race wrapper, pass signal to robota.run(), throw AbortError on interrupted

packages/agent-provider-anthropic/
└─ src/provider.ts          [MODIFY] chatWithStreaming + signal, pass to messages.create()

packages/agent-cli/
└─ src/ui/hooks/
   └─ useSubmitHandler.ts   [MODIFY] AbortError catch shows "Cancelled." (minimal change)
```

### SPEC.md Updates Required

- `packages/agent-core/docs/SPEC.md` — IRunOptions, IChatOptions, IExecutionContext, IExecutionResult changes
- `packages/agent-sessions/docs/SPEC.md` — Session.run() abort behavior
- `packages/agent-provider-anthropic/docs/SPEC.md` — signal support in chat()

## Out of Scope

- Google provider abort implementation (future, same pattern)
- Bash tool process kill on abort (complex, separate backlog)
- Abort during permission prompt (already blocked by useInput isActive guard)
- Custom abort key (ESC is sufficient)
- Exposing interrupted flag in CLI UI beyond "Cancelled." message
