import OpenAI from 'openai';
import type { UniversalMessage, UserMessage, AssistantMessage, SystemMessage, ToolMessage } from '@robota-sdk/core';

/**
 * OpenAI ConversationHistory adapter
 * 
 * Converts UniversalMessage to OpenAI Chat Completions API format
 */
export class OpenAIConversationAdapter {
    /**
     * Convert UniversalMessage array to OpenAI message format
     * Filters out tool messages as they are for internal history management only
     */
    static toOpenAIFormat(messages: UniversalMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
        return messages
            .filter(msg => msg.role !== 'tool') // Filter out tool messages - they're for internal history only
            .map(msg => this.convertMessage(msg));
    }

    /**
     * Convert a single UniversalMessage to OpenAI format
     * Note: Tool messages should be filtered out before calling this method
     */
    static convertMessage(msg: UniversalMessage): OpenAI.Chat.ChatCompletionMessageParam {
        const messageRole = msg.role;

        if (messageRole === 'user') {
            const userMsg = msg as UserMessage;
            const result: OpenAI.Chat.ChatCompletionUserMessageParam = {
                role: 'user',
                content: userMsg.content
            };
            if (userMsg.name) {
                result.name = userMsg.name;
            }
            return result;
        }

        if (messageRole === 'assistant') {
            const assistantMsg = msg as AssistantMessage;

            // Handle new tool_calls format
            if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
                const result: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
                    role: 'assistant',
                    content: assistantMsg.content || '',
                    tool_calls: assistantMsg.toolCalls.map(toolCall => ({
                        id: toolCall.id,
                        type: 'function',
                        function: {
                            name: toolCall.function.name,
                            arguments: toolCall.function.arguments
                        }
                    }))
                };
                return result;
            }

            // Handle legacy function_call format
            if (assistantMsg.functionCall) {
                const result: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
                    role: 'assistant',
                    content: assistantMsg.content || '',
                    function_call: {
                        name: assistantMsg.functionCall.name,
                        arguments: typeof assistantMsg.functionCall.arguments === 'string'
                            ? assistantMsg.functionCall.arguments
                            : JSON.stringify(assistantMsg.functionCall.arguments || {})
                    }
                };
                return result;
            }

            // Regular assistant message
            return {
                role: 'assistant',
                content: assistantMsg.content || ''
            };
        }

        if (messageRole === 'system') {
            const systemMsg = msg as SystemMessage;
            return {
                role: 'system',
                content: systemMsg.content
            };
        }

        // Tool messages are filtered out in toOpenAIFormat, so this should never happen
        // But we need to handle it for TypeScript completeness
        if (messageRole === 'tool') {
            throw new Error('Tool messages should be filtered out before calling convertMessage');
        }

        // This should never happen but TypeScript requires exhaustive checking
        const _exhaustiveCheck: never = msg;
        return _exhaustiveCheck;
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