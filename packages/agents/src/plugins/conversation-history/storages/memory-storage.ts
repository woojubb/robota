import { HistoryStorage, ConversationHistoryEntry } from '../types';

/**
 * Memory storage implementation
 */
export class MemoryHistoryStorage implements HistoryStorage {
    private conversations = new Map<string, ConversationHistoryEntry>();
    private maxConversations: number;

    constructor(maxConversations: number = 100) {
        this.maxConversations = maxConversations;
    }

    async save(conversationId: string, entry: ConversationHistoryEntry): Promise<void> {
        // Remove oldest conversation if limit exceeded
        if (this.conversations.size >= this.maxConversations && !this.conversations.has(conversationId)) {
            const oldestId = this.conversations.keys().next().value;
            if (oldestId) {
                this.conversations.delete(oldestId);
            }
        }

        this.conversations.set(conversationId, { ...entry });
    }

    async load(conversationId: string): Promise<ConversationHistoryEntry | undefined> {
        return this.conversations.get(conversationId);
    }

    async list(): Promise<string[]> {
        return Array.from(this.conversations.keys());
    }

    async delete(conversationId: string): Promise<boolean> {
        return this.conversations.delete(conversationId);
    }

    async clear(): Promise<void> {
        this.conversations.clear();
    }
} 