import OpenAI from 'openai';
import { UniversalMessage, logger } from '@robota-sdk/agents';

/**
 * OpenAI response parser utility
 * 
 * Handles parsing of responses from OpenAI API into standardized formats.
 * Extracts parsing logic from the main provider for better modularity.
 */
export class OpenAIResponseParser {

    /**
     * Parse complete OpenAI chat completion response
     * 
     * @param response - Raw OpenAI API response
     * @returns Standardized universal message
     */
    static parseResponse(response: OpenAI.Chat.ChatCompletion): UniversalMessage {
        try {
            const choice = response.choices?.[0];
            if (!choice) {
                throw new Error('No choices found in OpenAI response');
            }

            const message = choice.message;
            const content = message.content || '';

            // Parse tool calls if present
            const toolCalls = message.tool_calls?.map((toolCall) => ({
                id: toolCall.id,
                type: 'function' as const,
                function: {
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments
                }
            })) || [];

            // Calculate token usage
            const usage = response.usage ? {
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
                totalTokens: response.usage.total_tokens
            } : undefined;

            const result: UniversalMessage = {
                role: 'assistant',
                content,
                timestamp: new Date(),
                ...(toolCalls.length > 0 && { toolCalls }),
                ...(usage && { usage }),
                metadata: {
                    finishReason: choice.finish_reason || undefined
                }
            };

            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown parsing error';
            logger.error('Error parsing OpenAI response:', { message: errorMessage });
            throw error;
        }
    }

    /**
     * Parse OpenAI streaming chunk
     * 
     * @param chunk - Raw streaming chunk from OpenAI API
     * @returns Parsed universal message or null if no content
     */
    static parseStreamingChunk(chunk: OpenAI.Chat.ChatCompletionChunk): UniversalMessage | null {
        try {
            const choice = chunk.choices?.[0];
            if (!choice) {
                return null;
            }

            const delta = choice.delta;
            const finishReason = choice.finish_reason;

            // Handle tool calls in streaming
            if (delta.tool_calls) {
                const toolCalls = delta.tool_calls.map((toolCall) => ({
                    id: toolCall.id || '',
                    type: 'function' as const,
                    function: {
                        name: toolCall.function?.name || '',
                        arguments: toolCall.function?.arguments || ''
                    }
                }));

                // Return assistant message with tool calls
                return {
                    role: 'assistant',
                    content: '',
                    timestamp: new Date(),
                    toolCalls,
                    metadata: {
                        isStreamChunk: true,
                        isComplete: finishReason === 'stop' || finishReason === 'tool_calls'
                    }
                };
            }

            // Handle regular content
            const content = delta.content || '';

            return {
                role: 'assistant',
                content,
                timestamp: new Date(),
                metadata: {
                    isStreamChunk: true,
                    isComplete: finishReason === 'stop' || finishReason === 'tool_calls'
                }
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown parsing error';
            logger.error('Error parsing OpenAI streaming chunk:', { message: errorMessage });
            return null;
        }
    }
} 