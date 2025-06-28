import type { Message } from '../interfaces/agent';

/**
 * Provider-specific message format types
 */
interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: {
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }[];
    tool_call_id?: string;
    name?: string;
}

interface AnthropicMessage {
    role: 'user' | 'assistant';
    content: string;
}

interface GoogleMessage {
    role: 'user' | 'model';
    parts: {
        text: string;
    }[];
}

/**
 * Provider message format union type
 */
type ProviderMessage = OpenAIMessage | AnthropicMessage | GoogleMessage | Message;

/**
 * Universal message converter utility
 * Handles message format conversion between different providers
 */
export class MessageConverter {
    /**
     * Convert messages to provider-specific format
     */
    static toProviderFormat(messages: Message[], providerName: string): ProviderMessage[] {
        switch (providerName.toLowerCase()) {
            case 'openai':
                return this.toOpenAIFormat(messages);
            case 'anthropic':
                return this.toAnthropicFormat(messages);
            case 'google':
                return this.toGoogleFormat(messages);
            default:
                return this.toUniversalFormat(messages);
        }
    }

    /**
     * Convert to OpenAI format
     */
    private static toOpenAIFormat(messages: Message[]): OpenAIMessage[] {
        return messages.map(msg => {
            const baseMessage: OpenAIMessage = {
                role: msg.role as OpenAIMessage['role'],
                content: msg.content
            };

            // Add tool calls for assistant messages
            if (msg.role === 'assistant' && 'toolCalls' in msg && msg.toolCalls) {
                baseMessage.tool_calls = msg.toolCalls.map(tc => ({
                    id: tc.id,
                    type: tc.type as 'function',
                    function: tc.function
                }));
            }

            // Add tool call ID and name for tool messages
            if (msg.role === 'tool' && 'toolCallId' in msg) {
                baseMessage.tool_call_id = msg.toolCallId;
                baseMessage.name = msg.content; // Tool name from content for OpenAI
            }

            return baseMessage;
        });
    }

    /**
     * Convert to Anthropic format
     */
    private static toAnthropicFormat(messages: Message[]): AnthropicMessage[] {
        // Anthropic has different message structure
        return messages
            .filter(msg => msg.role !== 'system') // System messages handled separately
            .map(msg => ({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: msg.content || ''
            }));
    }

    /**
     * Convert to Google format
     */
    private static toGoogleFormat(messages: Message[]): GoogleMessage[] {
        return messages.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content || '' }]
        }));
    }

    /**
     * Convert to universal format (no conversion)
     */
    private static toUniversalFormat(messages: Message[]): Message[] {
        return messages;
    }

    /**
     * Extract system message from messages
     */
    static extractSystemMessage(messages: Message[]): string | undefined {
        const systemMsg = messages.find(msg => msg.role === 'system');
        return systemMsg?.content;
    }

    /**
     * Filter non-system messages
     */
    static filterNonSystemMessages(messages: Message[]): Message[] {
        return messages.filter(msg => msg.role !== 'system');
    }
} 