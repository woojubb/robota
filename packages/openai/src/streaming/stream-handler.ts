import OpenAI from 'openai';
import type { TUniversalMessage } from '@robota-sdk/agents';
import type { IPayloadLogger } from '../interfaces/payload-logger';
import type {
    IOpenAIChatRequestParams,
    IOpenAIStreamRequestParams
} from '../types/api-types';
import { SilentLogger, type ILogger } from '@robota-sdk/agents';
import { OpenAIResponseParser } from '../parsers/response-parser';



/**
 * OpenAI streaming response handler
 * 
 * Handles streaming chat completions from OpenAI API.
 * Extracts streaming logic from the main provider for better modularity.
 */
export class OpenAIStreamHandler {
    private readonly logger: ILogger;
    private readonly parser: OpenAIResponseParser;

    constructor(
        private readonly client: OpenAI,
        private readonly payloadLogger?: IPayloadLogger,
        logger?: ILogger
    ) {
        this.logger = logger || SilentLogger;
        this.parser = new OpenAIResponseParser(logger);
    }

    /**
     * Handle streaming response for OpenAI chat completions
     * 
     * @param requestParams - OpenAI API request parameters
     * @returns AsyncGenerator yielding universal messages
     */
    async *handleStream(requestParams: IOpenAIStreamRequestParams): AsyncGenerator<TUniversalMessage, void, undefined> {
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
                const parsed = this.parser.parseStreamingChunk(chunk);
                if (parsed) {
                    yield parsed;
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'OpenAI streaming request failed';
            this.logger.error('Stream creation failed', { error: errorMessage });
            throw new Error(`OpenAI streaming failed: ${errorMessage}`);
        }
    }

    /**
     * Generate streaming response using raw request payload (for agents package compatibility)
     * 
     * @param request - Raw request payload from ConversationService
     * @returns AsyncGenerator yielding universal messages
     */
    async *generateStreamingResponse(request: IOpenAIChatRequestParams): AsyncGenerator<TUniversalMessage, void, undefined> {
        try {
            // Extract parameters from request payload
            const model = request.model;
            const messages = request.messages || [];
            const temperature = request.temperature;
            const maxTokens = request.max_tokens;
            const tools = request.tools;

            // Build OpenAI request parameters
            const requestParams: IOpenAIStreamRequestParams = {
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
            this.logger.error('OpenAI generateStreamingResponse error:', { message: errorMessage });
            throw error;
        }
    }


} 