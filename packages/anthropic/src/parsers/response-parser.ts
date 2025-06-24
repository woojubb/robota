import { ModelResponse, StreamingResponseChunk, logger } from '@robota-sdk/agents';

/**
 * Anthropic response parser utility
 * 
 * Handles parsing of responses from Anthropic API into standardized formats.
 * Extracts parsing logic from the main provider for better modularity.
 */
export class AnthropicResponseParser {

    /**
     * Parse complete Anthropic message response
     * 
     * @param response - Raw Anthropic API response
     * @returns Standardized model response
     */
    static parseResponse(response: any): ModelResponse {
        try {
            const content = response.content?.[0]?.text || '';

            // Parse tool calls if present
            const toolCalls = response.content
                ?.filter((block: any) => block.type === 'tool_use')
                ?.map((toolBlock: any) => ({
                    id: toolBlock.id,
                    type: 'function' as const,
                    function: {
                        name: toolBlock.name,
                        arguments: JSON.stringify(toolBlock.input)
                    }
                })) || [];

            // Calculate token usage
            const usage = response.usage ? {
                promptTokens: response.usage.input_tokens,
                completionTokens: response.usage.output_tokens,
                totalTokens: response.usage.input_tokens + response.usage.output_tokens
            } : undefined;

            const result: ModelResponse = {
                content,
                toolCalls,
                metadata: {
                    model: response.model,
                    finishReason: response.stop_reason
                }
            };

            if (usage) {
                result.usage = usage;
            }

            return result;
        } catch (error) {
            logger.error('Error parsing Anthropic response:', error as Record<string, any>);
            throw error;
        }
    }

    /**
     * Parse Anthropic streaming chunk
     * 
     * @param chunk - Raw streaming chunk from Anthropic API
     * @returns Parsed streaming response chunk or null if no content
     */
    static parseStreamingChunk(chunk: any): StreamingResponseChunk | null {
        try {
            // Handle different chunk types
            switch (chunk.type) {
                case 'content_block_start':
                    if (chunk.content_block?.type === 'text') {
                        return {
                            content: '',
                            isComplete: false
                        };
                    }
                    if (chunk.content_block?.type === 'tool_use') {
                        return {
                            content: '',
                            toolCall: {
                                id: chunk.content_block.id,
                                type: 'function' as const,
                                function: {
                                    name: chunk.content_block.name || '',
                                    arguments: JSON.stringify(chunk.content_block.input || {})
                                }
                            },
                            isComplete: false
                        };
                    }
                    break;

                case 'content_block_delta':
                    if (chunk.delta?.type === 'text_delta') {
                        return {
                            content: chunk.delta.text || '',
                            isComplete: false
                        };
                    }
                    if (chunk.delta?.type === 'input_json_delta') {
                        // Handle tool call argument streaming
                        return {
                            content: '',
                            isComplete: false
                        };
                    }
                    break;

                case 'content_block_stop':
                    return {
                        content: '',
                        isComplete: false
                    };

                case 'message_stop':
                    return {
                        content: '',
                        isComplete: true
                    };

                default:
                    // Unknown chunk type, skip
                    break;
            }

            return null;
        } catch (error) {
            logger.error('Error parsing Anthropic streaming chunk:', error as Record<string, any>);
            return null;
        }
    }
} 