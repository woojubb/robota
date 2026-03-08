import type { TUniversalMessage } from '../interfaces/messages';

// Internal conversion types for provider message format mapping.
// These are NOT the canonical provider types — they represent the subset
// of fields needed for universal message conversion.

interface IOpenAIMessage {
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

interface IAnthropicProviderMessage {
    role: 'user' | 'assistant';
    content: string;
}

interface IGoogleProviderMessage {
    role: 'user' | 'model';
    parts: {
        text: string;
    }[];
}

/**
 * Provider message format union type
 */
type TProviderMessage = IOpenAIMessage | IAnthropicProviderMessage | IGoogleProviderMessage | TUniversalMessage;

/**
 * Universal message converter utility
 * Handles message format conversion between different providers
 */
export class MessageConverter {
    /**
     * Convert messages to provider-specific format
     */
    static toProviderFormat(messages: TUniversalMessage[], providerName: string): TProviderMessage[] {
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
    private static toOpenAIFormat(messages: TUniversalMessage[]): IOpenAIMessage[] {
        return messages.map(msg => {
            const baseMessage: IOpenAIMessage = {
                role: msg.role as IOpenAIMessage['role'],
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
                // IToolMessage.name holds the tool name; use it for the OpenAI name field
                baseMessage.name = msg.name;
            }

            return baseMessage;
        });
    }

    /**
     * Convert to Anthropic format
     */
    private static toAnthropicFormat(messages: TUniversalMessage[]): IAnthropicProviderMessage[] {
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
    private static toGoogleFormat(messages: TUniversalMessage[]): IGoogleProviderMessage[] {
        return messages.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content || '' }]
        }));
    }

    /**
     * Convert to universal format (no conversion)
     */
    private static toUniversalFormat(messages: TUniversalMessage[]): TUniversalMessage[] {
        return messages;
    }

    /**
     * Extract system message from messages
     */
    static extractSystemMessage(messages: TUniversalMessage[]): string | undefined {
        const systemMsg = messages.find(msg => msg.role === 'system');
        return systemMsg?.content;
    }

    /**
     * Filter non-system messages
     */
    static filterNonSystemMessages(messages: TUniversalMessage[]): TUniversalMessage[] {
        return messages.filter(msg => msg.role !== 'system');
    }
} 