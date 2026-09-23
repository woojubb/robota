/**
 * Shared type for ConversationHistory manager and its store implementations.
 *
 * Extracted so `conversation-store.ts` and `conversation-store-history.ts` can both depend on
 * this type without importing from `conversation-history-manager.ts`, which imports
 * `ConversationStore` from `conversation-store.ts` — a module-level import cycle.
 */
import type {
  TUniversalMessageMetadata,
  TUniversalMessageRole,
  IToolCall,
  TUniversalMessage,
  TUniversalMessagePart,
  IHistoryEntry,
} from '../interfaces/messages';

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
  addEntry(entry: IHistoryEntry): void;
  getHistory(): IHistoryEntry[];
  getMessages(): TUniversalMessage[];
  getMessagesByRole(role: TUniversalMessageRole): TUniversalMessage[];
  getRecentMessages(count: number): TUniversalMessage[];
  clear(): void;
  getMessageCount(): number;
}
