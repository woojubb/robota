/**
 * ConversationStore — streaming state management and API format conversion.
 *
 * In-memory history classes live in ./conversation-store-history.ts.
 */
import { randomUUID } from 'node:crypto';
import type {
  TUniversalMessageMetadata,
  TUniversalMessageRole,
  IToolCall,
  TUniversalMessage,
  TUniversalMessagePart,
  IAssistantMessage,
  IHistoryEntry,
  TMessageState,
} from '../interfaces/messages';
import { isAssistantMessage, isToolMessage } from '../interfaces/messages';
import type { IConversationHistory } from './conversation-history-manager';
import { SimpleConversationHistory } from './conversation-store-history';

/** API message format for provider consumption */
export interface IProviderApiMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

/** State of an in-progress assistant response being streamed */
interface IStreamingState {
  id: string;
  content: string;
  toolCalls: IToolCall[];
}

/**
 * Conversation store with duplicate prevention and API format conversion.
 * @public
 */
export class ConversationStore implements IConversationHistory {
  private history: SimpleConversationHistory;
  private toolCallIds: Set<string> = new Set<string>();
  private pendingAssistant: IStreamingState | null = null;

  constructor(maxMessages: number = 100) {
    this.history = new SimpleConversationHistory({ maxMessages });
  }

  addMessage(message: TUniversalMessage): void {
    this.history.addMessage(message);
  }
  addUserMessage(
    content: string,
    metadata?: TUniversalMessageMetadata,
    parts?: TUniversalMessagePart[],
  ): void {
    this.history.addUserMessage(content, metadata, parts);
  }
  addAssistantMessage(
    content: string | null,
    toolCalls?: IToolCall[],
    metadata?: TUniversalMessageMetadata,
    parts?: TUniversalMessagePart[],
  ): void {
    this.history.addAssistantMessage(content, toolCalls, metadata, parts);
  }
  addSystemMessage(
    content: string,
    metadata?: TUniversalMessageMetadata,
    parts?: TUniversalMessagePart[],
  ): void {
    this.history.addSystemMessage(content, metadata, parts);
  }

  addToolMessage(
    content: string,
    toolCallId: string,
    toolName?: string,
    metadata?: TUniversalMessageMetadata,
    parts?: TUniversalMessagePart[],
  ): void {
    this.history.addToolMessageWithId(content, toolCallId, toolName || 'unknown', metadata, parts);
  }

  addToolMessageWithId(
    content: string,
    toolCallId: string,
    toolName: string,
    metadata?: TUniversalMessageMetadata,
    parts?: TUniversalMessagePart[],
  ): void {
    if (this.toolCallIds.has(toolCallId)) {
      throw new Error(
        `Duplicate tool message detected for toolCallId: ${toolCallId}. Tool messages must have unique toolCallIds.`,
      );
    }
    this.toolCallIds.add(toolCallId);
    this.history.addToolMessageWithId(content, toolCallId, toolName, metadata, parts);
  }

  /** Add a raw history entry (events, etc.) */
  addEntry(entry: IHistoryEntry): void {
    this.history.addEntry(entry);
  }

  /** Get all history entries (universal timeline) */
  getHistory(): IHistoryEntry[] {
    return this.history.getHistory();
  }

  getMessages(): TUniversalMessage[] {
    return this.history.getMessages();
  }
  getMessagesByRole(role: TUniversalMessageRole): TUniversalMessage[] {
    return this.history.getMessagesByRole(role);
  }
  getRecentMessages(count: number): TUniversalMessage[] {
    return this.history.getRecentMessages(count);
  }
  getMessageCount(): number {
    return this.history.getMessageCount();
  }

  /** Begin a new assistant response. Must be called before provider call.
   *  Ensures pendingAssistant exists so commitAssistant always has data to save. */
  beginAssistant(): void {
    if (!this.pendingAssistant) {
      this.pendingAssistant = {
        id: randomUUID(),
        content: '',
        toolCalls: [],
      };
    }
  }

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
   * Precondition: beginAssistant() must have been called before the provider call.
   * History is append-only — this always adds a message.
   */
  commitAssistant(state: TMessageState, metadata?: TUniversalMessageMetadata): void {
    if (!this.pendingAssistant) return; // No pending state — error paths use addAssistantMessage directly
    const pending = this.pendingAssistant;
    const hasToolCalls = pending.toolCalls.length > 0;
    // History records everything — text is always preserved.
    // Context savings is compaction's responsibility, not history's.
    const content = pending.content;
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

  /** Returns true if there is accumulated pending assistant state (streaming or tool calls) */
  hasPendingAssistant(): boolean {
    return this.pendingAssistant !== null;
  }

  /** Get pending assistant content (empty string if no content streamed yet) */
  getPendingContent(): string {
    return this.pendingAssistant?.content ?? '';
  }

  getMessagesForAPI(): IProviderApiMessage[] {
    return this.history.getMessages().map((msg) => {
      const apiMsg: IProviderApiMessage = { role: msg.role, content: msg.content };
      // Annotate interrupted assistant messages for model awareness
      if (isAssistantMessage(msg) && msg.state === 'interrupted') {
        apiMsg.content = (apiMsg.content || '') + '\n\n[This response was interrupted by the user]';
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

  clear(): void {
    this.history.clear();
    this.toolCallIds.clear();
  }
}
