import { Message, UserMessage, AssistantMessage, SystemMessage, ToolMessage } from '../interfaces/agent';
import { AIProvider } from '../interfaces/provider';
import { Logger } from '../utils/logger';
import { NetworkError, ProviderError } from '../utils/errors';

/**
 * Conversation context containing messages and metadata
 */
export interface ConversationContext {
    /** All messages in the conversation */
    messages: Message[];
    /** System message for the conversation */
    systemMessage?: string;
    /** Model to use for generation */
    model: string;
    /** Provider to use for generation */
    provider: string;
    /** Temperature for generation */
    temperature?: number;
    /** Maximum tokens to generate */
    maxTokens?: number;
    /** Available tools */
    tools?: any[];
    /** Additional metadata */
    metadata?: Record<string, any>;
}

/**
 * Response from AI provider
 */
export interface ConversationResponse {
    /** Generated content */
    content: string;
    /** Tool calls if any */
    toolCalls?: any[];
    /** Usage statistics */
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    /** Response metadata */
    metadata?: Record<string, any>;
    /** Finish reason */
    finishReason?: string;
}

/**
 * Streaming response chunk
 */
export interface StreamingChunk {
    /** Content delta */
    delta: string;
    /** Whether this is the final chunk */
    done: boolean;
    /** Tool calls if any */
    toolCalls?: any[];
    /** Usage statistics (only in final chunk) */
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

/**
 * Conversation service options
 */
export interface ConversationServiceOptions {
    /** Maximum conversation history length */
    maxHistoryLength?: number;
    /** Whether to automatically retry on failure */
    enableRetry?: boolean;
    /** Maximum number of retries */
    maxRetries?: number;
    /** Retry delay in milliseconds */
    retryDelay?: number;
    /** Request timeout in milliseconds */
    timeout?: number;
}

/**
 * Service for handling conversation logic
 * Manages conversation context, AI provider calls, and response processing
 */
export class ConversationService {
    private logger: Logger;
    private options: Required<ConversationServiceOptions>;

    constructor(options: ConversationServiceOptions = {}) {
        this.logger = new Logger('ConversationService');
        this.options = {
            maxHistoryLength: options.maxHistoryLength || 100,
            enableRetry: options.enableRetry ?? true,
            maxRetries: options.maxRetries || 3,
            retryDelay: options.retryDelay || 1000,
            timeout: options.timeout || 30000,
        };

        this.logger.info('ConversationService initialized', { options: this.options });
    }

    /**
     * Prepare conversation context from messages and configuration
     */
    prepareContext(
        messages: Message[],
        model: string,
        provider: string,
        options: {
            systemMessage?: string;
            temperature?: number;
            maxTokens?: number;
            tools?: any[];
            metadata?: Record<string, any>;
        } = {}
    ): ConversationContext {
        // Limit history length if configured
        let processedMessages = messages;
        if (this.options.maxHistoryLength > 0 && messages.length > this.options.maxHistoryLength) {
            // Keep system message if it exists, then take the most recent messages
            const systemMessages = messages.filter(m => m.role === 'system');
            const otherMessages = messages.filter(m => m.role !== 'system');

            const recentMessages = otherMessages.slice(-this.options.maxHistoryLength + systemMessages.length);
            processedMessages = [...systemMessages, ...recentMessages];

            this.logger.debug('Trimmed conversation history', {
                originalLength: messages.length,
                trimmedLength: processedMessages.length,
                maxLength: this.options.maxHistoryLength,
            });
        }

        const context: ConversationContext = {
            messages: processedMessages,
            model,
            provider,
            systemMessage: options.systemMessage,
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            tools: options.tools,
            metadata: options.metadata,
        };

        this.logger.debug('Conversation context prepared', {
            messageCount: context.messages.length,
            model: context.model,
            provider: context.provider,
            hasSystemMessage: !!context.systemMessage,
            hasTools: !!(context.tools && context.tools.length > 0),
        });

        return context;
    }

    /**
     * Generate a response using the AI provider
     */
    async generateResponse(
        provider: AIProvider,
        context: ConversationContext
    ): Promise<ConversationResponse> {
        const startTime = Date.now();

        try {
            this.logger.debug('Starting response generation', {
                provider: context.provider,
                model: context.model,
                messageCount: context.messages.length,
            });

            // Create request payload
            const requestPayload = this.createProviderRequest(context);

            // Generate response with retry logic
            const response = await this.executeWithRetry(
                () => provider.generateResponse(requestPayload),
                `generateResponse for ${context.provider}:${context.model}`
            );

            // Process and validate response
            const processedResponse = this.processProviderResponse(response);

            const duration = Date.now() - startTime;
            this.logger.info('Response generated successfully', {
                provider: context.provider,
                model: context.model,
                duration,
                tokenUsage: processedResponse.usage,
                finishReason: processedResponse.finishReason,
            });

            return processedResponse;
        } catch (error) {
            const duration = Date.now() - startTime;
            this.logger.error('Failed to generate response', {
                provider: context.provider,
                model: context.model,
                duration,
                error,
            });
            throw error;
        }
    }

    /**
     * Generate a streaming response using the AI provider
     */
    async* generateStreamingResponse(
        provider: AIProvider,
        context: ConversationContext
    ): AsyncGenerator<StreamingChunk, void, unknown> {
        const startTime = Date.now();

        try {
            this.logger.debug('Starting streaming response generation', {
                provider: context.provider,
                model: context.model,
                messageCount: context.messages.length,
            });

            // Create request payload for streaming
            const requestPayload = this.createProviderRequest(context, true);

            // Check if provider supports streaming
            if (!provider.generateStreamingResponse) {
                throw new ProviderError(
                    `Provider does not support streaming`,
                    context.provider
                );
            }

            // Generate streaming response
            const streamGenerator = provider.generateStreamingResponse(requestPayload);
            let totalDelta = '';
            let chunkCount = 0;

            for await (const chunk of streamGenerator) {
                chunkCount++;
                const processedChunk = this.processStreamingChunk(chunk);
                totalDelta += processedChunk.delta;

                this.logger.debug('Streaming chunk processed', {
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
            this.logger.info('Streaming response completed', {
                provider: context.provider,
                model: context.model,
                duration,
                chunkCount,
                totalLength: totalDelta.length,
            });
        } catch (error) {
            const duration = Date.now() - startTime;
            this.logger.error('Failed to generate streaming response', {
                provider: context.provider,
                model: context.model,
                duration,
                error,
            });
            throw error;
        }
    }

    /**
     * Create a conversation message from user input
     */
    createUserMessage(content: string, metadata?: Record<string, any>): UserMessage {
        return {
            role: 'user',
            content,
            timestamp: new Date(),
            metadata,
        };
    }

    /**
     * Create an assistant message from generated response
     */
    createAssistantMessage(
        response: ConversationResponse,
        metadata?: Record<string, any>
    ): AssistantMessage {
        return {
            role: 'assistant',
            content: response.content,
            timestamp: new Date(),
            toolCalls: response.toolCalls,
            metadata: {
                ...metadata,
                usage: response.usage,
                finishReason: response.finishReason,
                ...response.metadata,
            },
        };
    }

    /**
     * Create a system message
     */
    createSystemMessage(content: string, metadata?: Record<string, any>): SystemMessage {
        return {
            role: 'system',
            content,
            timestamp: new Date(),
            metadata,
        };
    }

    /**
     * Create a tool message from tool execution result
     */
    createToolMessage(
        toolCallId: string,
        result: any,
        metadata?: Record<string, any>
    ): ToolMessage {
        return {
            role: 'tool',
            content: typeof result === 'string' ? result : JSON.stringify(result),
            timestamp: new Date(),
            toolCallId,
            result,
            metadata,
        };
    }

    /**
     * Validate conversation context
     */
    validateContext(context: ConversationContext): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!context.messages || context.messages.length === 0) {
            errors.push('Context must have at least one message');
        }

        if (!context.model) {
            errors.push('Context must specify a model');
        }

        if (!context.provider) {
            errors.push('Context must specify a provider');
        }

        if (context.temperature !== undefined) {
            if (typeof context.temperature !== 'number' || context.temperature < 0 || context.temperature > 2) {
                errors.push('Temperature must be a number between 0 and 2');
            }
        }

        if (context.maxTokens !== undefined) {
            if (typeof context.maxTokens !== 'number' || context.maxTokens <= 0) {
                errors.push('Max tokens must be a positive number');
            }
        }

        return { isValid: errors.length === 0, errors };
    }

    /**
     * Create provider-specific request payload
     */
    private createProviderRequest(context: ConversationContext, streaming: boolean = false): any {
        const baseRequest = {
            model: context.model,
            messages: context.messages,
            temperature: context.temperature,
            max_tokens: context.maxTokens,
            tools: context.tools,
            stream: streaming,
        };

        // Add system message if provided and not already in messages
        if (context.systemMessage) {
            const hasSystemMessage = context.messages.some(m => m.role === 'system');
            if (!hasSystemMessage) {
                baseRequest.messages = [
                    this.createSystemMessage(context.systemMessage),
                    ...context.messages,
                ];
            }
        }

        return baseRequest;
    }

    /**
     * Process provider response into standard format
     */
    private processProviderResponse(response: any): ConversationResponse {
        // This would need to be adapted based on specific provider response formats
        return {
            content: response.content || response.message?.content || '',
            toolCalls: response.tool_calls || response.toolCalls,
            usage: response.usage && {
                promptTokens: response.usage.prompt_tokens || response.usage.promptTokens || 0,
                completionTokens: response.usage.completion_tokens || response.usage.completionTokens || 0,
                totalTokens: response.usage.total_tokens || response.usage.totalTokens || 0,
            },
            finishReason: response.finish_reason || response.finishReason,
            metadata: response.metadata,
        };
    }

    /**
     * Process streaming chunk into standard format
     */
    private processStreamingChunk(chunk: any): StreamingChunk {
        return {
            delta: chunk.delta?.content || chunk.content || '',
            done: chunk.done || chunk.finish_reason !== undefined,
            toolCalls: chunk.delta?.tool_calls || chunk.toolCalls,
            usage: chunk.usage && {
                promptTokens: chunk.usage.prompt_tokens || chunk.usage.promptTokens || 0,
                completionTokens: chunk.usage.completion_tokens || chunk.usage.completionTokens || 0,
                totalTokens: chunk.usage.total_tokens || chunk.usage.totalTokens || 0,
            },
        };
    }

    /**
 * Execute a function with retry logic
 */
    private async executeWithRetry<T>(
        fn: () => Promise<T>,
        operation: string
    ): Promise<T> {
        if (!this.options.enableRetry) {
            return fn();
        }

        let lastError: Error | undefined;

        for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
            try {
                return await this.withTimeout(fn(), this.options.timeout);
            } catch (error) {
                lastError = error as Error;

                this.logger.warn(`${operation} failed (attempt ${attempt}/${this.options.maxRetries})`, {
                    error: error instanceof Error ? error.message : String(error),
                    attempt,
                });

                // Don't retry on certain types of errors
                if (error instanceof ProviderError && !this.shouldRetryError(error)) {
                    throw error;
                }

                // Don't wait after the last attempt
                if (attempt < this.options.maxRetries) {
                    await this.delay(this.options.retryDelay * attempt);
                }
            }
        }

        throw lastError!;
    }

    /**
     * Determine if an error should be retried
     */
    private shouldRetryError(error: Error): boolean {
        // Retry on network errors and certain provider errors
        if (error instanceof NetworkError) {
            return true;
        }

        if (error instanceof ProviderError) {
            // Retry on rate limits and temporary server errors
            return error.message.includes('rate limit') ||
                error.message.includes('timeout') ||
                error.message.includes('502') ||
                error.message.includes('503') ||
                error.message.includes('504');
        }

        return false;
    }

    /**
     * Add timeout to a promise
     */
    private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
        return Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                setTimeout(() => reject(new NetworkError(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
            }),
        ]);
    }

    /**
     * Delay execution for specified milliseconds
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
} 