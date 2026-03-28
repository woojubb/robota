/**
 * In-memory conversation history implementations.
 *
 * SimpleConversationHistory and PersistentSystemConversationHistory.
 */
import type {
  TUniversalMessageMetadata,
  TUniversalMessageRole,
  IToolCall,
  TUniversalMessage,
  TUniversalMessagePart,
  IHistoryEntry,
} from '../interfaces/messages';
import {
  isSystemMessage,
  messageToHistoryEntry,
  chatEntryToMessage,
  isChatEntry,
} from '../interfaces/messages';
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
  private entries: IHistoryEntry[] = [];

  constructor(options?: { maxMessages?: number }) {
    this.maxMessages = options?.maxMessages || 0;
  }

  /** Add a chat message (converted to IHistoryEntry internally) */
  addMessage(message: TUniversalMessage): void {
    this.entries.push(messageToHistoryEntry(message));
    this.applyMessageLimit();
  }

  /** Add a raw history entry (for events, etc.) */
  addEntry(entry: IHistoryEntry): void {
    this.entries.push(entry);
  }

  /** Get all history entries (universal timeline) */
  getHistory(): IHistoryEntry[] {
    return [...this.entries];
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

  /** Get chat messages only (backward compatible) */
  getMessages(): TUniversalMessage[] {
    return this.entries.filter(isChatEntry).map(chatEntryToMessage);
  }
  getMessagesByRole(role: TUniversalMessageRole): TUniversalMessage[] {
    return this.getMessages().filter((m) => m.role === role);
  }
  getRecentMessages(count: number): TUniversalMessage[] {
    return this.getMessages().slice(-count);
  }
  getMessageCount(): number {
    return this.entries.filter(isChatEntry).length;
  }
  clear(): void {
    this.entries = [];
  }

  /** @internal — limits chat entries only, preserves event entries */
  protected applyMessageLimit(): void {
    if (this.maxMessages <= 0) return;
    const chatEntries = this.entries.filter(isChatEntry);
    if (chatEntries.length <= this.maxMessages) return;

    const chatMessages = chatEntries.map(chatEntryToMessage);
    const systemMessages = chatMessages.filter(isSystemMessage);
    const nonSystem = chatMessages.filter((msg) => !isSystemMessage(msg));
    const available = Math.max(0, this.maxMessages - systemMessages.length);
    const keepMessages = [...systemMessages, ...nonSystem.slice(-available)];
    const keepIds = new Set(keepMessages.map((m) => m.id));

    // Keep all event entries + kept chat entries
    this.entries = this.entries.filter((e) => !isChatEntry(e) || keepIds.has(e.id));
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
  addEntry(entry: IHistoryEntry): void {
    this.history.addEntry(entry);
  }
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
