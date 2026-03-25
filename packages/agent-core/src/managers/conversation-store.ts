/**
 * Conversation store implementations.
 *
 * Extracted from conversation-history-manager.ts.
 */
import { randomUUID } from 'node:crypto';
import type {
  TUniversalMessageMetadata,
  TUniversalMessageRole,
  IToolCall,
  TUniversalMessage,
  TUniversalMessagePart,
  TMessageState,
  IAssistantMessage,
} from '../interfaces/messages';
import { isSystemMessage, isAssistantMessage, isToolMessage } from '../interfaces/messages';
import {
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  createToolMessage,
} from './conversation-message-factory';
import type { IConversationHistory } from './conversation-history-manager';

/**
 * Default conversation history implementation.
 * In-memory storage with optional message count limiting.
 * @public
 */
export class SimpleConversationHistory implements IConversationHistory {
  protected readonly maxMessages: number;
  private messages: TUniversalMessage[] = [];

  constructor(options?: { maxMessages?: number }) {
    this.maxMessages = options?.maxMessages || 0;
  }

  addMessage(message: TUniversalMessage): void {
    this.messages.push(message);
    this.messages = this.applyMessageLimit(this.messages);
  }

  addUserMessage(
    content: string,
    metadata?: TUniversalMessageMetadata,
    parts?: TUniversalMessagePart[],
  ): void {
    this.addMessage(
      createUserMessage(content, { ...(metadata && { metadata }), ...(parts && { parts }) }),
    );
  }

  addAssistantMessage(
    content: string | null,
    toolCalls?: IToolCall[],
    metadata?: TUniversalMessageMetadata,
    parts?: TUniversalMessagePart[],
  ): void {
    this.addMessage(
      createAssistantMessage(content, {
        ...(toolCalls && { toolCalls }),
        ...(metadata && { metadata }),
        ...(parts && { parts }),
      }),
    );
  }

  addSystemMessage(
    content: string,
    metadata?: TUniversalMessageMetadata,
    parts?: TUniversalMessagePart[],
  ): void {
    this.addMessage(
      createSystemMessage(content, { ...(metadata && { metadata }), ...(parts && { parts }) }),
    );
  }

  addToolMessageWithId(
    content: string,
    toolCallId: string,
    toolName: string,
    metadata?: TUniversalMessageMetadata,
    parts?: TUniversalMessagePart[],
  ): void {
    this.addMessage(
      createToolMessage(content, {
        toolCallId,
        name: toolName,
        ...(metadata && { metadata }),
        ...(parts && { parts }),
      }),
    );
  }

  getMessages(): TUniversalMessage[] {
    return [...this.messages];
  }
  getMessagesByRole(role: TUniversalMessageRole): TUniversalMessage[] {
    return this.messages.filter((m) => m.role === role);
  }
  getRecentMessages(count: number): TUniversalMessage[] {
    return this.messages.slice(-count);
  }
  getMessageCount(): number {
    return this.messages.length;
  }
  clear(): void {
    this.messages = [];
  }

  /** @internal */
  protected applyMessageLimit(messages: TUniversalMessage[]): TUniversalMessage[] {
    if (this.maxMessages > 0 && messages.length > this.maxMessages) {
      const systemMessages = messages.filter(isSystemMessage);
      const nonSystem = messages.filter((msg) => !isSystemMessage(msg));
      const available = Math.max(0, this.maxMessages - systemMessages.length);
      return [...systemMessages, ...nonSystem.slice(-available)];
    }
    return messages;
  }
}

/**
 * Conversation history with persistent system prompt.
 * @public
 */
export class PersistentSystemConversationHistory implements IConversationHistory {
  private readonly history: SimpleConversationHistory;
  private systemPrompt: string;

  constructor(systemPrompt: string, options?: { maxMessages?: number }) {
    this.systemPrompt = systemPrompt;
    this.history = new SimpleConversationHistory(options);
    this.history.addSystemMessage(this.systemPrompt);
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
  addToolMessageWithId(
    content: string,
    toolCallId: string,
    toolName: string,
    metadata?: TUniversalMessageMetadata,
    parts?: TUniversalMessagePart[],
  ): void {
    this.history.addToolMessageWithId(content, toolCallId, toolName, metadata, parts);
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

  clear(): void {
    this.history.clear();
    this.history.addSystemMessage(this.systemPrompt);
  }

  updateSystemPrompt(systemPrompt: string): void {
    this.systemPrompt = systemPrompt;
    const nonSystem = this.history.getMessages().filter((msg) => !isSystemMessage(msg));
    this.history.clear();
    this.history.addSystemMessage(this.systemPrompt);
    nonSystem.forEach((message) => this.history.addMessage(message));
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }
}

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
