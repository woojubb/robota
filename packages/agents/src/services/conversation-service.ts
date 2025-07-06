import type { UniversalMessage, UserMessage, AssistantMessage, SystemMessage, ToolMessage, ConversationMessageMetadata as ConversationContextMetadata } from '../managers/conversation-history-manager';
import type { AIProvider, ToolCall, ProviderRequest as BaseProviderRequest, RawProviderResponse as BaseRawProviderResponse } from '../interfaces/provider';
import type { ToolExecutionResult } from '../interfaces/tool';
import { NetworkError, ProviderError } from '../utils/errors';
import { createLogger, Logger } from '../utils/logger';
import {
    ConversationContext,
    ConversationResponse,
    StreamingChunk,
    ConversationServiceOptions,
    ContextOptions,
    ConversationServiceInterface
} from '../interfaces/service';

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
 * Provider request configuration with stream property
 */
interface ProviderRequest extends BaseProviderRequest {
    model: string; // Make model required
    stream?: boolean;
}

/**
 * Use the base raw provider response from provider interface
 */
type RawProviderResponse = BaseRawProviderResponse;

/**
 * Raw streaming chunk structure
 */
interface RawStreamingChunk {
    delta?: string;
    done?: boolean;
    toolCalls?: ToolCall[];
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    };
}

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
    ): AsyncGenerator<StreamingChunk, void, undefined> {
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
            ...(contextOptions.systemMessage && { systemMessage: contextOptions.systemMessage }),
            ...(contextOptions.temperature !== undefined && { temperature: contextOptions.temperature }),
            ...(contextOptions.maxTokens !== undefined && { maxTokens: contextOptions.maxTokens }),
            ...(contextOptions.tools && { tools: contextOptions.tools }),
            ...(contextOptions.metadata && { metadata: contextOptions.metadata })
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
        _serviceOptions: ConversationServiceOptions,
        logger: Logger
    ): AsyncGenerator<StreamingChunk, void, undefined> {
        // Apply defaults for future use - currently not needed but maintains service contract
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
    createUserMessage(content: string, metadata?: Record<string, string | number | boolean>): UserMessage {
        return ConversationService.createUserMessageStatic(content, metadata);
    }

    /**
     * Create an assistant message from response
     */
    createAssistantMessage(response: ConversationResponse, metadata?: Record<string, string | number | boolean>): AssistantMessage {
        return ConversationService.createAssistantMessageStatic(response, metadata);
    }

    /**
     * Create a system message
     */
    createSystemMessage(content: string, metadata?: Record<string, string | number | boolean>): SystemMessage {
        return ConversationService.createSystemMessageStatic(content, metadata);
    }

    /**
     * Create a tool message
     */
    createToolMessage(toolCallId: string, result: ToolExecutionResult, metadata?: Record<string, string | number | boolean>): ToolMessage {
        return ConversationService.createToolMessageStatic(toolCallId, result, metadata);
    }

    // Static versions of message creation methods
    private static createUserMessageStatic(content: string, metadata?: Record<string, string | number | boolean>): UserMessage {
        return {
            role: 'user',
            content,
            timestamp: new Date(),
            metadata: {
                timestamp: new Date().toISOString(),
                ...metadata
            }
        };
    }

    private static createAssistantMessageStatic(response: ConversationResponse, metadata?: Record<string, string | number | boolean>): AssistantMessage {
        const message: AssistantMessage = {
            role: 'assistant',
            content: response.content,
            timestamp: new Date(),
            metadata: {
                timestamp: new Date().toISOString(),
                ...(response.usage && { usage: JSON.stringify(response.usage) }),
                ...(response.finishReason && { finishReason: response.finishReason }),
                ...metadata
            }
        };

        if (response.toolCalls && response.toolCalls.length > 0) {
            message.toolCalls = response.toolCalls;
        }

        return message;
    }

    private static createSystemMessageStatic(content: string, metadata?: Record<string, string | number | boolean>): SystemMessage {
        return {
            role: 'system',
            content,
            timestamp: new Date(),
            metadata: {
                timestamp: new Date().toISOString(),
                ...metadata
            }
        };
    }

    private static createToolMessageStatic(toolCallId: string, result: ToolExecutionResult, metadata?: Record<string, string | number | boolean>): ToolMessage {
        return {
            role: 'tool',
            content: typeof result === 'string' ? result : JSON.stringify(result),
            toolCallId,
            timestamp: new Date(),
            metadata: {
                timestamp: new Date().toISOString(),
                ...metadata
            }
        };
    }

    // ==============================================
    // Pure utility functions
    // ==============================================

    /**
     * Convert complex metadata to simple provider request format
     */
    private static convertToProviderMetadata(metadata?: ConversationContextMetadata): Record<string, string | number | boolean> | undefined {
        if (!metadata) return undefined;

        const converted: Record<string, string | number | boolean> = {};
        for (const [key, value] of Object.entries(metadata)) {
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                converted[key] = value;
            } else if (value instanceof Date) {
                converted[key] = value.toISOString();
            } else if (Array.isArray(value)) {
                converted[key] = JSON.stringify(value);
            } else {
                converted[key] = JSON.stringify(value);
            }
        }
        return converted;
    }

    /**
     * Convert optional usage to required format
     */
    private static convertUsage(usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }): { promptTokens: number; completionTokens: number; totalTokens: number } | undefined {
        if (!usage) return undefined;

        if (typeof usage.promptTokens === 'number' &&
            typeof usage.completionTokens === 'number' &&
            typeof usage.totalTokens === 'number') {
            return {
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
                totalTokens: usage.totalTokens
            };
        }
        return undefined;
    }

    private static createProviderRequest(context: ConversationContext, streaming: boolean = false): ProviderRequest {
        const metadata = ConversationService.convertToProviderMetadata(context.metadata);

        const request: ProviderRequest = {
            messages: context.messages,
            model: context.model,
            stream: streaming,
            ...(context.temperature !== undefined && { temperature: context.temperature }),
            ...(context.maxTokens !== undefined && { maxTokens: context.maxTokens }),
            ...(context.tools && { tools: context.tools }),
            ...(context.systemMessage && { systemMessage: context.systemMessage }),
            ...(metadata && { metadata })
        };

        return request;
    }

    private static processProviderResponse(response: RawProviderResponse): ConversationResponse {
        const usage = ConversationService.convertUsage(response.usage);

        const result: ConversationResponse = {
            content: response.content || '',
            toolCalls: response.toolCalls || [],
            metadata: response.metadata || {},
            finishReason: response.finishReason || 'stop',
            ...(usage && { usage })
        };

        return result;
    }

    private static processStreamingChunk(chunk: RawStreamingChunk): StreamingChunk {
        const usage = ConversationService.convertUsage(chunk.usage);

        const result: StreamingChunk = {
            delta: chunk.delta || '',
            done: chunk.done || false,
            toolCalls: chunk.toolCalls || [],
            ...(usage && { usage })
        };

        return result;
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