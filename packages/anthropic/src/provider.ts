import Anthropic from '@anthropic-ai/sdk';
import {
    Context,
    BaseAIProvider,
    ModelResponse,
    StreamingResponseChunk,
    UniversalMessage
} from '@robota-sdk/core';
import type { FunctionSchema } from '@robota-sdk/tools';
import { AnthropicProviderOptions } from './types';
import { AnthropicConversationAdapter } from './adapter';
import { PayloadLogger } from './payload-logger';

/**
 * Anthropic AI provider implementation for Robota
 * 
 * Provides integration with Anthropic's Claude models.
 * Extends BaseAIProvider for common functionality and tool calling support.
 * 
 * @see {@link ../../../apps/examples/03-integrations | Provider Integration Examples}
 * 
 * @public
 */
export class AnthropicProvider extends BaseAIProvider {
    /**
     * Provider identifier name
     * @readonly
     */
    public readonly name: string = 'anthropic';

    /**
     * Anthropic client instance
     * @internal
     */
    private readonly client: Anthropic;

    /**
     * Provider configuration options
     * @readonly
     */
    public readonly options: AnthropicProviderOptions;

    /**
     * Payload logger instance for debugging
     * @internal
     */
    private readonly payloadLogger: PayloadLogger;

    /**
     * Create a new Anthropic provider instance
     * 
     * @param options - Configuration options for the Anthropic provider
     * 
     * @throws {Error} When client is not provided in options
     */
    constructor(options: AnthropicProviderOptions) {
        super();

        this.options = {
            temperature: 0.7,
            maxTokens: undefined,
            // Set default values for parallel tool call options
            enableParallelToolCalls: true,
            maxConcurrentToolCalls: 3,
            toolCallDelayMs: 100,
            ...options
        };

        // Validate required client injection
        if (!options.client) {
            throw new Error('Anthropic client is not injected. The client option is required.');
        }

        this.client = options.client;

        // Initialize payload logger
        this.payloadLogger = new PayloadLogger(
            options.enablePayloadLogging || false,
            options.payloadLogDir || './logs/api-payloads',
            options.includeTimestampInLogFiles ?? true
        );
    }

    /**
     * Send a chat request to Anthropic and receive a complete response
     * 
     * Processes the provided context and sends it to Anthropic's Messages API.
     * Handles message format conversion, error handling, and response parsing.
     * 
     * @param model - Model name to use (e.g., 'claude-3-sonnet-20240229', 'claude-3-opus-20240229')
     * @param context - Context object containing messages and system prompt
     * @param options - Optional generation parameters and tools
     * @returns Promise resolving to the model's response
     * 
     * @throws {Error} When context is invalid
     * @throws {Error} When messages array is invalid
     * @throws {Error} When Anthropic API call fails
     */
    async chat(model: string, context: Context, options?: any): Promise<ModelResponse> {
        // Use base class validation
        this.validateContext(context);

        const { messages, systemPrompt } = context;

        try {
            // Convert UniversalMessage[] to Anthropic Messages format
            const anthropicMessages = AnthropicConversationAdapter.toAnthropicMessages(
                messages as UniversalMessage[]
            );

            const requestParams: any = {
                model: model || this.options.model || 'claude-3-sonnet-20240229',
                max_tokens: options?.maxTokens ?? this.options.maxTokens ?? 1000,
                messages: anthropicMessages,
                temperature: options?.temperature ?? this.options.temperature
            };

            // Add system prompt if provided
            if (systemPrompt) {
                requestParams.system = systemPrompt;
            }

            // Configure tools if provided
            const toolConfig = this.configureTools(options?.tools);
            if (toolConfig) {
                requestParams.tools = toolConfig.tools;
            }

            // Log payload for debugging
            if (this.payloadLogger.isEnabled()) {
                await this.payloadLogger.logPayload(requestParams, 'chat');
            }

            const response = await this.client.messages.create(requestParams);

            return this.parseResponse(response);
        } catch (error) {
            this.handleApiError(error, 'chat');
        }
    }

    /**
     * Send a streaming chat request to Anthropic and receive response chunks
     * 
     * Similar to chat() but returns an async iterator that yields response chunks
     * as they arrive from Anthropic's streaming API. Useful for real-time display
     * of responses or handling large responses incrementally.
     * 
     * @param model - Model name to use
     * @param context - Context object containing messages and system prompt
     * @param options - Optional generation parameters and tools
     * @returns Async generator yielding response chunks
     * 
     * @throws {Error} When context is invalid
     * @throws {Error} When messages array is invalid
     * @throws {Error} When Anthropic streaming API call fails
     */
    async *chatStream(model: string, context: Context, options?: any): AsyncGenerator<StreamingResponseChunk, void, unknown> {
        // Use base class validation
        this.validateContext(context);

        const { messages, systemPrompt } = context;

        try {
            // Convert UniversalMessage[] to Anthropic Messages format
            const anthropicMessages = AnthropicConversationAdapter.toAnthropicMessages(
                messages as UniversalMessage[]
            );

            const requestParams: any = {
                model: model || this.options.model || 'claude-3-sonnet-20240229',
                max_tokens: options?.maxTokens ?? this.options.maxTokens ?? 1000,
                messages: anthropicMessages,
                temperature: options?.temperature ?? this.options.temperature,
                stream: true
            };

            // Add system prompt if provided
            if (systemPrompt) {
                requestParams.system = systemPrompt;
            }

            // Configure tools if provided
            const toolConfig = this.configureTools(options?.tools);
            if (toolConfig) {
                requestParams.tools = toolConfig.tools;
            }

            // Log payload for debugging
            if (this.payloadLogger.isEnabled()) {
                await this.payloadLogger.logPayload(requestParams, 'stream');
            }

            const stream = await this.client.messages.create(requestParams) as any;

            for await (const chunk of stream) {
                yield this.parseStreamingChunk(chunk);
            }
        } catch (error) {
            this.handleApiError(error, 'chatStream');
        }
    }

    /**
     * Configure tools for Anthropic API request
     * 
     * Anthropic supports tool calling with Claude 3 models.
     * Transforms function schemas into Anthropic tool format.
     * 
     * @param tools - Array of function schemas
     * @returns Anthropic tool configuration object or undefined
     */
    protected configureTools(tools?: FunctionSchema[]): { tools: any[] } | undefined {
        if (!tools || !Array.isArray(tools)) {
            return undefined;
        }

        return {
            tools: tools.map(fn => ({
                name: fn.name,
                description: fn.description || '',
                input_schema: fn.parameters
            }))
        };
    }

    /**
     * Parse Anthropic response into universal ModelResponse format
     * 
     * Extracts content, usage information, and metadata from the Anthropic response
     * and converts it to the standard format used across all providers.
     * Supports tool calling with Claude 3 models.
     * 
     * @param response - Raw response from Anthropic Messages API
     * @returns Parsed model response in universal format
     * 
     * @internal
     */
    parseResponse(response: any): ModelResponse {
        let content = '';
        const toolCalls: any[] = [];

        // Process content blocks (text and tool use)
        if (response.content && Array.isArray(response.content)) {
            for (const block of response.content) {
                if (block.type === 'text') {
                    content += block.text;
                } else if (block.type === 'tool_use') {
                    // Convert Anthropic tool use to OpenAI format for consistency
                    toolCalls.push({
                        id: block.id,
                        type: 'function' as const,
                        function: {
                            name: block.name,
                            arguments: JSON.stringify(block.input || {})
                        }
                    });
                }
            }
        }

        const result: ModelResponse = {
            content: content || undefined,
            usage: response.usage ? {
                promptTokens: response.usage.input_tokens || 0,
                completionTokens: response.usage.output_tokens || 0,
                totalTokens: (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0)
            } : {
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0
            },
            metadata: {
                model: response.model,
                finishReason: response.stop_reason,
                messageId: response.id
            }
        };

        // Add tool calls if present
        if (toolCalls.length > 0) {
            result.toolCalls = toolCalls;
        }

        return result;
    }

    /**
     * Parse Anthropic streaming response chunk into universal format
     * 
     * Converts individual chunks from the streaming response into the standard
     * StreamingResponseChunk format used across all providers.
     * 
     * @param chunk - Raw chunk from Anthropic streaming API
     * @returns Parsed streaming response chunk
     * 
     * @internal
     */
    parseStreamingChunk(chunk: any): StreamingResponseChunk {
        // Handle different chunk types from Messages API streaming
        if (chunk.type === 'content_block_delta') {
            return {
                content: chunk.delta?.text || '',
                isComplete: false
            };
        }

        if (chunk.type === 'message_stop') {
            return {
                content: '',
                isComplete: true
            };
        }

        // Default case for other chunk types
        return {
            content: '',
            isComplete: false
        };
    }

    /**
     * Release resources and close connections
     * 
     * Performs cleanup operations when the provider is no longer needed.
     * Anthropic client doesn't require explicit cleanup, so this is a no-op.
     * 
     * @returns Promise that resolves when cleanup is complete
     */
    async close(): Promise<void> {
        // Anthropic client doesn't have explicit close method
        // This is implemented as no-op for interface compliance
    }
} 