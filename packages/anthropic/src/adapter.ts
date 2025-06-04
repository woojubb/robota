import type { UniversalMessage, UserMessage, AssistantMessage, SystemMessage, ToolMessage } from '@robota-sdk/core';

/**
 * Anthropic message format for Messages API
 */
interface AnthropicAPIMessage {
    role: 'user' | 'assistant';
    content: string;
}

/**
 * Anthropic message format (legacy)
 */
interface AnthropicMessage {
    role: string;
    content: string;
}

/**
 * Anthropic ConversationHistory adapter
 * 
 * Converts UniversalMessage to Anthropic prompt format and Messages API format
 */
export class AnthropicConversationAdapter {
    /**
     * Convert UniversalMessage array to Anthropic Messages API format
     * 
     * @param messages - Array of universal messages
     * @returns Array of messages in Anthropic Messages API format
     */
    static toAnthropicMessages(messages: UniversalMessage[]): AnthropicAPIMessage[] {
        const anthropicMessages: AnthropicAPIMessage[] = [];

        for (const message of messages) {
            const messageRole = message.role;

            if (messageRole === 'system') {
                continue; // System messages are handled separately in the system parameter
            }

            if (messageRole === 'user') {
                const userMsg = message as UserMessage;
                anthropicMessages.push({
                    role: 'user',
                    content: userMsg.content
                });
            } else if (messageRole === 'assistant') {
                const assistantMsg = message as AssistantMessage;
                let content = assistantMsg.content || '';

                // Include function call in content if present
                if (assistantMsg.functionCall) {
                    content += `\n\nFunction Call: ${assistantMsg.functionCall.name}(${JSON.stringify(assistantMsg.functionCall.arguments)})`;
                }

                anthropicMessages.push({
                    role: 'assistant',
                    content
                });
            } else if (messageRole === 'tool') {
                const toolMsg = message as ToolMessage;
                // Convert tool results to user message
                anthropicMessages.push({
                    role: 'user',
                    content: `[Tool Result from ${toolMsg.name}]: ${toolMsg.content}`
                });
            }
        }

        return anthropicMessages;
    }

    /**
     * Convert UniversalMessage array to Anthropic prompt format (legacy)
     */
    static toAnthropicPrompt(messages: UniversalMessage[], systemPrompt?: string): string {
        let prompt = '';

        // Add system prompt if present
        const finalSystemPrompt = this.extractSystemPrompt(messages, systemPrompt);
        if (finalSystemPrompt) {
            prompt += finalSystemPrompt + '\n\n';
        }

        // Convert messages to Human/Assistant format
        for (const message of messages) {
            const messageRole = message.role;

            if (messageRole === 'system') {
                continue; // System messages are already processed
            }

            if (messageRole === 'user') {
                const userMsg = message as UserMessage;
                prompt += `\n\nHuman: ${userMsg.content}`;
            } else if (messageRole === 'assistant') {
                const assistantMsg = message as AssistantMessage;
                let content = assistantMsg.content || '';

                // Include function call in content if present
                if (assistantMsg.functionCall) {
                    content += `\n\nFunction Call: ${assistantMsg.functionCall.name}(${JSON.stringify(assistantMsg.functionCall.arguments)})`;
                }

                prompt += `\n\nAssistant: ${content}`;
            } else if (messageRole === 'tool') {
                const toolMsg = message as ToolMessage;
                // Convert tool results to Human message
                prompt += `\n\nHuman: [Tool Result from ${toolMsg.name}]: ${toolMsg.content}`;
            }
        }

        // Add Assistant prompt if last message is from Human
        if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            if (lastMessage.role === 'user') {
                prompt += '\n\nAssistant:';
            }
        }

        return prompt;
    }

    /**
     * Extract system messages and combine them as system prompt
     */
    static extractSystemPrompt(messages: UniversalMessage[], fallbackSystemPrompt?: string): string | undefined {
        const systemMessages = messages.filter(msg => msg.role === 'system') as SystemMessage[];

        if (systemMessages.length > 0) {
            return systemMessages.map(msg => msg.content).join('\n\n');
        }

        return fallbackSystemPrompt;
    }

    /**
     * Helper for message conversion testing (converts each message individually)
     */
    static convertMessage(msg: UniversalMessage): AnthropicMessage {
        const messageRole = msg.role;

        if (messageRole === 'user') {
            const userMsg = msg as UserMessage;
            return {
                role: 'human',
                content: userMsg.content
            };
        }

        if (messageRole === 'assistant') {
            const assistantMsg = msg as AssistantMessage;
            let content = assistantMsg.content || '';
            if (assistantMsg.functionCall) {
                content += `\n\nFunction Call: ${assistantMsg.functionCall.name}(${JSON.stringify(assistantMsg.functionCall.arguments)})`;
            }
            return {
                role: 'assistant',
                content
            };
        }

        if (messageRole === 'tool') {
            const toolMsg = msg as ToolMessage;
            return {
                role: 'human',
                content: `[Tool Result from ${toolMsg.name}]: ${toolMsg.content}`
            };
        }

        if (messageRole === 'system') {
            const systemMsg = msg as SystemMessage;
            return {
                role: 'system',
                content: systemMsg.content
            };
        }

        // This should never happen but TypeScript requires exhaustive checking
        const _exhaustiveCheck: never = msg;
        return _exhaustiveCheck;
    }
} 