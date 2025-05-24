import OpenAI from 'openai';
import { UniversalMessage } from '@robota-sdk/core';

/**
 * OpenAI ConversationHistory adapter
 * 
 * Converts UniversalMessage to OpenAI Chat Completions API format
 */
export class OpenAIConversationAdapter {
    /**
     * Convert UniversalMessage array to OpenAI message format
     */
    static toOpenAIFormat(messages: UniversalMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
        return messages.map(msg => this.convertMessage(msg));
    }

    /**
     * Convert a single UniversalMessage to OpenAI format
     */
    static convertMessage(msg: UniversalMessage): OpenAI.Chat.ChatCompletionMessageParam {
        switch (msg.role) {
            case 'user':
                return {
                    role: 'user',
                    content: msg.content,
                    name: msg.name
                };

            case 'assistant':
                if (msg.functionCall) {
                    return {
                        role: 'assistant',
                        content: msg.content || null,
                        function_call: {
                            name: msg.functionCall.name,
                            arguments: typeof msg.functionCall.arguments === 'string'
                                ? msg.functionCall.arguments
                                : JSON.stringify(msg.functionCall.arguments || {})
                        }
                    };
                }
                return {
                    role: 'assistant',
                    content: msg.content
                };

            case 'system':
                return {
                    role: 'system',
                    content: msg.content
                };

            case 'tool':
                // OpenAI converts tool role to function
                return {
                    role: 'function',
                    name: msg.name || msg.toolResult?.name || 'unknown_tool',
                    content: msg.content
                };

            default:
                // Unknown roles are handled as user
                return {
                    role: 'user',
                    content: msg.content
                };
        }
    }

    /**
     * Add system prompt to message array if needed
     */
    static addSystemPromptIfNeeded(
        messages: OpenAI.Chat.ChatCompletionMessageParam[],
        systemPrompt?: string
    ): OpenAI.Chat.ChatCompletionMessageParam[] {
        if (!systemPrompt) {
            return messages;
        }

        // Check if system message already exists
        const hasSystemMessage = messages.some(msg => msg.role === 'system');

        if (hasSystemMessage) {
            return messages;
        }

        // Add system prompt at the beginning
        return [
            { role: 'system', content: systemPrompt },
            ...messages
        ];
    }
} 