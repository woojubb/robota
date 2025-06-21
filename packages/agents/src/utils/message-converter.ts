import type { Message } from '../interfaces/agent';

/**
 * Universal message converter utility
 * Handles message format conversion between different providers
 */
export class MessageConverter {
    /**
     * Convert messages to provider-specific format
     */
    static toProviderFormat(messages: Message[], providerName: string): any[] {
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
    private static toOpenAIFormat(messages: Message[]): any[] {
        return messages.map(msg => ({
            role: msg.role,
            content: msg.content,
            ...(msg.role === 'assistant' && 'toolCalls' in msg && msg.toolCalls ? {
                tool_calls: msg.toolCalls.map(tc => ({
                    id: tc.id,
                    type: tc.type,
                    function: tc.function
                }))
            } : {}),
            ...(msg.role === 'tool' && 'toolCallId' in msg ? {
                tool_call_id: msg.toolCallId,
                name: msg.content // Tool name from content for OpenAI
            } : {})
        }));
    }

    /**
     * Convert to Anthropic format
     */
    private static toAnthropicFormat(messages: Message[]): any[] {
        // Anthropic has different message structure
        return messages
            .filter(msg => msg.role !== 'system') // System messages handled separately
            .map(msg => ({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: msg.content
            }));
    }

    /**
     * Convert to Google format
     */
    private static toGoogleFormat(messages: Message[]): any[] {
        return messages.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
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