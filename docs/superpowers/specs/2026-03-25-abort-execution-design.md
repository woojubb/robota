# Abort Execution Design

## Goal

Enable users to abort a running AI execution via ESC key, with proper signal propagation through the entire stack: Session → Robota → ExecutionService → Provider → streaming/tools.

## Architecture

AbortSignal is threaded through the entire execution chain. The Session creates an AbortController, passes the signal down through Robota, ExecutionService, and Provider. Each layer checks the signal at appropriate points and performs cleanup. The provider interface defines signal support abstractly; each provider implements it using its SDK's native mechanism.

## Tech Stack

- AbortController / AbortSignal (Web API, available in Node 18+)
- Anthropic SDK `RequestOptions.signal` for streaming abort
- Session.abort() triggers the AbortController

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
  ├─ callProviderWithCache(..., signal)        // passes to IChatOptions.signal
  │   └─ Provider.chat(messages, { signal })
  │       └─ Anthropic: messages.create(params, { signal })
  │           └─ streaming for-await breaks on abort
  └─ executeAndRecordToolCalls(..., signal)
      └─ ToolExecutionService.executeTools({ signal })
          └─ queued tools skipped on abort
```

## Interfaces Modified

Four interfaces with `signal` or `interrupted`:

| Interface           | Package                                  | Field added             |
| ------------------- | ---------------------------------------- | ----------------------- |
| `IRunOptions`       | agent-core (interfaces/agent.ts)         | `signal?: AbortSignal`  |
| `IChatOptions`      | agent-core (interfaces/provider.ts)      | `signal?: AbortSignal`  |
| `IExecutionContext` | agent-core (services/execution-types.ts) | `signal?: AbortSignal`  |
| `IExecutionResult`  | agent-core (services/execution-types.ts) | `interrupted?: boolean` |

Additional interface:

| Interface                    | Package                                         | Field added            |
| ---------------------------- | ----------------------------------------------- | ---------------------- |
| `IToolExecutionBatchContext` | agent-core (services/tool-execution-service.ts) | `signal?: AbortSignal` |

All additions are optional — backward compatible.

## Provider Interface Contract

AbortSignal support is defined abstractly in agent-core's `IChatOptions`. Each provider implements abort using its SDK's native mechanism.

Provider behavior when `signal` is provided:

- If signal aborts during streaming: catch AbortError from SDK, return partial content collected so far
- If signal is not provided: existing behavior unchanged (backward compatible)

| Provider  | Internal mechanism                                           |
| --------- | ------------------------------------------------------------ |
| Anthropic | `messages.create(params, { signal })` via SDK RequestOptions |
| Google    | future — same pattern                                        |
| OpenAI    | future — same pattern                                        |

### Anthropic Provider Implementation

```typescript
private async chatWithStreaming(
  params, onTextDelta, signal?: AbortSignal,
): Promise<TUniversalMessage> {
  const stream = await this.client.messages.create(
    streamParams,
    signal ? { signal } : undefined,
  );

  try {
    for await (const event of stream) { /* collect content */ }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return buildPartialMessage(collectedContent);
    }
    throw err;
  }
}

// chat() passes signal to chatWithStreaming()
override async chat(messages, options?: IChatOptions) {
  return this.chatWithStreaming(baseParams, textDeltaCb, options?.signal);
}
```

## Abort Handling by Case

### Case 1: Provider streaming abort

Signal aborts while provider is streaming text.

- Provider catches AbortError from SDK, returns partial text collected so far (may be empty string)
- ExecutionService detects `signal.aborted` after provider returns
- No further rounds executed
- ExecutionService returns `IExecutionResult` with `interrupted: true`

### Case 2: Tool execution abort (parallel)

Signal aborts while tools are executing. Tools run in parallel (`mode: 'parallel'`, `maxConcurrency: 5`).

- `ToolExecutionService.executeTools()` receives signal via `IToolExecutionBatchContext.signal`
- Tools already running: complete naturally (can't safely interrupt mid-execution)
- Tools not yet started (queued): check `signal.aborted` before starting, return interrupted result
- After all running tools complete, no further rounds executed
- ExecutionService returns with `interrupted: true`

### Case 3: Between rounds abort

Signal aborts between execution rounds.

- Previous round's results are fully recorded
- Signal checked at top of round loop — next round does not start
- Also checked after each round completes
- ExecutionService returns with `interrupted: true`

## Session Implementation

**Replaced** the race-based abort wrapper with direct signal pass-through.

Old: Promise wrapper that raced `robota.run()` against abort event listener.
New: Pass `{ signal }` directly to `robota.run()`. After run returns, check `signal.aborted` and throw AbortError if interrupted.

```typescript
this.abortController = new AbortController();
const { signal } = this.abortController;

try {
  response = await this.robota.run(enrichedMessage, { signal });
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
} catch (error) {
  // log and rethrow
} finally {
  this.abortController = null;
}
```

`session.abort()` and `session.isRunning()` remain unchanged.

Note: `robota.run()` always returns normally on abort (does not throw AbortError). The `signal.aborted` check after run is the sole source of the thrown AbortError that `useSubmitHandler` catches.

## ExecutionService Implementation

### Round loop

```typescript
while (currentRound < maxRounds) {
  if (context?.signal?.aborted) break;  // Case 3

  const providerResult = await callProviderWithCache(..., context?.signal);

  if (context?.signal?.aborted) break;  // Case 1

  // Tool execution (if provider returned tool_use)
  if (hasPendingToolCalls) {
    await executeAndRecordToolCalls(..., context?.signal);
    if (context?.signal?.aborted) break;  // Case 2
  }
}

return { ...result, interrupted: context?.signal?.aborted ?? false };
```

### callProviderWithCache

Added `signal?: AbortSignal` as last parameter. Passes signal to `IChatOptions` in the `provider.chat()` call.

### executeAndRecordToolCalls

Added `signal?: AbortSignal` as last parameter. Passes signal to `IToolExecutionBatchContext`.

### Error handling

Outer catch block in `execute()` distinguishes AbortError (returns `interrupted: true`) from other errors.

### Forced summary call

The forced summary provider call (when maxRounds exhausted) also receives signal.

## robotaRun Implementation

Passes `options.signal` from `IRunOptions` to `ExecutionService.execute()` via `IExecutionContext`. On `result.interrupted`, emits `EXECUTION_COMPLETE` event and returns early.

## UI Behavior

### useSubmitHandler

Session.run() throws AbortError on abort. useSubmitHandler catches it:

```typescript
catch (err) {
  clearStreamingText(keepTools);  // keepTools=true on abort
  if (err instanceof DOMException && err.name === 'AbortError') {
    addMessage({ role: 'system', content: 'Cancelled.' });
  }
}
```

### clearStreamingText — keepTools parameter

`clearStreamingText(keepTools?: boolean)` added. On abort, called with `keepTools=true` to preserve the tool execution list in the UI so the user can see what was executed before cancellation. On normal completion, called without argument (clears both text and tools).

### App.tsx

No changes — ESC → `session.abort()` already works. `useInput` disabled during permission prompts and plugin TUI.

## History Integrity

After abort, conversation history contains:

1. All completed messages from previous rounds
2. Completed tool results (if any tools finished before abort)
3. Interrupted tool results with `"Execution interrupted by user"` (for queued/skipped tools)

## File Structure

```
packages/agent-core/
├─ src/interfaces/
│  ├─ agent.ts              [MODIFY] IRunOptions + signal
│  └─ provider.ts           [MODIFY] IChatOptions + signal
├─ src/services/
│  ├─ execution-types.ts    [MODIFY] IExecutionContext + signal, IExecutionResult + interrupted
├─ src/services/
│  ├─ execution-service.ts  [MODIFY] Signal checks in round loop, AbortError handling
│  ├─ execution-round.ts    [MODIFY] callProviderWithCache + signal, executeAndRecordToolCalls + signal
│  └─ tool-execution-service.ts [MODIFY] IToolExecutionBatchContext + signal, skip queued on abort
├─ src/core/
│  └─ robota-execution.ts   [MODIFY] Pass signal from IRunOptions to ExecutionService

packages/agent-sessions/
└─ src/session.ts           [MODIFY] Replace race wrapper, pass signal, throw AbortError on interrupted

packages/agent-provider-anthropic/
└─ src/provider.ts          [MODIFY] chatWithStreaming + signal, pass to messages.create(), catch AbortError

packages/agent-cli/
└─ src/ui/hooks/
   ├─ useSubmitHandler.ts   [MODIFY] clearStreamingText(keepTools) on abort
   └─ useSession.ts         [MODIFY] clearStreamingText accepts keepTools? parameter
```

## Out of Scope

- Google provider abort implementation (future, same pattern)
- Bash tool process kill on abort (complex, separate backlog)
- Abort during permission prompt (already blocked by useInput isActive guard)
- Custom abort key (ESC is sufficient)
