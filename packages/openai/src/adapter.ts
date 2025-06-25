import OpenAI from 'openai';
import type { UniversalMessage } from '@robota-sdk/agents/src/managers/conversation-history-manager';
import type { UserMessage, AssistantMessage, SystemMessage, ToolMessage } from '@robota-sdk/agents/src/interfaces/agent';

/**
 * OpenAI ConversationHistory adapter
 * 
 * Converts UniversalMessage to OpenAI Chat Completions API format
 */
export class OpenAIConversationAdapter {
    /**
     * Filter messages for OpenAI compatibility
     * 
     * OpenAI has specific requirements:
     * - Tool messages must have valid toolCallId
     * - Messages must be in proper sequence
     * - Tool messages without toolCallId should be excluded
     */
    static filterMessagesForOpenAI(messages: UniversalMessage[]): UniversalMessage[] {
        return messages.filter(msg => {
            // Always include user, assistant, and system messages
            if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system') {
                return true;
            }

            // For tool messages, only include if they have a valid toolCallId
            if (msg.role === 'tool') {
                const toolMsg = msg as ToolMessage;
                // Must have toolCallId and it must not be empty or 'unknown'
                return !!(toolMsg.toolCallId &&
                    toolMsg.toolCallId.trim() !== '' &&
                    toolMsg.toolCallId !== 'unknown');
            }

            return false;
        });
    }

    /**
     * Convert UniversalMessage array to OpenAI message format
     * Now properly handles tool messages for OpenAI's tool calling feature
     */
    static toOpenAIFormat(messages: UniversalMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
        // First filter messages for OpenAI compatibility
        const filteredMessages = this.filterMessagesForOpenAI(messages);
        return filteredMessages.map(msg => this.convertMessage(msg));
    }

    /**
     * Convert a single UniversalMessage to OpenAI format
     * Handles all message types including tool messages
     */
    static convertMessage(msg: UniversalMessage): OpenAI.Chat.ChatCompletionMessageParam {
        const messageRole = msg.role;

        if (messageRole === 'user') {
            const userMsg = msg as UserMessage;
            return {
                role: 'user',
                content: userMsg.content
            };
        }

        if (messageRole === 'assistant') {
            const assistantMsg = msg as AssistantMessage;

            // Handle tool_calls format
            if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
                const result: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
                    role: 'assistant',
                    content: assistantMsg.content || null,
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

            // Regular assistant message (without tool calls)
            return {
                role: 'assistant',
                content: assistantMsg.content || ''  // OpenAI requires string for non-tool messages
            };
        }

        if (messageRole === 'system') {
            const systemMsg = msg as SystemMessage;
            return {
                role: 'system',
                content: systemMsg.content
            };
        }

        // Handle tool messages for OpenAI tool calling
        if (messageRole === 'tool') {
            const toolMsg = msg as ToolMessage;

            if (!toolMsg.toolCallId || toolMsg.toolCallId.trim() === '') {
                throw new Error(`Tool message missing toolCallId: ${JSON.stringify(toolMsg)}`);
            }

            const result: OpenAI.Chat.ChatCompletionToolMessageParam = {
                role: 'tool',
                content: toolMsg.content,
                tool_call_id: toolMsg.toolCallId
            };
            return result;
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