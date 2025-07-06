// Facade for conversation service - uses agents unified implementation
import { ConversationSession } from '@robota-sdk/agents';

// Import the UniversalMessage type from agents managers
type UniversalMessage = Parameters<ConversationSession['addMessage']>[0];
type Message = UniversalMessage;

export interface ConversationService {
    addMessage(message: Message): void;
    getMessages(): Message[];
    getConversationSummary(): string;
    clearConversation(): void;
}

// Lightweight implementation focusing on session-specific conversation management
export class ConversationServiceImpl implements ConversationService {
    private conversationSession: ConversationSession;

    constructor(maxMessages?: number) {
        this.conversationSession = new ConversationSession(maxMessages);
    }

    addMessage(message: Message): void {
        this.conversationSession.addMessage(message);
    }

    getMessages(): Message[] {
        return this.conversationSession.getMessages();
    }

    getConversationSummary(): string {
        const messages = this.conversationSession.getMessages();
        const messageCount = messages.length;
        const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

        return `Conversation with ${messageCount} messages. Last message: ${lastMessage ? `${lastMessage.role} - ${lastMessage.content?.slice(0, 50) || 'No content'}...` : 'None'
            }`;
    }

    clearConversation(): void {
        this.conversationSession.clear();
    }
} 