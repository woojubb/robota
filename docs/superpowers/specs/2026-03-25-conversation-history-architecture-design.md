# Conversation History Architecture Design

## Goal

Rebuild conversation history as a proper foundation: transparent recording of all data, single message type (SSOT), streaming state managed by core, and separation of recording from usage.

## Principles

- **Type SSOT**: `TUniversalMessage` is the single canonical message type. No parallel types (`IChatMessage` etc.)
- **Inheritance only**: Extended types must inherit from base. No separate parallel types for the same data.
- **Single path**: No if/else branching between normal and abort. One save path for all cases.
- **Foundation first**: Changes start at agent-core (lowest layer) and propagate upward.
- **No backward compatibility**: Project is pre-release. Required fields are required.

---

## 1. Type Changes (agent-core)

### TMessageState

```typescript
type TMessageState = 'complete' | 'interrupted';
```

This type applies to `IAssistantMessage` only. Other message roles (user, system, tool) are always `'complete'`.

### IBaseMessage

```typescript
interface IBaseMessage {
  id: string; // unique message identifier (UUID)
  timestamp: Date;
  state: TMessageState; // required — every message has a state
  metadata?: TUniversalMessageMetadata;
}
```

All messages have `state`. For non-assistant messages, factories always set `state: 'complete'`. Only assistant messages may have `state: 'interrupted'`.

### Message Factories

All factory functions (`createUserMessage`, `createAssistantMessage`, etc.):

- `id`: auto-generated UUID (e.g., `crypto.randomUUID()`)
- `state`: `'complete'` by default. `createAssistantMessage` accepts optional `state` parameter.

### IChatMessage Deletion

`IChatMessage` (agent-cli) is deleted. CLI uses `TUniversalMessage` directly. The `id` field that was CLI-only is now in `IBaseMessage`.

## 2. ConversationSession Streaming State (agent-core)

### IStreamingState

```typescript
interface IStreamingState {
  id: string; // generated when streaming starts
  content: string; // accumulated text from onTextDelta
  toolCalls: IToolCall[]; // accumulated tool calls from streaming events
}
```

`id` is generated when `appendStreaming()` first creates the pending state. This ensures the committed message has a valid `id`.

### ConversationSession changes

`ConversationSession` currently wraps `SimpleConversationHistory` via delegation. The new streaming methods are added to `ConversationSession` (the public-facing class), not to `SimpleConversationHistory` (internal):

```typescript
class ConversationSession {
  // Existing: delegates to SimpleConversationHistory
  private history: SimpleConversationHistory;
  private toolCallIds: Set<string>;

  // Removed: toolCallIds: Set<string> — deduplication moved into appendToolCall()
  // New: streaming state
  private pendingAssistant: IStreamingState | null = null;

  appendStreaming(delta: string): void {
    if (!this.pendingAssistant) {
      this.pendingAssistant = {
        id: crypto.randomUUID(),
        content: '',
        toolCalls: [],
      };
    }
    this.pendingAssistant.content += delta;
  }

  appendToolCall(toolCall: IToolCall): void {
    if (!this.pendingAssistant) {
      this.pendingAssistant = {
        id: crypto.randomUUID(),
        content: '',
        toolCalls: [],
      };
    }
    // Deduplicate by toolCall.id (replaces the old toolCallIds Set)
    if (!this.pendingAssistant.toolCalls.some((tc) => tc.id === toolCall.id)) {
      this.pendingAssistant.toolCalls.push(toolCall);
    }
  }

  /**
   * Commit the pending assistant message to history.
   * Precondition: appendStreaming() or appendToolCall() must have been called first.
   * If pendingAssistant is null (no streaming occurred), this is a no-op — callers
   * on error paths should use addAssistantMessage() directly instead.
   */
  commitAssistant(state: TMessageState, metadata?: TUniversalMessageMetadata): void {
    if (!this.pendingAssistant) return;

    const pending = this.pendingAssistant;

    // Content stripping for tool-calling messages:
    // When tool calls exist, text was already streamed to the user.
    // Strip text from history to save context tokens.
    const hasToolCalls = pending.toolCalls.length > 0;
    const content = hasToolCalls ? '' : pending.content;

    const message: IAssistantMessage = {
      id: pending.id,
      role: 'assistant',
      content,
      state,
      timestamp: new Date(),
      toolCalls: hasToolCalls ? pending.toolCalls : undefined,
      metadata,
    };

    this.history.addMessage(message);
    this.pendingAssistant = null;
  }

  discardPending(): void {
    this.pendingAssistant = null;
  }

  // Existing methods unchanged:
  addUserMessage(content, metadata?, parts?): void; // uses factory, state: 'complete'
  addSystemMessage(content, metadata?, parts?): void; // uses factory, state: 'complete'
  addToolMessageWithId(content, id, name, meta?): void; // uses factory, state: 'complete'
  getMessages(): TUniversalMessage[]; // returns confirmed messages only
}
```

### Content stripping preserved

The current behavior of stripping text from assistant messages that have tool calls is preserved inside `commitAssistant()`. This is not a new behavior — it moves from executeRound into ConversationSession where it belongs (history policy is the session's concern).

### Error-path messages

Two existing `addAssistantMessage` calls in executeRound are for error injection (context overflow at line 513, provider error at line 546). These do NOT go through streaming — they are direct error messages. These are converted to:

```typescript
// Error messages bypass streaming — use addAssistantMessage directly
conversationSession.addAssistantMessage(errorContent, [], { round, providerError: true });
```

`addAssistantMessage` remains as a method for non-streaming assistant messages (errors, injected summaries). The normal response path uses `appendStreaming` → `commitAssistant`.

## 3. executeRound Changes (agent-core)

### onTextDelta wiring

```typescript
// In executeRound, before provider call:
const externalOnTextDelta = chatOptions.onTextDelta;

chatOptions.onTextDelta = (delta: string) => {
  conversationSession.appendStreaming(delta); // core accumulation
  externalOnTextDelta?.(delta); // CLI UI callback (passthrough)
};
```

### Tool call accumulation

Tool calls arrive through the provider's final response (not through onTextDelta). After provider returns:

```typescript
response = await callProviderWithCache(msgs, chatOptions);

// Extract tool calls from provider response and add to pending state
const { assistantToolCalls } = validateAndExtractResponse(response, ...);
for (const tc of assistantToolCalls) {
  conversationSession.appendToolCall(tc);
}
```

Tool calls are extracted from the provider response (the authoritative source for tool_use blocks) and appended to the pending state. `onTextDelta` only delivers text — tool calls come from the structured response.

### Single commit path

```typescript
// Single path — same for normal and abort
const state: TMessageState = signal?.aborted ? 'interrupted' : 'complete';
conversationSession.commitAssistant(state, {
  round: currentRound,
  ...(inputTokens > 0 && { inputTokens }),
  ...(outputTokens > 0 && { outputTokens }),
});
```

`signal?.aborted` is a ternary determining the state value, not an if/else branch with different logic paths. The commit, content source, and metadata construction are identical.

### Existing addAssistantMessage call replaced

The current line `conversationSession.addAssistantMessage(contentForHistory, assistantToolCalls, metadata)` is replaced by the `appendStreaming` → `appendToolCall` → `commitAssistant` flow.

## 4. history → provider Transformation (agent-core)

`getMessagesForAPI()` on `ConversationSession` handles `state: 'interrupted'` messages:

```typescript
getMessagesForAPI(): IProviderApiMessage[] {
  return this.history.getMessages().map((msg) => {
    const apiMsg: IProviderApiMessage = { role: msg.role, content: msg.content };

    // Annotate interrupted assistant messages for model awareness
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

Uses type guards (`isAssistantMessage`, `isToolMessage`) for type-safe access to role-specific fields. `IProviderApiMessage` interface is unchanged.

## 5. Session Layer Changes (agent-sessions)

`Session.run()` on abort:

- The signal propagates through ExecutionService → executeRound
- executeRound calls `commitAssistant('interrupted')` before returning (same path as normal)
- ExecutionService round loop exits via `signal.aborted` check
- Session.run() checks `signal.aborted` → throws AbortError
- No Session-level history manipulation needed

**Verification criteria for step 6**: Confirm that `commitAssistant('interrupted')` is called before the AbortError reaches Session. Test by aborting during streaming and checking that the interrupted message appears in `session.getHistory()`.

## 6. CLI Changes (agent-cli)

### Delete IChatMessage

- Remove `IChatMessage` interface from `packages/agent-cli/src/ui/types.ts`
- All components use `TUniversalMessage` from `@robota-sdk/agent-core`

### useMessages hook

- `messages` state: `TUniversalMessage[]`
- `addMessage`: accepts full `TUniversalMessage` (use factory functions to create)
- No `Partial` — message factories handle `id` and `state` generation

### MessageList, StreamingIndicator

- Render `TUniversalMessage` directly
- Use `msg.state === 'interrupted'` to show interrupted indicator
- Use `msg.id` as React key (replaces client-generated UUID)

### useSubmitHandler

- On abort: no need to capture `getStreamingText()` — the interrupted message is already in history via `commitAssistant('interrupted')`. Extract from `session.getHistory()` instead.
- Tool summaries: extract from history as before.

## Implementation Order (bottom-up)

```
1. agent-core: TMessageState type, IBaseMessage + id + state
2. agent-core: Message factories — id generation, state parameter
3. agent-core: ConversationSession — IStreamingState, appendStreaming, appendToolCall, commitAssistant
4. agent-core: executeRound — use appendStreaming/appendToolCall/commitAssistant
5. agent-core: getMessagesForAPI — interrupted message annotation with type guards
6. agent-sessions: Verify abort flow — commitAssistant('interrupted') reached before AbortError
7. agent-cli: Delete IChatMessage, use TUniversalMessage, use msg.id as key
8. Each package: Update SPEC.md with new contracts
9. Verify: SPEC.md ↔ code conformance check for all modified packages
```

## File Structure

```
packages/agent-core/
├─ src/interfaces/messages.ts            [MODIFY] IBaseMessage + id + state, TMessageState
├─ src/managers/conversation-message-factory.ts [MODIFY] id generation, state parameter
├─ src/managers/conversation-session.ts  [MODIFY] IStreamingState, appendStreaming, appendToolCall, commitAssistant
├─ src/services/execution-round.ts       [MODIFY] Use appendStreaming/commitAssistant flow
├─ docs/SPEC.md                          [MODIFY] Message model, streaming state, commit flow

packages/agent-sessions/
├─ src/session.ts                        [VERIFY] Abort flow with new ConversationSession
├─ docs/SPEC.md                          [MODIFY] Abort + commitAssistant verification

packages/agent-cli/
├─ src/ui/types.ts                       [MODIFY] Remove IChatMessage
├─ src/ui/hooks/useMessages.ts           [MODIFY] TUniversalMessage[]
├─ src/ui/hooks/useSubmitHandler.ts      [MODIFY] TUniversalMessage, remove getStreamingText
├─ src/ui/hooks/useSession.ts            [MODIFY] Remove getStreamingText (no longer needed)
├─ src/ui/MessageList.tsx                [MODIFY] Render TUniversalMessage with msg.id key
├─ src/ui/App.tsx                        [MODIFY] TUniversalMessage wiring
├─ docs/SPEC.md                          [MODIFY] Type unification, interrupted display
```
