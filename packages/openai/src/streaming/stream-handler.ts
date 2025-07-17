import OpenAI from 'openai';
import type { UniversalMessage } from '@robota-sdk/agents';
import type { PayloadLogger } from '../payload-logger';
import type {
    OpenAIChatRequestParams,
    OpenAIStreamRequestParams
} from '../types/api-types';

// Simple logger implementation (browser compatible - no environment checks)
const logger = {
    debug: (message: string, data?: LogData) => {
        // Always available in both Node.js and browser
        // eslint-disable-next-line no-console
        console.debug(`[OpenAI Stream] ${message}`, data || '');
    },
    error: (message: string, data?: LogData) => {
        // eslint-disable-next-line no-console
        console.error(`[OpenAI Stream] ${message}`, data || '');
    }
};

/**
 * Log data interface
 */
interface LogData {
    [key: string]: string | number | boolean | object | undefined;
}

/**
 * OpenAI streaming response handler
 * 
 * Handles streaming chat completions from OpenAI API.
 * Extracts streaming logic from the main provider for better modularity.
 */
export class OpenAIStreamHandler {
    constructor(
        private readonly client: OpenAI,
        private readonly payloadLogger?: PayloadLogger
    ) { }

    /**
     * Handle streaming response for OpenAI chat completions
     * 
     * @param requestParams - OpenAI API request parameters
     * @returns AsyncGenerator yielding universal messages
     */
    async *handleStream(requestParams: OpenAIStreamRequestParams): AsyncGenerator<UniversalMessage, void, never> {
        try {
            // Log payload for debugging if logger is available
            if (this.payloadLogger?.isEnabled()) {
                const logData = {
                    model: requestParams.model,
                    messagesCount: requestParams.messages.length,
                    hasTools: !!requestParams.tools,
                    temperature: requestParams.temperature,
                    maxTokens: requestParams.max_tokens,
                    timestamp: new Date().toISOString()
                };
                await this.payloadLogger.logPayload(logData, 'stream');
            }

            // Create streaming chat completion with proper type-safe parameters
            const streamParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
                model: requestParams.model,
                messages: requestParams.messages,
                stream: true,
                ...(requestParams.temperature !== undefined && { temperature: requestParams.temperature }),
                ...(requestParams.max_tokens !== undefined && { max_tokens: requestParams.max_tokens }),
                ...(requestParams.tools && {
                    tools: requestParams.tools,
                    tool_choice: requestParams.tool_choice || 'auto'
                })
            };
            const response = await this.client.chat.completions.create(streamParams);

            // Process each chunk in the stream
            for await (const chunk of response) {
                const parsed = this.parseStreamingChunk(chunk);
                if (parsed) {
                    yield parsed;
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'OpenAI streaming request failed';
            logger.error('Stream creation failed', { error: errorMessage });
            throw new Error(`OpenAI streaming failed: ${errorMessage}`);
        }
    }

    /**
     * Generate streaming response using raw request payload (for agents package compatibility)
     * 
     * @param request - Raw request payload from ConversationService
     * @returns AsyncGenerator yielding universal messages
     */
    async *generateStreamingResponse(request: OpenAIChatRequestParams): AsyncGenerator<UniversalMessage, void, never> {
        try {
            // Extract parameters from request payload
            const model = request.model;
            const messages = request.messages || [];
            const temperature = request.temperature;
            const maxTokens = request.max_tokens;
            const tools = request.tools;

            // Build OpenAI request parameters
            const requestParams: OpenAIStreamRequestParams = {
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
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error('OpenAI generateStreamingResponse error:', { message: errorMessage });
            throw error;
        }
    }

    /**
     * Parse individual streaming chunk from OpenAI
     * 
     * @param chunk - Raw streaming chunk from OpenAI API
     * @returns Parsed universal message or null if no content
     */
    private parseStreamingChunk(chunk: OpenAI.Chat.ChatCompletionChunk): UniversalMessage | null {
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
                        role: 'assistant',
                        content: '',
                        timestamp: new Date(),
                        toolCalls: [{
                            id: toolCall.id || '',
                            type: 'function' as const,
                            function: {
                                name: toolCall.function?.name || '',
                                arguments: toolCall.function?.arguments || ''
                            }
                        }],
                        metadata: {
                            isStreamChunk: true,
                            isComplete: finishReason === 'stop' || finishReason === 'tool_calls'
                        }
                    };
                }
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
            const errorMessage = error instanceof Error ? error.message : 'OpenAI chunk parsing failed';
            logger.error('Chunk parsing failed', { error: errorMessage });
            throw new Error(`OpenAI chunk parsing failed: ${errorMessage}`);
        }
    }
} 