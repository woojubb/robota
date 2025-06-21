import type { UniversalMessage } from '@robota-sdk/core';
import { ConversationHistoryInterface } from '../interfaces/conversation-history';

export class SimpleConversationHistory implements ConversationHistoryInterface {
    private messages: UniversalMessage[] = [];
    private maxMessages?: number;

    constructor(maxMessages?: number) {
        this.maxMessages = maxMessages;
    }

    addMessage(message: UniversalMessage): void {
        this.messages.push(message);

        if (this.maxMessages && this.messages.length > this.maxMessages) {
            this.messages = this.messages.slice(-this.maxMessages);
        }
    }

    getMessages(): UniversalMessage[] {
        return [...this.messages];
    }

    getMessageCount(): number {
        return this.messages.length;
    }

    clear(): void {
        this.messages = [];
    }

    getLastMessage(): UniversalMessage | null {
        return this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
    }

    getLastUserMessage(): UniversalMessage | null {
        for (let i = this.messages.length - 1; i >= 0; i--) {
            if (this.messages[i].role === 'user') {
                return this.messages[i];
            }
        }
        return null;
    }

    getLastAssistantMessage(): UniversalMessage | null {
        for (let i = this.messages.length - 1; i >= 0; i--) {
            if (this.messages[i].role === 'assistant') {
                return this.messages[i];
            }
        }
        return null;
    }
} 