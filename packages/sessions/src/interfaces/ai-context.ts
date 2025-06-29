import type { ConversationContext, Message } from '@robota-sdk/agents';

export interface ContextManager {
    getContext(): ConversationContext;
    updateContext(context: Partial<ConversationContext>): void;
    clearContext(): void;
    addSystemMessage(content: string): void;
    getSystemMessages(): Message[];
}

export type { ConversationContext }; 