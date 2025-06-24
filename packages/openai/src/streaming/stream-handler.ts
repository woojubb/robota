import OpenAI from 'openai';
import { StreamingResponseChunk, logger } from '@robota-sdk/agents';

/**
 * OpenAI streaming response handler
 * 
 * Handles streaming chat completions from OpenAI API.
 * Extracts streaming logic from the main provider for better modularity.
 */
export class OpenAIStreamHandler {
    constructor(
        private readonly client: OpenAI,
        private readonly payloadLogger?: any
    ) { }

    /**
     * Handle streaming response for OpenAI chat completions
     * 
     * @param requestParams - OpenAI API request parameters
     * @returns AsyncGenerator yielding streaming response chunks
     */
    async *handleStream(requestParams: any): AsyncGenerator<StreamingResponseChunk, void, unknown> {
        try {
            // Log payload for debugging if logger is available
            if (this.payloadLogger?.isEnabled()) {
                await this.payloadLogger.logPayload(requestParams, 'chatStream');
            }

            // Create streaming chat completion
            const streamParams = { ...requestParams, stream: true };
            const response = await this.client.chat.completions.create(streamParams as any);

            // Process each chunk in the stream
            for await (const chunk of response as any) {
                const parsed = this.parseStreamingChunk(chunk);
                if (parsed) {
                    yield parsed;
                }
            }
        } catch (error) {
            logger.error('OpenAI streaming error:', error as Record<string, any>);
            throw error;
        }
    }

    /**
     * Generate streaming response using raw request payload (for agents package compatibility)
     * 
     * @param request - Raw request payload from ConversationService
     * @returns AsyncGenerator yielding streaming response chunks
     */
    async *generateStreamingResponse(request: any): AsyncGenerator<any, void, unknown> {
        try {
            // Extract parameters from request payload
            const model = request.model;
            const messages = request.messages || [];
            const temperature = request.temperature;
            const maxTokens = request.max_tokens;
            const tools = request.tools;

            // Build OpenAI request parameters
            const requestParams: any = {
                model: model || 'gpt-4o-mini',
                messages,
                temperature,
                max_tokens: maxTokens,
                stream: true
            };

            // Add tools if provided
            if (tools && Array.isArray(tools) && tools.length > 0) {
                requestParams.tools = tools;
                requestParams.tool_choice = 'auto';
            }

            // Use existing stream handler
            yield* this.handleStream(requestParams);
        } catch (error) {
            logger.error('OpenAI generateStreamingResponse error:', error as Record<string, any>);
            throw error;
        }
    }

    /**
     * Parse individual streaming chunk from OpenAI
     * 
     * @param chunk - Raw streaming chunk from OpenAI API
     * @returns Parsed streaming response chunk or null if no content
     */
    private parseStreamingChunk(chunk: OpenAI.Chat.ChatCompletionChunk): StreamingResponseChunk | null {
        try {
            const choice = chunk.choices?.[0];
            if (!choice) {
                return null;
            }

            const delta = choice.delta;
            const finishReason = choice.finish_reason;

            // Handle tool calls in streaming
            if (delta.tool_calls && delta.tool_calls.length > 0) {
                const toolCall = delta.tool_calls[0];
                if (toolCall && toolCall.function) {
                    return {
                        content: '',
                        toolCall: {
                            id: toolCall.id || '',
                            type: 'function' as const,
                            function: {
                                name: toolCall.function?.name || '',
                                arguments: toolCall.function?.arguments || ''
                            }
                        },
                        isComplete: finishReason === 'stop' || finishReason === 'tool_calls'
                    };
                }
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