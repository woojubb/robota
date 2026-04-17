# Conversation History Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild conversation history with type SSOT (id, state on IBaseMessage), streaming buffer in ConversationSession, IChatMessage deletion, and recording/usage separation.

**Architecture:** Add `id` and `state` to `IBaseMessage`, manage streaming via `appendStreaming`/`commitAssistant` in `ConversationSession`, replace `IChatMessage` with `TUniversalMessage` in CLI, annotate interrupted messages in `getMessagesForAPI`.

**Tech Stack:** TypeScript strict, Ink (React CLI), Vitest, `crypto.randomUUID()`

**Spec:** `docs/superpowers/specs/2026-03-25-conversation-history-architecture-design.md`

---

## File Structure

```
packages/agent-core/
├─ src/interfaces/messages.ts                    [MODIFY] IBaseMessage + id + state, TMessageState
├─ src/managers/conversation-message-factory.ts  [MODIFY] id generation, state parameter
├─ src/managers/conversation-session.ts          [MODIFY] IStreamingState, appendStreaming, commitAssistant
├─ src/services/execution-round.ts               [MODIFY] Use appendStreaming/commitAssistant flow
├─ docs/SPEC.md                                  [MODIFY] Document message model and streaming state

packages/agent-sessions/
├─ src/session.ts                                [VERIFY] Abort flow with new ConversationSession
├─ docs/SPEC.md                                  [MODIFY] Document abort + commitAssistant

packages/agent-cli/
├─ src/ui/types.ts                               [MODIFY] Remove IChatMessage
├─ src/ui/hooks/useMessages.ts                   [MODIFY] TUniversalMessage[]
├─ src/ui/hooks/useSubmitHandler.ts              [MODIFY] TUniversalMessage, remove getStreamingText
├─ src/ui/hooks/useSession.ts                    [MODIFY] Remove getStreamingText
├─ src/ui/MessageList.tsx                        [MODIFY] Render TUniversalMessage
├─ src/ui/App.tsx                                [MODIFY] TUniversalMessage wiring
├─ docs/SPEC.md                                  [MODIFY] Type unification
```

---

### Task 1: IBaseMessage — add id and state

Add `id: string` and `state: TMessageState` to `IBaseMessage`. All existing message types inherit these.

**Files:**

- Modify: `packages/agent-core/src/interfaces/messages.ts`

- [ ] **Step 1: Add TMessageState type and update IBaseMessage**

In `messages.ts`, before `IBaseMessage` (search for `interface IBaseMessage`):

```typescript
/** State of a message in conversation history */
export type TMessageState = 'complete' | 'interrupted';
```

Update `IBaseMessage`:

```typescript
export interface IBaseMessage {
  /** Unique message identifier */
  id: string;
  timestamp: Date;
  /** Whether this message is complete or was interrupted */
  state: TMessageState;
  metadata?: TUniversalMessageMetadata;
}
```

- [ ] **Step 2: Export TMessageState from interfaces index**

In `packages/agent-core/src/interfaces/index.ts`, add `TMessageState` to the exports from `messages.ts`.

- [ ] **Step 3: Build to find all compile errors**

Run: `pnpm --filter @robota-sdk/agent-core build 2>&1 | head -50`
Expected: Compile errors in factories and tests where `id` and `state` are missing. This is expected — Task 2 fixes them.

- [ ] **Step 4: Commit**

```bash
git add packages/agent-core/src/interfaces/messages.ts packages/agent-core/src/interfaces/index.ts
git commit -m "feat(agent-core): add id and state to IBaseMessage, define TMessageState"
```

---

### Task 2: Message factories — id generation and state

Update all factory functions to generate `id` and set `state: 'complete'` by default.

**Files:**

- Modify: `packages/agent-core/src/managers/conversation-message-factory.ts`

- [ ] **Step 1: Read the factory file**

Read: `packages/agent-core/src/managers/conversation-message-factory.ts`

- [ ] **Step 2: Add crypto import and update createUserMessage**

Add at top:

```typescript
import { randomUUID } from 'node:crypto';
```

Update `createUserMessage` to include `id` and `state`:

```typescript
export function createUserMessage(
  content: string,
  options?: {
    name?: string;
    metadata?: TUniversalMessageMetadata;
    parts?: TUniversalMessagePart[];
  },
): IUserMessage {
  return {
    id: randomUUID(),
    role: 'user',
    content,
    state: 'complete',
    timestamp: new Date(),
    ...(options?.name && { name: options.name }),
    ...(options?.metadata && { metadata: options.metadata }),
    ...(options?.parts && { parts: options.parts }),
  };
}
```

- [ ] **Step 3: Update createAssistantMessage with state parameter**

```typescript
export function createAssistantMessage(
  content: string | null,
  options?: {
    toolCalls?: IToolCall[];
    metadata?: TUniversalMessageMetadata;
    parts?: TUniversalMessagePart[];
    state?: TMessageState;
  },
): IAssistantMessage {
  return {
    id: randomUUID(),
    role: 'assistant',
    content,
    state: options?.state ?? 'complete',
    timestamp: new Date(),
    ...(options?.toolCalls && { toolCalls: options.toolCalls }),
    ...(options?.metadata && { metadata: options.metadata }),
    ...(options?.parts && { parts: options.parts }),
  };
}
```

- [ ] **Step 4: Update createSystemMessage and createToolMessage**

Same pattern: add `id: randomUUID()` and `state: 'complete'` to both.

- [ ] **Step 5: Fix all tests that create messages without id/state**

Search for test files that construct `TUniversalMessage` objects directly (without factory). Add `id` and `state` fields to all test message literals.

Run: `pnpm --filter @robota-sdk/agent-core test 2>&1 | grep "FAIL\|error"` to find failures.

Fix each test file by adding missing fields.

- [ ] **Step 6: Build and test**

Run: `pnpm --filter @robota-sdk/agent-core build && pnpm --filter @robota-sdk/agent-core test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/agent-core/src/managers/conversation-message-factory.ts packages/agent-core/src/**/*.test.ts
git commit -m "feat(agent-core): message factories generate id and state fields"
```

---

### Task 3: ConversationSession — streaming state

Add `IStreamingState`, `appendStreaming`, `appendToolCall`, `commitAssistant`, `discardPending` to `ConversationSession`.

**Files:**

- Modify: `packages/agent-core/src/managers/conversation-session.ts`

- [ ] **Step 1: Read ConversationSession class**

Read: `packages/agent-core/src/managers/conversation-session.ts` (lines 217-304)

- [ ] **Step 2: Define IStreamingState interface**

Add before the `ConversationSession` class:

```typescript
/** State of an in-progress assistant response being streamed */
interface IStreamingState {
  /** Message ID — generated when streaming starts */
  id: string;
  /** Accumulated text content from onTextDelta callbacks */
  content: string;
  /** Accumulated tool calls from provider response */
  toolCalls: IToolCall[];
}
```

- [ ] **Step 3: Add pendingAssistant field and new methods to ConversationSession**

Add to `ConversationSession` class:

```typescript
private pendingAssistant: IStreamingState | null = null;

/** Append streaming text delta to pending assistant response */
appendStreaming(delta: string): void {
  if (!this.pendingAssistant) {
    this.pendingAssistant = {
      id: randomUUID(),
      content: '',
      toolCalls: [],
    };
  }
  this.pendingAssistant.content += delta;
}

/** Append a tool call to pending assistant response (deduplicates by id) */
appendToolCall(toolCall: IToolCall): void {
  if (!this.pendingAssistant) {
    this.pendingAssistant = {
      id: randomUUID(),
      content: '',
      toolCalls: [],
    };
  }
  if (!this.pendingAssistant.toolCalls.some((tc) => tc.id === toolCall.id)) {
    this.pendingAssistant.toolCalls.push(toolCall);
  }
}

/**
 * Commit pending assistant response to history.
 * Precondition: appendStreaming() or appendToolCall() must have been called.
 * No-op if pendingAssistant is null (error paths use addAssistantMessage directly).
 */
commitAssistant(state: TMessageState, metadata?: TUniversalMessageMetadata): void {
  if (!this.pendingAssistant) return;
  const pending = this.pendingAssistant;
  const hasToolCalls = pending.toolCalls.length > 0;
  const content = hasToolCalls ? '' : pending.content;
  const message: IAssistantMessage = {
    id: pending.id,
    role: 'assistant',
    content,
    state,
    timestamp: new Date(),
    ...(hasToolCalls && { toolCalls: pending.toolCalls }),
    ...(metadata && { metadata }),
  };
  this.history.addMessage(message);
  this.pendingAssistant = null;
}

/** Discard pending assistant response without saving */
discardPending(): void {
  this.pendingAssistant = null;
}
```

- [ ] **Step 4: Clarify toolCallIds Set — keep for tool RESULTS, not tool CALLS**

The existing `private toolCallIds = new Set<string>()` in `ConversationSession` prevents duplicate **tool result messages** (addToolMessageWithId). This is separate from tool CALL deduplication in `appendToolCall`.

**Keep `toolCallIds` as-is** — it guards against duplicate tool result messages. `appendToolCall` has its own deduplication for tool calls in the streaming state. These are two different concerns:

- `toolCallIds` Set → prevents duplicate `IToolMessage` (results)
- `appendToolCall` dedup → prevents duplicate `IToolCall` (calls in pending state)

- [ ] **Step 5: Add import for randomUUID**

```typescript
import { randomUUID } from 'node:crypto';
```

- [ ] **Step 6: Write tests for streaming state**

Add tests to `packages/agent-core/src/managers/conversation-session.test.ts` (or create if needed):

```typescript
describe('ConversationSession streaming state', () => {
  it('appendStreaming accumulates text', () => {
    const session = new ConversationSession();
    session.appendStreaming('Hello');
    session.appendStreaming(' world');
    session.commitAssistant('complete');
    const msgs = session.getMessages();
    const last = msgs[msgs.length - 1];
    expect(last.role).toBe('assistant');
    expect(last.content).toBe('Hello world');
    expect(last.state).toBe('complete');
    expect(last.id).toBeDefined();
  });

  it('commitAssistant with interrupted state', () => {
    const session = new ConversationSession();
    session.appendStreaming('Partial');
    session.commitAssistant('interrupted');
    const msgs = session.getMessages();
    const last = msgs[msgs.length - 1];
    expect(last.state).toBe('interrupted');
    expect(last.content).toBe('Partial');
  });

  it('commitAssistant strips text when tool calls present', () => {
    const session = new ConversationSession();
    session.appendStreaming('Some text');
    session.appendToolCall({
      id: 'tc1',
      type: 'function',
      function: { name: 'Read', arguments: '{}' },
    });
    session.commitAssistant('complete');
    const msgs = session.getMessages();
    const last = msgs[msgs.length - 1] as IAssistantMessage;
    expect(last.content).toBe('');
    expect(last.toolCalls).toHaveLength(1);
  });

  it('appendToolCall deduplicates by id', () => {
    const session = new ConversationSession();
    const tc = {
      id: 'tc1',
      type: 'function' as const,
      function: { name: 'Read', arguments: '{}' },
    };
    session.appendToolCall(tc);
    session.appendToolCall(tc);
    session.commitAssistant('complete');
    const msgs = session.getMessages();
    const last = msgs[msgs.length - 1] as IAssistantMessage;
    expect(last.toolCalls).toHaveLength(1);
  });

  it('commitAssistant is no-op when no pending state', () => {
    const session = new ConversationSession();
    session.addUserMessage('test');
    session.commitAssistant('complete');
    expect(session.getMessageCount()).toBe(1);
  });

  it('discardPending clears without saving', () => {
    const session = new ConversationSession();
    session.appendStreaming('discard this');
    session.discardPending();
    session.commitAssistant('complete');
    expect(session.getMessageCount()).toBe(0);
  });
});
```

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @robota-sdk/agent-core test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/agent-core/src/managers/conversation-session.ts packages/agent-core/src/managers/__tests__/
git commit -m "feat(agent-core): add streaming state to ConversationSession (appendStreaming, commitAssistant)"
```

---

### Task 4: executeRound — use streaming state

Replace `addAssistantMessage` with `appendStreaming`/`commitAssistant` flow in the normal response path.

**Files:**

- Modify: `packages/agent-core/src/services/execution-round.ts`

- [ ] **Step 1: Read executeRound**

Read: `packages/agent-core/src/services/execution-round.ts` (lines 500-630)

- [ ] **Step 2: Wrap provider.onTextDelta to also call appendStreaming**

`onTextDelta` lives on `resolved.provider` as a property (not in chatOptions). Before the provider call in `executeRound`, wrap it:

```typescript
// Intercept onTextDelta on the provider object
const provider = resolved.provider as { onTextDelta?: (delta: string) => void };
const externalOnTextDelta = provider.onTextDelta;
provider.onTextDelta = (delta: string) => {
  conversationSession.appendStreaming(delta); // core accumulation
  externalOnTextDelta?.call(resolved.provider, delta); // CLI UI passthrough
};
```

Place this BEFORE the `callProviderWithCache()` call (around line 528). After the provider call completes (both normal and abort), restore the original:

```typescript
provider.onTextDelta = externalOnTextDelta;
```

- [ ] **Step 3: After provider returns, extract tool calls and commit**

Replace the existing `addAssistantMessage` block (around line 588) with:

```typescript
// Extract tool calls from provider response
const { assistantToolCalls } = validateAndExtractResponse(response, ...);
for (const tc of assistantToolCalls) {
  conversationSession.appendToolCall(tc);
}

// Single commit path — state determined by signal
const messageState: TMessageState = fullContext.signal?.aborted ? 'interrupted' : 'complete';
conversationSession.commitAssistant(messageState, {
  round: currentRound,
  ...(inputTokens > 0 && { inputTokens }),
  ...(outputTokens > 0 && { outputTokens }),
  ...((inputTokens > 0 || outputTokens > 0) && {
    usage: { totalTokens: inputTokens + outputTokens, inputTokens, outputTokens },
  }),
});
```

Remove the old `addAssistantMessage` call, the `contentForHistory` variable, the `hasToolCalls` check, and the `...(fullContext.signal?.aborted && { interrupted: true })` metadata flag at that location. The `interrupted` state is now on the message itself via `TMessageState`, not in metadata.

- [ ] **Step 4: Keep error-path addAssistantMessage calls unchanged**

The `addAssistantMessage` calls for provider error (line ~546) and context overflow (line ~513) remain — these are not streaming responses.

- [ ] **Step 5: Build and test**

Run: `pnpm --filter @robota-sdk/agent-core build && pnpm --filter @robota-sdk/agent-core test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/agent-core/src/services/execution-round.ts
git commit -m "feat(agent-core): executeRound uses appendStreaming/commitAssistant flow"
```

---

### Task 5: getMessagesForAPI — interrupted annotation

Annotate interrupted assistant messages when preparing messages for the provider.

**Files:**

- Modify: `packages/agent-core/src/managers/conversation-session.ts`

- [ ] **Step 1: Update getMessagesForAPI**

Find `getMessagesForAPI()` in `ConversationSession` (search for `getMessagesForAPI`). Update to annotate interrupted messages:

```typescript
getMessagesForAPI(): IProviderApiMessage[] {
  return this.history.getMessages().map((msg) => {
    const apiMsg: IProviderApiMessage = { role: msg.role, content: msg.content };
    // Annotate interrupted assistant messages
    if (isAssistantMessage(msg) && msg.state === 'interrupted') {
      apiMsg.content = (apiMsg.content || '') +
        '\n\n[This response was interrupted by the user]';
    }
    if (isAssistantMessage(msg) && msg.toolCalls) {
      apiMsg.tool_calls = msg.toolCalls;
    }
    if (isToolMessage(msg)) {
      apiMsg.tool_call_id = msg.toolCallId;
    }
    return apiMsg;
  });
}
```

- [ ] **Step 2: Add test for interrupted annotation**

```typescript
it('getMessagesForAPI annotates interrupted assistant messages', () => {
  const session = new ConversationSession();
  session.appendStreaming('Partial response');
  session.commitAssistant('interrupted');
  const api = session.getMessagesForAPI();
  expect(api[0].content).toContain('[This response was interrupted by the user]');
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @robota-sdk/agent-core test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/agent-core/src/managers/conversation-session.ts
git commit -m "feat(agent-core): getMessagesForAPI annotates interrupted messages"
```

---

### Task 6: Fix downstream packages (agent-sessions, agent-sdk)

Fix compile errors in packages that depend on agent-core message types.

**Files:**

- Modify: any files in agent-sessions, agent-sdk that construct messages without id/state

- [ ] **Step 1: Build all downstream packages**

Run: `pnpm build 2>&1 | grep -E "error TS"` to find all compile errors.

- [ ] **Step 2: Fix each error**

For each file with a compile error:

- If constructing a message literal: add `id: randomUUID()` and `state: 'complete'`
- If using a factory: no change needed (factories already generate id/state)
- If in test files: add missing fields to test message objects

- [ ] **Step 3: Build and test all**

Run: `pnpm build && pnpm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -p  # stage only the fixed files
git commit -m "fix: add id and state to all message literals across packages"
```

---

### Task 7: CLI — delete IChatMessage, use TUniversalMessage

Replace `IChatMessage` with `TUniversalMessage` throughout agent-cli.

**Files:**

- Modify: `packages/agent-cli/src/ui/types.ts`
- Modify: `packages/agent-cli/src/ui/hooks/useMessages.ts`
- Modify: `packages/agent-cli/src/ui/hooks/useSubmitHandler.ts`
- Modify: `packages/agent-cli/src/ui/hooks/useSession.ts`
- Modify: `packages/agent-cli/src/ui/MessageList.tsx`
- Modify: `packages/agent-cli/src/ui/App.tsx`
- Modify: other files that import IChatMessage

- [ ] **Step 1: Remove IChatMessage from types.ts**

In `packages/agent-cli/src/ui/types.ts`, remove the `IChatMessage` interface. Keep `TPermissionResult` and `IPermissionRequest`.

Note: `IChatMessage.permissionResult` has no equivalent in `TUniversalMessage`. Permission results are UI-only transient state — they are NOT stored in conversation history. If permission display is needed, use `TUniversalMessageMetadata` on the system message that reports the permission result. Check how permission results are currently used in MessageList and remove or migrate.

- [ ] **Step 2: Update useMessages.ts**

Change `IChatMessage[]` to `TUniversalMessage[]`. Use message factories instead of raw object construction:

```typescript
import {
  TUniversalMessage,
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  createToolMessage,
} from '@robota-sdk/agent-core';

const MAX_RENDERED_MESSAGES = 100;

export type TAddMessage = (msg: TUniversalMessage) => void;

export function useMessages(): {
  messages: TUniversalMessage[];
  setMessages: React.Dispatch<React.SetStateAction<TUniversalMessage[]>>;
  addMessage: TAddMessage;
} {
  const [messages, setMessages] = useState<TUniversalMessage[]>([]);

  const addMessage = useCallback((msg: TUniversalMessage) => {
    setMessages((prev) => {
      const next = [...prev, msg];
      return next.length > MAX_RENDERED_MESSAGES
        ? next.slice(next.length - MAX_RENDERED_MESSAGES)
        : next;
    });
  }, []);

  return { messages, setMessages, addMessage };
}
```

- [ ] **Step 3: Update useSubmitHandler.ts**

Change `TAddMessage` type to accept `TUniversalMessage`. Update all `addMessage(...)` calls to use factories:

```typescript
// Before: addMessage({ role: 'user', content: input })
// After:
addMessage(createUserMessage(input));

// Before: addMessage({ role: 'assistant', content: response })
// After:
addMessage(createAssistantMessage(response));

// Before: addMessage({ role: 'system', content: 'Cancelled.' })
// After:
addMessage(createSystemMessage('Cancelled.'));

// Before: addMessage({ role: 'tool', content: JSON.stringify(toolSummaries), toolName: '...' })
// After: UI-only tool summary — use unique id, not added to ConversationSession
addMessage(
  createToolMessage(JSON.stringify(toolSummaries), {
    toolCallId: randomUUID(),
    name: toolSummaryLabel,
  }),
);
```

Remove `getStreamingText` parameter and related code — interrupted messages are now in history via `commitAssistant`.

- [ ] **Step 4: Update useSession.ts**

Remove `getStreamingText` and `streamingTextRef`. The `clearStreamingText` returns to its original form.

- [ ] **Step 5: Update MessageList.tsx**

Change `IChatMessage` to `TUniversalMessage`. Update field access:

- `message.id` → already on `IBaseMessage` (no change needed)
- `message.toolName` → use `isToolMessage(message) ? message.name : undefined`
- `message.content` → for union type, use type guards for role-specific access
- Add interrupted indicator for `message.state === 'interrupted'`

- [ ] **Step 6: Update App.tsx**

Remove `IChatMessage` import. Remove `getStreamingText` from `useSession` destructuring and `useSubmitHandler` call.

- [ ] **Step 7: Update all other files importing IChatMessage**

Search: `grep -r "IChatMessage" packages/agent-cli/src/`
Fix each file.

- [ ] **Step 8: Build and test**

Run: `pnpm --filter @robota-sdk/agent-cli build && pnpm --filter @robota-sdk/agent-cli test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/agent-cli/src/
git commit -m "refactor(agent-cli): replace IChatMessage with TUniversalMessage (SSOT)"
```

---

### Task 8: SPEC.md updates

Update each package's SPEC.md with the new contracts.

**Files:**

- Modify: `packages/agent-core/docs/SPEC.md`
- Modify: `packages/agent-sessions/docs/SPEC.md`
- Modify: `packages/agent-cli/docs/SPEC.md`

- [ ] **Step 1: Update agent-core SPEC.md**

Add/update sections:

- `IBaseMessage`: document `id`, `state` fields
- `TMessageState`: type definition and semantics
- `ConversationSession`: document `appendStreaming`, `appendToolCall`, `commitAssistant`, `discardPending`
- `getMessagesForAPI`: document interrupted message annotation
- Message factories: document id generation and state parameter

- [ ] **Step 2: Update agent-sessions SPEC.md**

Document abort flow: signal → commitAssistant('interrupted') → AbortError

- [ ] **Step 3: Update agent-cli SPEC.md**

Document:

- `IChatMessage` deleted — uses `TUniversalMessage` from agent-core
- Message display uses `msg.state` for interrupted indicator
- `msg.id` used as React key

- [ ] **Step 4: Commit**

```bash
git add packages/agent-core/docs/SPEC.md packages/agent-sessions/docs/SPEC.md packages/agent-cli/docs/SPEC.md
git commit -m "docs: update SPEC.md for conversation history architecture (CORE-BL-002)"
```

---

### Task 9: Verification

Full build, test, and SPEC conformance check.

- [ ] **Step 1: Full build**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 3: SPEC-code conformance check**

Verify each SPEC.md claim matches the code:

- IBaseMessage has id and state
- TMessageState is 'complete' | 'interrupted'
- Factories generate id and state
- ConversationSession has appendStreaming, appendToolCall, commitAssistant
- executeRound uses streaming flow
- getMessagesForAPI annotates interrupted
- IChatMessage does not exist in CLI
- CLI uses TUniversalMessage

- [ ] **Step 4: Manual test**

Test with `pnpm run cli:dev`:

1. Send a prompt → response appears normally
2. Press ESC during streaming → "Cancelled." with interrupted message in history
3. Send another prompt → model sees interrupted message in context
4. Verify `msg.id` used as React key (no duplicate key warnings)

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인
