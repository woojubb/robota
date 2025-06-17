import { GoogleGenerativeAI } from '@google/generative-ai';
import type {
    Context,
    AIProvider,
    ModelResponse,
    StreamingResponseChunk,
    UniversalMessage
} from '@robota-sdk/core';
import type { FunctionDefinition } from '@robota-sdk/tools';
import type { GoogleProviderOptions } from './types';
import { GoogleConversationAdapter } from './adapter';

/**
 * Google AI provider implementation for Robota
 * 
 * Provides integration with Google's Generative AI services including Gemini models.
 * Implements the universal AIProvider interface for consistent usage across providers.
 * 
 * @see {@link ../../../apps/examples/03-integrations | Provider Integration Examples}
 * 
 * @public
 */
export class GoogleProvider implements AIProvider {
    /**
     * Provider identifier name
     * @readonly
     */
    public readonly name: string = 'google';

    /**
     * Google AI client instance
     * @internal
     */
    private readonly client: GoogleGenerativeAI;

    /**
     * Provider configuration options
     * @readonly
     */
    public readonly options: GoogleProviderOptions;

    /**
     * Create a new Google AI provider instance
     * 
     * @param options - Configuration options for the Google provider
     * 
     * @throws {Error} When client is not provided in options
     */
    constructor(options: GoogleProviderOptions) {
        this.options = {
            temperature: 0.7,
            maxTokens: undefined,
            ...options
        };

        // Validate required client injection
        if (!options.client) {
            throw new Error('Google AI client is not injected. The client option is required.');
        }

        this.client = options.client;
    }

    /**
     * Send a chat request to Google AI and receive a complete response
     * 
     * @param model - Model name to use (e.g., 'gemini-1.5-pro', 'gemini-1.5-flash')
     * @param context - Context object containing messages and system prompt
     * @param options - Optional generation parameters
     * @returns Promise resolving to the model's response
     * 
     * @throws {Error} When context is invalid
     * @throws {Error} When messages array is invalid
     * @throws {Error} When Google AI API call fails
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
            // Convert UniversalMessage[] to Google AI format
            const { contents, systemInstruction } = GoogleConversationAdapter.processMessages(
                messages as UniversalMessage[],
                systemPrompt
            );

            // Get Google AI model instance
            const generativeModel = this.client.getGenerativeModel({
                model: model || this.options.model || 'gemini-1.5-flash',
                systemInstruction: systemInstruction
            });

            // Configure generation parameters
            const generationConfig = {
                temperature: options?.temperature ?? this.options.temperature,
                maxOutputTokens: options?.maxTokens ?? this.options.maxTokens,
                ...(this.options.responseMimeType && {
                    responseMimeType: this.options.responseMimeType
                }),
                ...(this.options.responseSchema && {
                    responseSchema: this.options.responseSchema
                })
            };

            // Generate content
            const result = await generativeModel.generateContent({
                contents,
                generationConfig
            });

            return this.parseResponse(result);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Google AI API call error: ${errorMessage}`);
        }
    }

    /**
     * Send a streaming chat request to Google AI and receive response chunks
     * 
     * Generates an async iterator that yields response chunks as they arrive.
     * Useful for real-time display of responses or handling large responses incrementally.
     * 
     * @param model - Model name to use
     * @param context - Context object containing messages and system prompt
     * @param options - Optional generation parameters
     * @returns Async generator yielding response chunks
     * 
     * @throws {Error} When context is invalid
     * @throws {Error} When messages array is invalid
     * @throws {Error} When Google AI API streaming call fails
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
            // Convert UniversalMessage[] to Google AI format
            const { contents, systemInstruction } = GoogleConversationAdapter.processMessages(
                messages as UniversalMessage[],
                systemPrompt
            );

            // Get Google AI model instance
            const generativeModel = this.client.getGenerativeModel({
                model: model || this.options.model || 'gemini-1.5-flash',
                systemInstruction: systemInstruction
            });

            // Configure generation parameters
            const generationConfig = {
                temperature: options?.temperature ?? this.options.temperature,
                maxOutputTokens: options?.maxTokens ?? this.options.maxTokens,
                ...(this.options.responseMimeType && {
                    responseMimeType: this.options.responseMimeType
                }),
                ...(this.options.responseSchema && {
                    responseSchema: this.options.responseSchema
                })
            };

            // Generate streaming content
            const result = await generativeModel.generateContentStream({
                contents,
                generationConfig
            });

            for await (const chunk of result.stream) {
                yield this.parseStreamingChunk(chunk);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Google AI streaming API call error: ${errorMessage}`);
        }
    }

    /**
     * Format function definitions for Google AI
     * 
     * @param _functions - Array of function definitions to format
     * @returns Formatted functions (currently returns empty array as Google AI function calling is pending implementation)
     * 
     * @remarks
     * Google AI function calling support is planned for future implementation.
     * Currently returns empty array as placeholder.
     */
    formatFunctions(_functions: FunctionDefinition[]): unknown {
        // TODO: Implement Google AI function calling support
        // Google AI function calling feature implementation pending
        return [];
    }

    /**
     * Parse Google AI response into universal ModelResponse format
     * 
     * Extracts content, usage information, and metadata from the Google AI response
     * and converts it to the standard format used across all providers.
     * 
     * @param response - Raw response from Google AI API
     * @returns Parsed model response in universal format
     * 
     * @internal
     */
    parseResponse(response: any): ModelResponse {
        const text = response.response?.text() || '';

        // Extract usage information from response if available
        const usageMetadata = response.response?.usageMetadata;
        const usage = usageMetadata ? {
            promptTokens: usageMetadata.promptTokenCount || 0,
            completionTokens: usageMetadata.candidatesTokenCount || 0,
            totalTokens: usageMetadata.totalTokenCount || 0
        } : {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0
        };

        return {
            content: text,
            usage,
            metadata: {
                model: response.response?.model,
                finishReason: response.response?.candidates?.[0]?.finishReason,
                safetyRatings: response.response?.candidates?.[0]?.safetyRatings
            }
        };
    }

    /**
     * Parse Google AI streaming response chunk into universal format
     * 
     * Converts individual chunks from the streaming response into the standard
     * StreamingResponseChunk format used across all providers.
     * 
     * @param chunk - Raw chunk from Google AI streaming API
     * @returns Parsed streaming response chunk
     * 
     * @internal
     */
    parseStreamingChunk(chunk: any): StreamingResponseChunk {
        const text = chunk.text() || '';

        // Determine if this is the final chunk
        const candidate = chunk.candidates?.[0];
        const isComplete = candidate?.finishReason !== undefined && candidate.finishReason !== null;

        return {
            content: text,
            isComplete
        };
    }

    /**
     * Release resources and close connections
     * 
     * Performs cleanup operations when the provider is no longer needed.
     * Google AI client doesn't require explicit cleanup, so this is a no-op.
     * 
     * @returns Promise that resolves when cleanup is complete
     */
    async close(): Promise<void> {
        // Google AI client doesn't have explicit close method
        // This is implemented as no-op for interface compliance
    }
} 