# Abort Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thread AbortSignal from Session through ExecutionService and Provider so ESC key actually stops streaming and tool execution.

**Architecture:** Add `signal?: AbortSignal` to IRunOptions, IExecutionContext, and IChatOptions. Each layer checks and propagates the signal. Provider catches AbortError from SDK and returns partial content. Session replaces the race-based wrapper with direct signal pass-through.

**Tech Stack:** AbortController/AbortSignal (Node 18+), Anthropic SDK RequestOptions.signal

**Spec:** `docs/superpowers/specs/2026-03-25-abort-execution-design.md`

---

## File Structure

```
packages/agent-core/
├─ src/interfaces/agent.ts              [MODIFY] IRunOptions + signal
├─ src/interfaces/provider.ts           [MODIFY] IChatOptions + signal
├─ src/services/execution-types.ts      [MODIFY] IExecutionContext + signal, IExecutionResult + interrupted
├─ src/services/execution-round.ts      [MODIFY] callProviderWithCache + signal, executeRound + signal check
├─ src/services/execution-service.ts    [MODIFY] Signal check in round loop, AbortError handling
├─ src/services/tool-execution-service.ts [MODIFY] executeTools signal check
├─ src/core/robota-execution.ts         [MODIFY] Pass signal from IRunOptions to ExecutionService

packages/agent-sessions/
└─ src/session.ts                       [MODIFY] Replace race wrapper, pass signal to robota.run()

packages/agent-provider-anthropic/
└─ src/provider.ts                      [MODIFY] Pass signal to messages.create(), catch AbortError
```

---

### Task 1: Add signal to core interfaces

Add `signal?: AbortSignal` to three interfaces in agent-core.

**Files:**

- Modify: `packages/agent-core/src/interfaces/agent.ts` (IRunOptions, ~line 157)
- Modify: `packages/agent-core/src/interfaces/provider.ts` (IChatOptions, ~line 154)
- Modify: `packages/agent-core/src/services/execution-types.ts` (IExecutionContext ~line 95, IExecutionResult ~line 109)

- [ ] **Step 1: Add signal to IRunOptions**

In `packages/agent-core/src/interfaces/agent.ts`, add to `IRunOptions` (search for `interface IRunOptions`):

```typescript
export interface IRunOptions {
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  toolChoice?: 'auto' | 'none' | string;
  sessionId?: string;
  userId?: string;
  metadata?: TMetadata;
  /** AbortSignal for cancelling execution */
  signal?: AbortSignal;
}
```

- [ ] **Step 2: Add signal to IChatOptions**

In `packages/agent-core/src/interfaces/provider.ts`, add to `IChatOptions` (search for `interface IChatOptions`):

```typescript
export interface IChatOptions extends IProviderSpecificOptions {
  tools?: IToolSchema[];
  maxTokens?: number;
  temperature?: number;
  model?: string;
  onTextDelta?: TTextDeltaCallback;
  /** AbortSignal for cancelling the provider call */
  signal?: AbortSignal;
}
```

- [ ] **Step 3: Add signal to IExecutionContext and interrupted to IExecutionResult**

In `packages/agent-core/src/services/execution-types.ts`:

Add to `IExecutionContext` (search for `interface IExecutionContext`):

```typescript
/** AbortSignal for cancelling execution */
signal?: AbortSignal;
```

Add to `IExecutionResult` (search for `interface IExecutionResult`):

```typescript
/** Whether execution was interrupted by abort */
interrupted?: boolean;
```

- [ ] **Step 4: Build agent-core to verify**

Run: `pnpm --filter @robota-sdk/agent-core build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/interfaces/agent.ts packages/agent-core/src/interfaces/provider.ts packages/agent-core/src/services/execution-types.ts
git commit -m "feat(agent-core): add signal to IRunOptions, IChatOptions, IExecutionContext"
```

---

### Task 2: Anthropic Provider — pass signal to SDK

Pass signal through to `messages.create()` and catch AbortError to return partial content.

**Files:**

- Modify: `packages/agent-provider-anthropic/src/provider.ts`

- [ ] **Step 1: Read provider.ts to understand current chatWithStreaming**

Read: `packages/agent-provider-anthropic/src/provider.ts` (lines 79-260)

- [ ] **Step 2: Add signal parameter to chatWithStreaming**

Change the `chatWithStreaming` method signature (search for `private async chatWithStreaming`) to accept signal:

```typescript
private async chatWithStreaming(
  params: Anthropic.MessageCreateParamsNonStreaming,
  onTextDelta: TTextDeltaCallback,
  signal?: AbortSignal,
): Promise<TUniversalMessage> {
```

- [ ] **Step 3: Pass signal to messages.create()**

Inside `chatWithStreaming`, change the `messages.create()` call (search for `this.client!.messages.create(streamParams)`) to:

```typescript
const stream = await this.client!.messages.create(streamParams, signal ? { signal } : undefined);
```

- [ ] **Step 4: Wrap for-await loop with AbortError catch**

Wrap the existing `for await (const event of stream)` loop in a try/catch. On AbortError, return partial content collected so far:

```typescript
try {
  for await (const event of stream) {
    // ... existing event handling (unchanged)
  }
} catch (err) {
  if (err instanceof Error && err.name === 'AbortError') {
    // Return partial content collected so far
    return this.buildPartialResponse(contentBlocks, toolUseBlocks, assistantText);
  }
  throw err;
}
```

Add a helper method `buildPartialResponse` that constructs a `TUniversalMessage` from whatever content was collected before abort. This mirrors the existing response-building logic at the end of `chatWithStreaming` but handles incomplete state.

- [ ] **Step 5: Pass signal from chat() to chatWithStreaming()**

In the `chat()` method (search for `return this.chatWithStreaming(baseParams, textDeltaCb)`), change to:

```typescript
return this.chatWithStreaming(baseParams, textDeltaCb, options?.signal);
```

- [ ] **Step 6: Build provider to verify**

Run: `pnpm --filter @robota-sdk/agent-provider-anthropic build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/agent-provider-anthropic/src/provider.ts
git commit -m "feat(agent-provider-anthropic): pass AbortSignal to streaming, return partial on abort"
```

---

### Task 3: ExecutionService — signal checks in round loop

Thread signal through execution round loop and tool execution.

**Files:**

- Modify: `packages/agent-core/src/services/execution-round.ts`
- Modify: `packages/agent-core/src/services/execution-service.ts`
- Modify: `packages/agent-core/src/core/robota-execution.ts`

- [ ] **Step 1: Read execution-round.ts and execution-service.ts**

Read both files to understand the current flow.

- [ ] **Step 2: Add signal to callProviderWithCache**

In `execution-round.ts`, add `signal` parameter to `callProviderWithCache` (search for `export async function callProviderWithCache`):

```typescript
export async function callProviderWithCache(
  conversationMessages: TUniversalMessage[],
  config: IAgentConfig,
  resolved: IResolvedProviderInfo,
  cacheService?: ExecutionCacheService,
  signal?: AbortSignal,
): Promise<TUniversalMessage> {
```

Add `signal` to the `chatOptions` object inside the function:

```typescript
const chatOptions: IChatOptions = {
  model: config.defaultModel.model,
  ...(config.defaultModel.maxTokens !== undefined && { maxTokens: config.defaultModel.maxTokens }),
  ...(config.defaultModel.temperature !== undefined && {
    temperature: config.defaultModel.temperature,
  }),
  ...(resolved.availableTools.length > 0 && { tools: resolved.availableTools }),
  signal,
};
```

- [ ] **Step 3: Pass signal in executeRound's call to callProviderWithCache**

In `execution-round.ts`, find where `executeRound` calls `callProviderWithCache` (search for `await callProviderWithCache(`). Add `fullContext.signal` as the last argument:

```typescript
response = await callProviderWithCache(
  conversationMessages,
  config,
  resolved,
  cacheService,
  fullContext.signal,
);
```

- [ ] **Step 4: Add signal check in ExecutionService round loop**

In `execution-service.ts`, add abort check at the top of the while loop (search for `while (roundState.currentRound < maxRounds)`):

```typescript
while (roundState.currentRound < maxRounds) {
  // Check abort signal before starting next round
  if (context?.signal?.aborted) {
    break;
  }
  roundState.currentRound++;
  // ... existing executeRound call
```

Also add after the round completes:

```typescript
  const shouldBreak = await executeRound(...);
  if (shouldBreak) break;
  if (context?.signal?.aborted) break;
}
```

- [ ] **Step 5: Handle AbortError in ExecutionService catch block**

In `execution-service.ts`, find the outer catch block in `execute()` (search for `} catch (error)`). Add AbortError handling before the generic error handling:

```typescript
} catch (error) {
  if (error instanceof Error && error.name === 'AbortError') {
    return {
      response: '',
      messages: roundState.messages ?? [],
      executionId,
      duration: Date.now() - startTime.getTime(),
      toolsExecuted: roundState.toolsExecuted ?? [],
      success: true,
      interrupted: true,
    };
  }
  // ... existing error handling
}
```

- [ ] **Step 6: Add interrupted flag to normal return**

In `execution-service.ts`, find where `IExecutionResult` is constructed for the normal return path. Add `interrupted`:

```typescript
return {
  // ... existing fields
  interrupted: context?.signal?.aborted ?? false,
};
```

- [ ] **Step 7: Pass signal from robotaRun to ExecutionService**

In `packages/agent-core/src/core/robota-execution.ts`, find where `execute()` is called (search for `deps.getExecutionService().execute(`). Add signal from options:

```typescript
const result = await deps.getExecutionService().execute(input, messages, executionConfig, {
  conversationId: deps.conversationId,
  ...(options.sessionId && { sessionId: options.sessionId }),
  ...(options.userId && { userId: options.userId }),
  ...(options.metadata && { metadata: options.metadata }),
  ...(options.signal && { signal: options.signal }),
});
```

- [ ] **Step 8: Handle interrupted result in robotaRun**

After the `execute()` call, check for interrupted:

```typescript
if (result.interrupted) {
  deps.emitAgentEvent(AGENT_EVENTS.EXECUTION_COMPLETE, {});
  return result.response; // may be empty or partial
}
```

- [ ] **Step 9: Also pass signal to forced summary call**

In `execution-service.ts`, find the forced summary provider call (search for "forced summary" or the second `callProviderWithCache`). Pass signal there too:

```typescript
// Pass signal to forced summary call as well
const summaryResponse = await callProviderWithCache(
  summaryMessages,
  summaryConfig,
  resolved,
  undefined, // no cache for summary
  context?.signal,
);
```

- [ ] **Step 10: Build agent-core to verify**

Run: `pnpm --filter @robota-sdk/agent-core build`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add packages/agent-core/src/services/execution-round.ts packages/agent-core/src/services/execution-service.ts packages/agent-core/src/core/robota-execution.ts
git commit -m "feat(agent-core): thread AbortSignal through execution round loop and provider calls"
```

---

### Task 4: ToolExecutionService — signal in parallel tool execution

Add signal to `IToolExecutionBatchContext` so queued tools can be skipped on abort.

**Files:**

- Modify: `packages/agent-core/src/services/tool-execution-service.ts`
- Modify: `packages/agent-core/src/services/execution-round.ts` (pass signal to batch context)

- [ ] **Step 1: Add signal to IToolExecutionBatchContext**

In `tool-execution-service.ts`, add `signal` to the interface (search for `interface IToolExecutionBatchContext`):

```typescript
export interface IToolExecutionBatchContext {
  requests: IToolExecutionRequest[];
  mode: 'parallel' | 'sequential';
  timeout?: number;
  continueOnError?: boolean;
  maxConcurrency?: number;
  parentContext?: IToolExecutionContext;
  /** AbortSignal for skipping queued tools */
  signal?: AbortSignal;
}
```

- [ ] **Step 2: Check signal before each tool in executeTools parallel mode**

In `executeTools`, modify the parallel execution to check signal before starting each tool. Replace the `batchContext.requests.map(...)` call:

```typescript
if (batchContext.mode === 'parallel') {
  const promises = batchContext.requests.map((request) =>
    (() => {
      // Skip queued tools if abort signal fired
      if (batchContext.signal?.aborted) {
        return Promise.resolve({
          toolName: request.toolName,
          executionId: request.executionId ?? '',
          success: false,
          error: 'Execution interrupted by user',
          result: { success: false, data: 'Execution interrupted by user', metadata: {} },
        } as IToolExecutionResult);
      }
      const required = this.requireExecutionRequestFields(request);
      return this.executeTool(request.toolName, request.parameters, {
        // ... existing context fields
      });
    })(),
  );
```

Note: tools already executing via `Promise.allSettled` will complete naturally. Only tools that haven't started their promise yet will see `signal.aborted === true`.

- [ ] **Step 3: Pass signal from executeAndRecordToolCalls to batch context**

In `execution-round.ts`, find where `IToolExecutionBatchContext` is constructed (search for `batchContext` or `executeTools`). Add `signal: fullContext.signal`:

```typescript
const batchContext: IToolExecutionBatchContext = {
  // ... existing fields
  signal: fullContext.signal,
};
```

- [ ] **Step 4: Build to verify**

Run: `pnpm --filter @robota-sdk/agent-core build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/services/tool-execution-service.ts packages/agent-core/src/services/execution-round.ts
git commit -m "feat(agent-core): add AbortSignal to ToolExecutionService for parallel tool abort"
```

---

### Task 5: Session — replace race wrapper with signal pass-through

Replace the Promise race wrapper with direct signal propagation.

**Files:**

- Modify: `packages/agent-sessions/src/session.ts`

- [ ] **Step 1: Read current session.ts run() method**

Read: `packages/agent-sessions/src/session.ts` (lines 310-350)

- [ ] **Step 2: Replace the Promise wrapper**

Find the Promise wrapper (search for `response = await new Promise<string>((resolve, reject)`). Replace the entire block with direct signal pass-through:

```typescript
this.abortController = new AbortController();
const { signal } = this.abortController;

let response: string;
try {
  response = await this.robota.run(enrichedMessage, {
    ...runOptions,
    signal,
  });

  // If execution was interrupted, throw AbortError for the catch block
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
} catch (error) {
  this.log('error', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? (error.stack ?? '') : '',
    historyLength: this.robota.getHistory().length,
  });
  throw error;
} finally {
  this.abortController = null;
}
```

Currently `this.robota.run(enrichedMessage)` is called with no options. The new call passes `{ signal }` as options. No existing `runOptions` to spread — just pass `{ signal }` directly:

```typescript
response = await this.robota.run(enrichedMessage, { signal });
```

- [ ] **Step 3: Build agent-sessions to verify**

Run: `pnpm --filter @robota-sdk/agent-sessions build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/agent-sessions/src/session.ts
git commit -m "feat(agent-sessions): replace abort race wrapper with direct signal pass-through"
```

---

### Task 6: Verify useSubmitHandler abort handling

Confirm existing AbortError handling works with the new signal flow.

**Files:**

- Verify: `packages/agent-cli/src/ui/hooks/useSubmitHandler.ts`

- [ ] **Step 1: Read useSubmitHandler.ts and verify abort handling**

Read `packages/agent-cli/src/ui/hooks/useSubmitHandler.ts` lines 72-82. The existing code already:

- Catches `DOMException` with `name === 'AbortError'` (line 74)
- Shows "Cancelled." system message (line 75)
- Calls `setIsThinking(false)` in finally block (line 81)
- Calls `clearStreamingText()` before error handling (line 73)

This is already correct for Option A (Session throws AbortError). No code changes needed unless the abort flow doesn't work end-to-end during manual testing.

- [ ] **Step 2: Commit (only if changes needed)**

---

### Task 7: Tests

Write tests for the abort signal propagation.

**Files:**

- Modify or create tests in relevant packages

- [ ] **Step 1: Test IExecutionResult.interrupted field**

In `packages/agent-core/src/services/execution-service.test.ts`, add:

```typescript
it('returns interrupted: true when signal is aborted before execution', async () => {
  const controller = new AbortController();
  controller.abort(); // Abort immediately
  const result = await executionService.execute('test input', [], mockConfig, {
    signal: controller.signal,
  });
  expect(result.interrupted).toBe(true);
});
```

- [ ] **Step 2: Test Anthropic provider returns partial content on abort**

In `packages/agent-provider-anthropic/src/__tests__/`, create or modify a test:

```typescript
it('returns partial content when signal aborts during streaming', async () => {
  const controller = new AbortController();
  // Mock messages.create to return an async iterable that aborts mid-stream
  const mockStream = {
    async *[Symbol.asyncIterator]() {
      yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'partial' },
      };
      // Abort fires here
      controller.abort();
      // This yield should throw AbortError
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' more' } };
    },
  };
  mockClient.messages.create.mockResolvedValue(mockStream);

  const result = await provider.chat([], { signal: controller.signal });
  expect(result.content).toContain('partial');
});
```

- [ ] **Step 3: Test Session.run() throws AbortError on abort**

In `packages/agent-sessions/src/__tests__/`, add:

```typescript
it('throws AbortError when abort() is called during run()', async () => {
  // Mock robota.run to delay, allowing abort to fire
  mockRobota.run.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 1000)));

  const runPromise = session.run('test message');
  // Abort after a short delay
  setTimeout(() => session.abort(), 10);

  await expect(runPromise).rejects.toThrow('Aborted');
});
```

- [ ] **Step 4: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/services/execution-service.test.ts packages/agent-provider-anthropic/src/__tests__/ packages/agent-sessions/src/__tests__/
git commit -m "test: add abort signal propagation tests"
```

---

### Task 8: SPEC.md updates

Update SPEC.md files for modified packages.

**Files:**

- Modify: `packages/agent-core/docs/SPEC.md`
- Modify: `packages/agent-sessions/docs/SPEC.md`
- Modify: `packages/agent-provider-anthropic/docs/SPEC.md`

- [ ] **Step 1: Update agent-core SPEC.md**

Add abort signal documentation:

- `IRunOptions.signal` — AbortSignal for cancelling execution
- `IChatOptions.signal` — AbortSignal for cancelling provider calls
- `IExecutionContext.signal` — AbortSignal threaded through execution
- `IExecutionResult.interrupted` — boolean indicating abort

- [ ] **Step 2: Update agent-sessions SPEC.md**

Document Session.run() abort behavior:

- `session.abort()` triggers signal propagation through entire stack
- Session throws AbortError when interrupted

- [ ] **Step 3: Update agent-provider-anthropic SPEC.md**

Document provider abort support:

- `IChatOptions.signal` passed to Anthropic SDK `RequestOptions`
- Returns partial content on abort

- [ ] **Step 4: Commit**

```bash
git add packages/agent-core/docs/SPEC.md packages/agent-sessions/docs/SPEC.md packages/agent-provider-anthropic/docs/SPEC.md
git commit -m "docs: update SPEC.md files for abort signal support"
```

---

### Task 9: Build verification and manual test

Full build, typecheck, and manual verification.

- [ ] **Step 1: Build all packages**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 3: Manual verification**

Test locally with `pnpm run cli:dev`:

1. Send a prompt that generates a long response
2. Press ESC while streaming → should see "Cancelled." and streaming stops immediately
3. Send another prompt → should work normally (history intact)
4. Send a prompt that triggers tool use (e.g., read a file)
5. Press ESC during tool execution → should see interrupted message
6. Verify no orphan streaming continues after abort

- [ ] **Step 4: Commit any fixes**

Stage specific fixed files and commit.

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인
