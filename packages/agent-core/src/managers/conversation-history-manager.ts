/**
 * Multi-session conversation history manager.
 *
 * Message factories live in ./conversation-message-factory.ts.
 * Session implementations live in ./conversation-session.ts.
 */
import { createLogger, type ILogger } from '../utils/logger';
import type {
  TUniversalMessageMetadata,
  TUniversalMessageRole,
  IToolCall,
  TUniversalMessage,
  TUniversalMessagePart,
} from '../interfaces/messages';

// Re-export type guards from interfaces (SSOT)
export {
  isUserMessage,
  isAssistantMessage,
  isSystemMessage,
  isToolMessage,
} from '../interfaces/messages';

// Re-export factory functions from conversation-message-factory
export {
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  createToolMessage,
} from './conversation-message-factory';

export {
  SimpleConversationHistory,
  PersistentSystemConversationHistory,
  ConversationSession,
} from './conversation-session';

export type { IProviderApiMessage } from './conversation-session';

import { ConversationSession } from './conversation-session';

const DEFAULT_MAX_MESSAGES_PER_CONVERSATION = 100;
const DEFAULT_MAX_CONVERSATIONS = 50;

/** Interface for managing conversation history. @public */
export interface IConversationHistory {
  addMessage(message: TUniversalMessage): void;
  addUserMessage(
    content: string,
    metadata?: TUniversalMessageMetadata,
    parts?: TUniversalMessagePart[],
  ): void;
  addAssistantMessage(
    content: string | null,
    toolCalls?: IToolCall[],
    metadata?: TUniversalMessageMetadata,
    parts?: TUniversalMessagePart[],
  ): void;
  addSystemMessage(
    content: string,
    metadata?: TUniversalMessageMetadata,
    parts?: TUniversalMessagePart[],
  ): void;
  addToolMessageWithId(
    content: string,
    toolCallId: string,
    toolName: string,
    metadata?: TUniversalMessageMetadata,
    parts?: TUniversalMessagePart[],
  ): void;
  getMessages(): TUniversalMessage[];
  getMessagesByRole(role: TUniversalMessageRole): TUniversalMessage[];
  getRecentMessages(count: number): TUniversalMessage[];
  clear(): void;
  getMessageCount(): number;
}

/** Configuration options for ConversationHistory manager */
export interface IConversationHistoryOptions {
  maxMessagesPerConversation?: number;
  maxConversations?: number;
}

/** Multi-session conversation history manager. @public */
export class ConversationHistory {
  private conversations = new Map<string, ConversationSession>();
  private logger: ILogger;
  private readonly maxMessagesPerConversation: number;
  private readonly maxConversations: number;

  constructor(options: IConversationHistoryOptions = {}) {
    this.maxMessagesPerConversation =
      options.maxMessagesPerConversation || DEFAULT_MAX_MESSAGES_PER_CONVERSATION;
    this.maxConversations = options.maxConversations || DEFAULT_MAX_CONVERSATIONS;
    this.logger = createLogger('ConversationHistory');
  }

  getConversationSession(conversationId: string): ConversationSession {
    if (!this.conversations.has(conversationId)) {
      if (this.conversations.size >= this.maxConversations) this.cleanupOldConversations();
      this.conversations.set(
        conversationId,
        new ConversationSession(this.maxMessagesPerConversation),
      );
    }
    return this.conversations.get(conversationId)!;
  }

  hasConversation(conversationId: string): boolean {
    return this.conversations.has(conversationId);
  }

  removeConversation(conversationId: string): boolean {
    const removed = this.conversations.delete(conversationId);
    if (removed) this.logger.debug('Removed conversation', { conversationId });
    return removed;
  }

  clearAll(): void {
    const count = this.conversations.size;
    this.conversations.clear();
    this.logger.debug('Cleared all conversations', { removedCount: count });
  }

  getStats(): { totalConversations: number; conversationIds: string[]; totalMessages: number } {
    const conversationIds = Array.from(this.conversations.keys());
    const totalMessages = Array.from(this.conversations.values()).reduce(
      (sum, s) => sum + s.getMessageCount(),
      0,
    );
    return { totalConversations: this.conversations.size, conversationIds, totalMessages };
  }

  /** @internal */
  private cleanupOldConversations(): void {
    if (this.conversations.size === 0) return;
    const firstKey = this.conversations.keys().next().value;
    if (firstKey) this.conversations.delete(firstKey);
  }
}
