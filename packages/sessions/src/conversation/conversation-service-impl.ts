// Facade for conversation service - leverages core package
import type { UniversalMessage } from '@robota-sdk/core';
import { SimpleConversationHistory } from '../conversation-history/simple-conversation-history';

export interface ConversationService {
    addMessage(message: UniversalMessage): void;
    getMessages(): UniversalMessage[];
    getConversationSummary(): string;
    clearConversation(): void;
}

// Lightweight implementation focusing on session-specific conversation management
export class ConversationServiceImpl implements ConversationService {
    private conversationHistory: SimpleConversationHistory;

    constructor(maxMessages?: number) {
        this.conversationHistory = new SimpleConversationHistory(maxMessages);
    }

    addMessage(message: UniversalMessage): void {
        this.conversationHistory.addMessage(message);
    }

    getMessages(): UniversalMessage[] {
        return this.conversationHistory.getMessages();
    }

    getConversationSummary(): string {
        const messages = this.conversationHistory.getMessages();
        const messageCount = messages.length;
        const lastMessage = this.conversationHistory.getLastMessage();

        return `Conversation with ${messageCount} messages. Last message: ${lastMessage ? `${lastMessage.role} - ${lastMessage.content?.slice(0, 50) || 'No content'}...` : 'None'
            }`;
    }

    clearConversation(): void {
        this.conversationHistory.clear();
    }
} 