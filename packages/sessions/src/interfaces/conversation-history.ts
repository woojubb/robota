import type { Message } from '@robota-sdk/agents';

export interface ConversationHistoryInterface {
    addMessage(message: Message): void;
    getMessages(): Message[];
    getMessageCount(): number;
    clear(): void;
    getLastMessage(): Message | null;
    getLastUserMessage(): Message | null;
    getLastAssistantMessage(): Message | null;
}

export interface ConversationHistoryOptions {
    maxMessages?: number;
    enableMetadata?: boolean;
    enableTimestamps?: boolean;
} 