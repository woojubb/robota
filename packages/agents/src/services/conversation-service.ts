import { Message, UserMessage, AssistantMessage, SystemMessage, ToolMessage } from '../interfaces/agent';
import { UniversalMessage } from '../managers/conversation-history-manager';
import { AIProvider } from '../interfaces/provider';
import {
    ConversationContext,
    ConversationResponse,
    StreamingChunk,
    ConversationServiceOptions,
    ContextOptions,
    ConversationServiceInterface
} from '../interfaces/service';
import { Logger, createLogger } from '../utils/logger';
import { NetworkError, ProviderError } from '../utils/errors';

/**
 * Default conversation service options
 */
const DEFAULT_OPTIONS: Required<ConversationServiceOptions> = {
    maxHistoryLength: 100,
    enableRetry: true,
    maxRetries: 3,
    retryDelay: 1000,
    timeout: 30000,
};

/**
 * Service for handling conversation logic
 * Stateless service that manages conversation context, AI provider calls, and response processing
 * All methods are pure functions without instance state
 */
export class ConversationService implements ConversationServiceInterface {

    /**
     * Prepare conversation context from messages and configuration
     * Pure function that transforms inputs to context object
     */
    prepareContext(
        messages: UniversalMessage[],
        model: string,
        provider: string,
        contextOptions: ContextOptions = {},
        serviceOptions: ConversationServiceOptions = {}
    ): ConversationContext {
        const logger = createLogger('ConversationService');
        return ConversationService.createContext(
            messages,
            model,
            provider,
            contextOptions,
            serviceOptions,
            logger
        );
    }

    /**
     * Generate a response using the AI provider
     * Stateless operation that handles the full request-response cycle
     */
    async generateResponse(
        provider: AIProvider,
        context: ConversationContext,
        serviceOptions: ConversationServiceOptions = {}
    ): Promise<ConversationResponse> {
        const logger = createLogger('ConversationService');
        return ConversationService.performResponseGeneration(provider, context, serviceOptions, logger);
    }

    /**
     * Generate streaming response using the AI provider
     * Stateless streaming operation
     */
    async* generateStreamingResponse(
        provider: AIProvider,
        context: ConversationContext,
        serviceOptions: ConversationServiceOptions = {}
    ): AsyncGenerator<StreamingChunk, void, unknown> {
        const logger = createLogger('ConversationService');
        yield* ConversationService.performStreamingResponse(provider, context, serviceOptions, logger);
    }

    /**
     * Validate conversation context
     * Pure validation function
     */
    validateContext(context: ConversationContext): { isValid: boolean; errors: string[] } {
        return ConversationService.performContextValidation(context);
    }

    // ==============================================
    // Static helper methods (pure functions)
    // ==============================================

    /**
     * Static helper method for context creation
     */
    private static createContext(
        messages: UniversalMessage[],
        model: string,
        provider: string,
        contextOptions: ContextOptions,
        serviceOptions: ConversationServiceOptions,
        logger: Logger
    ): ConversationContext {
        const options = { ...DEFAULT_OPTIONS, ...serviceOptions };

        // Limit history length if configured
        let processedMessages = messages;
        if (options.maxHistoryLength > 0 && messages.length > options.maxHistoryLength) {
            // Keep system message if it exists, then take the most recent messages
            const systemMessages = messages.filter(m => m.role === 'system');
            const otherMessages = messages.filter(m => m.role !== 'system');

            const recentMessages = otherMessages.slice(-options.maxHistoryLength + systemMessages.length);
            processedMessages = [...systemMessages, ...recentMessages];

            logger.debug('Trimmed conversation history', {
                originalLength: messages.length,
                trimmedLength: processedMessages.length,
                maxLength: options.maxHistoryLength,
            });
        }

        const context: ConversationContext = {
            messages: processedMessages,
            model,
            provider,
            systemMessage: contextOptions.systemMessage,
            temperature: contextOptions.temperature,
            maxTokens: contextOptions.maxTokens,
            tools: contextOptions.tools,
            metadata: contextOptions.metadata,
        };

        logger.debug('Conversation context prepared', {
            messageCount: context.messages.length,
            model: context.model,
            provider: context.provider,
            hasSystemMessage: !!context.systemMessage,
            hasTools: !!(context.tools && context.tools.length > 0),
        });

        return context;
    }

    /**
     * Static method for response generation
     */
    private static async performResponseGeneration(
        provider: AIProvider,
        context: ConversationContext,
        serviceOptions: ConversationServiceOptions,
        logger: Logger
    ): Promise<ConversationResponse> {
        const options = { ...DEFAULT_OPTIONS, ...serviceOptions };
        const startTime = Date.now();

        try {
            logger.debug('Starting response generation', {
                provider: context.provider,
                model: context.model,
                messageCount: context.messages.length,
            });

            // Create request payload
            const requestPayload = ConversationService.createProviderRequest(context);

            // Generate response with retry logic
            const response = await ConversationService.executeWithRetry(
                () => provider.generateResponse(requestPayload),
                `generateResponse for ${context.provider}:${context.model}`,
                options,
                logger
            );

            // Process and validate response
            const processedResponse = ConversationService.processProviderResponse(response);

            const duration = Date.now() - startTime;
            logger.info('Response generated successfully', {
                provider: context.provider,
                model: context.model,
                duration,
                usage: processedResponse.usage,
            });

            return processedResponse;

        } catch (error) {
            const duration = Date.now() - startTime;
            logger.error('Response generation failed', {
                provider: context.provider,
                model: context.model,
                duration,
                error: error instanceof Error ? error.message : String(error),
            });

            if (error instanceof NetworkError || error instanceof ProviderError) {
                throw error;
            }

            throw new ProviderError(
                `Response generation failed: ${error instanceof Error ? error.message : String(error)}`,
                context.provider,
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Static method for streaming response generation
     */
    private static async* performStreamingResponse(
        provider: AIProvider,
        context: ConversationContext,
        serviceOptions: ConversationServiceOptions,
        logger: Logger
    ): AsyncGenerator<StreamingChunk, void, unknown> {
        const options = { ...DEFAULT_OPTIONS, ...serviceOptions };
        const startTime = Date.now();

        try {
            logger.debug('Starting streaming response generation', {
                provider: context.provider,
                model: context.model,
                messageCount: context.messages.length,
            });

            // Create request payload for streaming
            const requestPayload = ConversationService.createProviderRequest(context, true);

            // Check if provider supports streaming
            if (!provider.generateStreamingResponse) {
                throw new ProviderError(`Provider does not support streaming`, context.provider);
            }

            // Generate streaming response
            const streamingResponse = provider.generateStreamingResponse(requestPayload);

            let chunkCount = 0;
            for await (const chunk of streamingResponse) {
                chunkCount++;
                const processedChunk = ConversationService.processStreamingChunk(chunk);

                logger.debug('Streaming chunk processed', {
                    chunkNumber: chunkCount,
                    deltaLength: processedChunk.delta.length,
                    done: processedChunk.done,
                });

                yield processedChunk;

                if (processedChunk.done) {
                    break;
                }
            }

            const duration = Date.now() - startTime;
            logger.info('Streaming response completed', {
                provider: context.provider,
                model: context.model,
                duration,
                totalChunks: chunkCount,
            });

        } catch (error) {
            const duration = Date.now() - startTime;
            logger.error('Streaming response failed', {
                provider: context.provider,
                model: context.model,
                duration,
                error: error instanceof Error ? error.message : String(error),
            });

            if (error instanceof NetworkError || error instanceof ProviderError) {
                throw error;
            }

            throw new ProviderError(
                `Streaming response failed: ${error instanceof Error ? error.message : String(error)}`,
                context.provider,
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Static method for context validation
     */
    private static performContextValidation(context: ConversationContext): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!context.messages || !Array.isArray(context.messages)) {
            errors.push('Messages must be an array');
        } else if (context.messages.length === 0) {
            errors.push('At least one message is required');
        }

        if (!context.model || typeof context.model !== 'string') {
            errors.push('Model must be a non-empty string');
        }

        if (!context.provider || typeof context.provider !== 'string') {
            errors.push('Provider must be a non-empty string');
        }

        if (context.temperature !== undefined && (typeof context.temperature !== 'number' || context.temperature < 0 || context.temperature > 2)) {
            errors.push('Temperature must be a number between 0 and 2');
        }

        if (context.maxTokens !== undefined && (typeof context.maxTokens !== 'number' || context.maxTokens <= 0)) {
            errors.push('MaxTokens must be a positive number');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    // ==============================================
    // Message creation utilities (pure functions)
    // ==============================================

    /**
     * Create a user message
     */
    createUserMessage(content: string, metadata?: Record<string, any>): UserMessage {
        return ConversationService.createUserMessageStatic(content, metadata);
    }

    /**
     * Create an assistant message from response
     */
    createAssistantMessage(response: ConversationResponse, metadata?: Record<string, any>): AssistantMessage {
        return ConversationService.createAssistantMessageStatic(response, metadata);
    }

    /**
     * Create a system message
     */
    createSystemMessage(content: string, metadata?: Record<string, any>): SystemMessage {
        return ConversationService.createSystemMessageStatic(content, metadata);
    }

    /**
     * Create a tool message
     */
    createToolMessage(toolCallId: string, result: any, metadata?: Record<string, any>): ToolMessage {
        return ConversationService.createToolMessageStatic(toolCallId, result, metadata);
    }

    // Static versions of message creation methods
    private static createUserMessageStatic(content: string, metadata?: Record<string, any>): UserMessage {
        return {
            role: 'user',
            content,
            metadata: {
                timestamp: new Date().toISOString(),
                ...metadata
            }
        };
    }

    private static createAssistantMessageStatic(response: ConversationResponse, metadata?: Record<string, any>): AssistantMessage {
        const message: AssistantMessage = {
            role: 'assistant',
            content: response.content,
            metadata: {
                timestamp: new Date().toISOString(),
                usage: response.usage,
                finishReason: response.finishReason,
                ...metadata
            }
        };

        if (response.toolCalls && response.toolCalls.length > 0) {
            message.toolCalls = response.toolCalls;
        }

        return message;
    }

    private static createSystemMessageStatic(content: string, metadata?: Record<string, any>): SystemMessage {
        return {
            role: 'system',
            content,
            metadata: {
                timestamp: new Date().toISOString(),
                ...metadata
            }
        };
    }

    private static createToolMessageStatic(toolCallId: string, result: any, metadata?: Record<string, any>): ToolMessage {
        return {
            role: 'tool',
            content: typeof result === 'string' ? result : JSON.stringify(result),
            toolCallId,
            result,
            metadata: {
                timestamp: new Date().toISOString(),
                ...metadata
            }
        };
    }

    // ==============================================
    // Pure utility functions
    // ==============================================

    private static createProviderRequest(context: ConversationContext, streaming: boolean = false): any {
        return {
            messages: context.messages,
            model: context.model,
            temperature: context.temperature,
            maxTokens: context.maxTokens,
            tools: context.tools,
            stream: streaming,
            systemMessage: context.systemMessage,
            metadata: context.metadata
        };
    }

    private static processProviderResponse(response: any): ConversationResponse {
        return {
            content: response.content || '',
            toolCalls: response.toolCalls || [],
            usage: response.usage || undefined,
            metadata: response.metadata || {},
            finishReason: response.finishReason || 'stop'
        };
    }

    private static processStreamingChunk(chunk: any): StreamingChunk {
        return {
            delta: chunk.delta || '',
            done: chunk.done || false,
            toolCalls: chunk.toolCalls || [],
            usage: chunk.usage || undefined
        };
    }

    private static async executeWithRetry<T>(
        fn: () => Promise<T>,
        operation: string,
        options: Required<ConversationServiceOptions>,
        logger: Logger
    ): Promise<T> {
        let lastError: Error | undefined;

        for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
            try {
                const result = await ConversationService.withTimeout(fn(), options.timeout);

                if (attempt > 1) {
                    logger.info(`${operation} succeeded on attempt ${attempt}`);
                }

                return result;
            } catch (error) {
                lastError = error as Error;

                // Don't retry if this is the last attempt or if error shouldn't be retried
                if (attempt === options.maxRetries || !ConversationService.shouldRetryError(lastError)) {
                    break;
                }

                logger.warn(`${operation} failed on attempt ${attempt}, retrying...`, {
                    attempt,
                    maxRetries: options.maxRetries,
                    error: lastError.message,
                    retryDelay: options.retryDelay
                });

                await ConversationService.delay(options.retryDelay);
            }
        }

        if (lastError) {
            logger.error(`${operation} failed after ${options.maxRetries} attempts`, {
                error: lastError.message
            });
            throw lastError;
        }

        // This should never happen, but just in case
        throw new Error(`${operation} failed with no error details`);
    }

    private static shouldRetryError(error: Error): boolean {
        // Retry on network errors and specific provider errors
        if (error instanceof NetworkError) {
            return true;
        }

        // Retry on timeout errors
        if (error.message.includes('timeout') || error.message.includes('TIMEOUT')) {
            return true;
        }

        // Retry on rate limit errors
        if (error.message.includes('rate limit') || error.message.includes('429')) {
            return true;
        }

        // Don't retry on other errors
        return false;
    }

    private static withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
        return Promise.race([
            promise,
            ConversationService.createTimeoutPromise<T>(timeoutMs)
        ]);
    }

    private static createTimeoutPromise<T>(timeoutMs: number): Promise<T> {
        return new Promise((_, reject) => {
            setTimeout(() => {
                reject(new NetworkError(`Operation timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        });
    }

    private static delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
} 