import Anthropic from '@anthropic-ai/sdk';
import {
    Context,
    Message,
    AIProvider,
    ModelResponse,
    StreamingResponseChunk,
    UniversalMessage
} from '@robota-sdk/core';
import type { FunctionDefinition, FunctionCall } from '@robota-sdk/tools';
import { AnthropicProviderOptions } from './types';
import { AnthropicConversationAdapter } from './adapter';

/**
 * Anthropic provider implementation for Robota
 * 
 * Provides integration with Anthropic's Claude models.
 * Implements the universal AIProvider interface for consistent usage across providers.
 * 
 * @see {@link ../../../apps/examples/03-integrations | Provider Integration Examples}
 * 
 * @public
 */
export class AnthropicProvider implements AIProvider {
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
     * Create a new Anthropic provider instance
     * 
     * @param options - Configuration options for the Anthropic provider
     * 
     * @throws {Error} When client is not provided in options
     */
    constructor(options: AnthropicProviderOptions) {
        this.options = {
            temperature: 0.7,
            maxTokens: undefined,
            ...options
        };

        // Validate required client injection
        if (!options.client) {
            throw new Error('Anthropic client is not injected. The client option is required.');
        }

        this.client = options.client;
    }

    /**
     * Send a chat request to Anthropic and receive a complete response
     * 
     * Processes the provided context and sends it to Anthropic's Messages API.
     * Handles message format conversion, error handling, and response parsing.
     * 
     * @param model - Model name to use (e.g., 'claude-3-sonnet-20240229', 'claude-3-opus-20240229')
     * @param context - Context object containing messages and system prompt
     * @param options - Optional generation parameters
     * @returns Promise resolving to the model's response
     * 
     * @throws {Error} When context is invalid
     * @throws {Error} When messages array is invalid
     * @throws {Error} When Anthropic API call fails
     */
    async chat(model: string, context: Context, options?: any): Promise<ModelResponse> {
        // Validate context parameter
        if (!context || typeof context !== 'object') {
            throw new Error('Valid Context object is required');
        }

        const { messages, systemPrompt } = context;

        // Validate messages array
        if (!Array.isArray(messages)) {
            throw new Error('Valid message array is required');
        }

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

            const response = await this.client.messages.create(requestParams);

            return this.parseResponse(response);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Anthropic API call error: ${errorMessage}`);
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
     * @param options - Optional generation parameters
     * @returns Async generator yielding response chunks
     * 
     * @throws {Error} When context is invalid
     * @throws {Error} When messages array is invalid
     * @throws {Error} When Anthropic streaming API call fails
     */
    async *chatStream(model: string, context: Context, options?: any): AsyncGenerator<StreamingResponseChunk, void, unknown> {
        // Validate context parameter
        if (!context || typeof context !== 'object') {
            throw new Error('Valid Context object is required');
        }

        const { messages, systemPrompt } = context;

        // Validate messages array
        if (!Array.isArray(messages)) {
            throw new Error('Valid message array is required');
        }

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

            const stream = await this.client.messages.create(requestParams) as any;

            for await (const chunk of stream) {
                yield this.parseStreamingChunk(chunk);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Anthropic streaming API call error: ${errorMessage}`);
        }
    }

    /**
     * Format function definitions for Anthropic
     * 
     * @param _functions - Array of function definitions to format
     * @returns Formatted functions (currently returns empty array as Anthropic function calling has limited support)
     * 
     * @remarks
     * Anthropic API may not yet fully support function calling features in the same way as OpenAI.
     * This method returns empty array as placeholder for future implementation.
     */
    formatFunctions(_functions: FunctionDefinition[]): unknown {
        // TODO: Implement Anthropic function calling support when available
        // Anthropic API may not yet support function calling features
        return [];
    }

    /**
     * Parse Anthropic response into universal ModelResponse format
     * 
     * Extracts content, usage information, and metadata from the Anthropic response
     * and converts it to the standard format used across all providers.
     * 
     * @param response - Raw response from Anthropic Messages API
     * @returns Parsed model response in universal format
     * 
     * @internal
     */
    parseResponse(response: any): ModelResponse {
        // Extract content from Messages API response
        const content = response.content?.[0]?.text || '';

        return {
            content,
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