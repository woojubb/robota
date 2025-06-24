import OpenAI from 'openai';
import { ModelResponse, StreamingResponseChunk, logger } from '@robota-sdk/agents';

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
     * @returns Standardized model response
     */
    static parseResponse(response: OpenAI.Chat.ChatCompletion): ModelResponse {
        try {
            const choice = response.choices?.[0];
            if (!choice) {
                throw new Error('No choices found in OpenAI response');
            }

            const message = choice.message;
            const content = message.content || '';

            // Parse tool calls if present
            const toolCalls = message.tool_calls?.map((toolCall: any) => ({
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

            const result: ModelResponse = {
                content,
                toolCalls,
                metadata: {
                    finishReason: choice.finish_reason || undefined
                }
            };

            if (usage) {
                result.usage = usage;
            }

            return result;
        } catch (error) {
            logger.error('Error parsing OpenAI response:', error as Record<string, any>);
            throw error;
        }
    }

    /**
     * Parse OpenAI streaming chunk
     * 
     * @param chunk - Raw streaming chunk from OpenAI API
     * @returns Parsed streaming response chunk or null if no content
     */
    static parseStreamingChunk(chunk: OpenAI.Chat.ChatCompletionChunk): StreamingResponseChunk | null {
        try {
            const choice = chunk.choices?.[0];
            if (!choice) {
                return null;
            }

            const delta = choice.delta;
            const finishReason = choice.finish_reason;

            // Handle tool calls in streaming
            if (delta.tool_calls) {
                const toolCalls = delta.tool_calls.map((toolCall: any) => ({
                    id: toolCall.id || '',
                    type: 'function',
                    function: {
                        name: toolCall.function?.name || '',
                        arguments: toolCall.function?.arguments || ''
                    }
                }));

                // Return first tool call for streaming (single tool call per chunk)
                const firstToolCall = toolCalls[0];
                const result: StreamingResponseChunk = {
                    content: '',
                    isComplete: finishReason === 'stop' || finishReason === 'tool_calls'
                };

                if (firstToolCall) {
                    result.toolCall = {
                        id: firstToolCall.id,
                        type: 'function' as const,
                        function: firstToolCall.function
                    };
                }

                return result;
            }

            // Handle regular content
            const content = delta.content || '';

            return {
                content,
                isComplete: finishReason === 'stop' || finishReason === 'tool_calls'
            };
        } catch (error) {
            logger.error('Error parsing OpenAI streaming chunk:', error as Record<string, any>);
            return null;
        }
    }
} 