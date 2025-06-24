import Anthropic from '@anthropic-ai/sdk';
import { logger } from '@robota-sdk/agents';
import type { StreamingResponseChunk } from '@robota-sdk/agents';

/**
 * Anthropic streaming response handler
 * 
 * Handles streaming chat completions from Anthropic API.
 * Extracts streaming logic from the main provider for better modularity.
 */
export class AnthropicStreamHandler {
    constructor(
        private readonly client: Anthropic,
        private readonly payloadLogger?: any
    ) { }

    /**
     * Handle streaming response for Anthropic messages
     * 
     * @param requestParams - Anthropic API request parameters
     * @returns AsyncGenerator yielding streaming response chunks
     */
    async *handleStream(requestParams: any): AsyncGenerator<StreamingResponseChunk, void, unknown> {
        try {
            // Log payload for debugging if logger is available
            if (this.payloadLogger?.isEnabled()) {
                await this.payloadLogger.logPayload(requestParams, 'chatStream');
            }

            // Create streaming message
            const stream = await this.client.messages.create({
                ...requestParams,
                stream: true
            });

            // Process each chunk in the stream
            for await (const chunk of stream as any) {
                const parsedChunk = this.parseStreamingChunk(chunk);
                if (parsedChunk) {
                    yield parsedChunk;
                }
            }
        } catch (error) {
            logger.error('Anthropic streaming error:', error as Record<string, any>);
            throw error;
        }
    }

    /**
     * Parse individual streaming chunk from Anthropic
     * 
     * @param chunk - Raw streaming chunk from Anthropic API
     * @returns Parsed streaming response chunk or null if no content
     */
    private parseStreamingChunk(chunk: any): StreamingResponseChunk | null {
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
                    break;

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