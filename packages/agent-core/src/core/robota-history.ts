/**
 * History helper functions for the Robota agent.
 *
 * These standalone functions operate on ConversationHistory + a conversationId,
 * extracted from core/robota.ts to keep that file under 300 lines.
 */
import type { TUniversalMessage } from '../interfaces/agent';
import type { IHistoryEntry } from '../interfaces/messages';
import type { ConversationHistory } from '../managers/conversation-history-manager';

/**
 * Return the current conversation messages as TUniversalMessage[].
 */
export function getHistory(
  conversationHistory: ConversationHistory,
  conversationId: string,
): TUniversalMessage[] {
  const session = conversationHistory.getConversationStore(conversationId);
  return session.getMessages().map((msg) => ({
    id: msg.id,
    role: msg.role,
    content: msg.content,
    state: msg.state,
    timestamp: msg.timestamp,
    metadata: msg.metadata,
    ...(msg.role === 'assistant' && 'toolCalls' in msg ? { toolCalls: msg.toolCalls } : {}),
    ...(msg.role === 'tool' && 'toolCallId' in msg
      ? { toolCallId: (msg as { toolCallId: string }).toolCallId }
      : {}),
    ...(msg.role === 'tool' && 'name' in msg ? { name: (msg as { name: string }).name } : {}),
  })) as TUniversalMessage[];
}

/**
 * Return the full history timeline (IHistoryEntry[]) including events.
 */
export function getFullHistory(
  conversationHistory: ConversationHistory,
  conversationId: string,
): IHistoryEntry[] {
  const store = conversationHistory.getConversationStore(conversationId);
  return store.getHistory();
}

/**
 * Add an event entry to history.
 */
export function addHistoryEntry(
  conversationHistory: ConversationHistory,
  conversationId: string,
  entry: IHistoryEntry,
): void {
  const store = conversationHistory.getConversationStore(conversationId);
  store.addEntry(entry);
}

/**
 * Clear all messages in the conversation.
 */
export function clearHistory(
  conversationHistory: ConversationHistory,
  conversationId: string,
): void {
  conversationHistory.getConversationStore(conversationId).clear();
}

/**
 * Inject a message into conversation history without triggering execution.
 */
export function injectMessage(
  conversationHistory: ConversationHistory,
  conversationId: string,
  role: 'user' | 'assistant' | 'system' | 'tool',
  content: string,
  options?: { toolCallId?: string; name?: string },
): void {
  const session = conversationHistory.getConversationStore(conversationId);
  if (role === 'tool' && options?.toolCallId) {
    session.addToolMessageWithId(content, options.toolCallId, options.name ?? 'unknown');
  } else if (role === 'assistant') {
    session.addAssistantMessage(content, []);
  } else if (role === 'system') {
    session.addSystemMessage(content);
  } else {
    session.addUserMessage(content);
  }
}
