import { UniversalMessage, logger } from '@robota-sdk/agents';
import type Anthropic from '@anthropic-ai/sdk';
import type { AnthropicMessage } from '../types/api-types';

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
     * @returns Standardized universal message
     */
    static parseResponse(response: AnthropicMessage): UniversalMessage {
        try {
            const content = response.content?.[0]?.text || '';

            // Parse tool calls if present
            const toolUseBlocks = response.content?.filter(block => block.type === 'tool_use') || [];
            const toolCalls = toolUseBlocks
                .filter(toolBlock => toolBlock.id && toolBlock.name)
                .map(toolBlock => ({
                    id: toolBlock.id!,
                    type: 'function' as const,
                    function: {
                        name: toolBlock.name!,
                        arguments: JSON.stringify(toolBlock.input || {})
                    }
                }));

            // Calculate token usage
            const usage = response.usage ? {
                promptTokens: response.usage.input_tokens,
                completionTokens: response.usage.output_tokens,
                totalTokens: response.usage.input_tokens + response.usage.output_tokens
            } : undefined;

            const result: UniversalMessage = {
                role: 'assistant',
                content,
                timestamp: new Date(),
                ...(toolCalls.length > 0 && { toolCalls }),
                ...(usage && { usage }),
                metadata: {
                    model: response.model,
                    finishReason: response.stop_reason || 'unknown'
                }
            };

            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown parsing error';
            logger.error('Error parsing Anthropic response:', { message: errorMessage });
            throw error;
        }
    }

    /**
     * Parse Anthropic streaming chunk
     * 
     * @param chunk - Raw streaming chunk from Anthropic API
     * @returns Parsed universal message or null if no content
     */
    static parseStreamingChunk(chunk: Anthropic.MessageStreamEvent): UniversalMessage | null {
        try {
            // Handle different chunk types
            switch (chunk.type) {
                case 'content_block_start':
                    if (chunk.content_block?.type === 'text') {
                        return {
                            role: 'assistant',
                            content: '',
                            timestamp: new Date(),
                            metadata: {
                                isStreamChunk: true,
                                isComplete: false
                            }
                        };
                    }
                    if (chunk.content_block?.type === 'tool_use') {
                        return {
                            role: 'assistant',
                            content: '',
                            timestamp: new Date(),
                            toolCalls: [{
                                id: chunk.content_block.id,
                                type: 'function' as const,
                                function: {
                                    name: chunk.content_block.name || '',
                                    arguments: JSON.stringify(chunk.content_block.input || {})
                                }
                            }],
                            metadata: {
                                isStreamChunk: true,
                                isComplete: false
                            }
                        };
                    }
                    break;

                case 'content_block_delta':
                    if (chunk.delta?.type === 'text_delta') {
                        return {
                            role: 'assistant',
                            content: chunk.delta.text || '',
                            timestamp: new Date(),
                            metadata: {
                                isStreamChunk: true,
                                isComplete: false
                            }
                        };
                    }
                    if (chunk.delta?.type === 'input_json_delta') {
                        // Handle tool call argument streaming
                        return {
                            role: 'assistant',
                            content: '',
                            timestamp: new Date(),
                            metadata: {
                                isStreamChunk: true,
                                isComplete: false
                            }
                        };
                    }
                    break;

                case 'content_block_stop':
                    return {
                        role: 'assistant',
                        content: '',
                        timestamp: new Date(),
                        metadata: {
                            isStreamChunk: true,
                            isComplete: false
                        }
                    };

                case 'message_stop':
                    return {
                        role: 'assistant',
                        content: '',
                        timestamp: new Date(),
                        metadata: {
                            isStreamChunk: true,
                            isComplete: true
                        }
                    };

                default:
                    // Unknown chunk type, skip
                    break;
            }

            return null;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown parsing error';
            logger.error('Error parsing Anthropic streaming chunk:', { message: errorMessage });
            return null;
        }
    }
} 