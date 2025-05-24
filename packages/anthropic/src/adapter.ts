import { UniversalMessage } from '@robota-sdk/core';

/**
 * Anthropic ConversationHistory adapter
 * 
 * Converts UniversalMessage to Anthropic prompt format
 */
export class AnthropicConversationAdapter {
    /**
     * Convert UniversalMessage array to Anthropic prompt format
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
            if (message.role === 'system') {
                continue; // System messages are already processed
            }

            if (message.role === 'user') {
                prompt += `\n\nHuman: ${message.content}`;
            } else if (message.role === 'assistant') {
                let content = message.content;

                // Include function call in content if present
                if (message.functionCall) {
                    content += `\n\nFunction Call: ${message.functionCall.name}(${JSON.stringify(message.functionCall.arguments)})`;
                }

                prompt += `\n\nAssistant: ${content}`;
            } else if (message.role === 'tool') {
                // Convert tool results to Human message
                prompt += `\n\nHuman: [Tool Result from ${message.name || 'unknown'}]: ${message.content}`;
            }
        }

        // Add Assistant prompt if last message is from Human
        if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
            prompt += '\n\nAssistant:';
        }

        return prompt;
    }

    /**
     * Extract system messages and combine them as system prompt
     */
    static extractSystemPrompt(messages: UniversalMessage[], fallbackSystemPrompt?: string): string | undefined {
        const systemMessages = messages.filter(msg => msg.role === 'system');

        if (systemMessages.length > 0) {
            return systemMessages.map(msg => msg.content).join('\n\n');
        }

        return fallbackSystemPrompt;
    }

    /**
     * Helper for message conversion testing (converts each message individually)
     */
    static convertMessage(msg: UniversalMessage): { role: string; content: string } {
        switch (msg.role) {
            case 'user':
                return {
                    role: 'human',
                    content: msg.content
                };

            case 'assistant': {
                let content = msg.content;
                if (msg.functionCall) {
                    content += `\n\nFunction Call: ${msg.functionCall.name}(${JSON.stringify(msg.functionCall.arguments)})`;
                }
                return {
                    role: 'assistant',
                    content
                };
            }

            case 'tool':
                return {
                    role: 'human',
                    content: `[Tool Result from ${msg.name || 'unknown'}]: ${msg.content}`
                };

            case 'system':
                return {
                    role: 'system',
                    content: msg.content
                };

            default:
                return {
                    role: 'human',
                    content: msg.content
                };
        }
    }
} 