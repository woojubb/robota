import type { UniversalMessage } from '@robota-sdk/core';

export interface ConversationHistoryInterface {
    addMessage(message: UniversalMessage): void;
    getMessages(): UniversalMessage[];
    getMessageCount(): number;
    clear(): void;
    getLastMessage(): UniversalMessage | null;
    getLastUserMessage(): UniversalMessage | null;
    getLastAssistantMessage(): UniversalMessage | null;
}

export interface ConversationHistoryOptions {
    maxMessages?: number;
    enableMetadata?: boolean;
    enableTimestamps?: boolean;
} 