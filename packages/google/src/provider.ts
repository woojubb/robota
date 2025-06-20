import { GoogleGenerativeAI } from '@google/generative-ai';
import { BaseAIProvider } from '@robota-sdk/core';
import type {
    Context,
    ModelResponse,
    StreamingResponseChunk,
    UniversalMessage
} from '@robota-sdk/core';
import type { FunctionSchema } from '@robota-sdk/tools';
import type { GoogleProviderOptions } from './types';
import { GoogleConversationAdapter } from './adapter';

/**
 * Google AI provider implementation for Robota
 * 
 * Provides integration with Google's Generative AI services including Gemini models.
 * Extends BaseAIProvider for common functionality and tool calling support.
 * 
 * @see {@link ../../../apps/examples/03-integrations | Provider Integration Examples}
 * 
 * @public
 */
export class GoogleProvider extends BaseAIProvider {
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
        super();

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
     * @param options - Optional generation parameters and tools
     * @returns Promise resolving to the model's response
     * 
     * @throws {Error} When context is invalid
     * @throws {Error} When messages array is invalid
     * @throws {Error} When Google AI API call fails
     */
    async chat(model: string, context: Context, options?: any): Promise<ModelResponse> {
        // Use base class validation
        this.validateContext(context);

        const { messages, systemPrompt } = context;

        try {
            // Convert UniversalMessage[] to Google AI format
            const { contents, systemInstruction } = GoogleConversationAdapter.processMessages(
                messages as UniversalMessage[],
                systemPrompt
            );

            // Configure tools if provided
            const toolConfig = this.configureTools(options?.tools);
            const modelConfig: any = {
                model: model || this.options.model || 'gemini-1.5-flash',
                systemInstruction: systemInstruction
            };

            // Add tools to model configuration if available
            if (toolConfig) {
                modelConfig.tools = toolConfig.tools;
            }

            // Get Google AI model instance
            const generativeModel = this.client.getGenerativeModel(modelConfig);

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
            this.handleApiError(error, 'chat');
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
     * @param options - Optional generation parameters and tools
     * @returns Async generator yielding response chunks
     * 
     * @throws {Error} When context is invalid
     * @throws {Error} When messages array is invalid
     * @throws {Error} When Google AI API streaming call fails
     */
    async *chatStream(model: string, context: Context, options?: any): AsyncGenerator<StreamingResponseChunk, void, unknown> {
        // Use base class validation
        this.validateContext(context);

        const { messages, systemPrompt } = context;

        try {
            // Convert UniversalMessage[] to Google AI format
            const { contents, systemInstruction } = GoogleConversationAdapter.processMessages(
                messages as UniversalMessage[],
                systemPrompt
            );

            // Configure tools if provided
            const toolConfig = this.configureTools(options?.tools);
            const modelConfig: any = {
                model: model || this.options.model || 'gemini-1.5-flash',
                systemInstruction: systemInstruction
            };

            // Add tools to model configuration if available
            if (toolConfig) {
                modelConfig.tools = toolConfig.tools;
            }

            // Get Google AI model instance
            const generativeModel = this.client.getGenerativeModel(modelConfig);

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
            this.handleApiError(error, 'chatStream');
        }
    }

    /**
     * Configure tools for Google AI API request
     * 
     * Google AI supports function calling with Gemini models.
     * Transforms function schemas into Google AI tool format.
     * 
     * @param tools - Array of function schemas
     * @returns Google AI tool configuration object or undefined
     */
    protected configureTools(tools?: FunctionSchema[]): { tools: any[] } | undefined {
        if (!tools || !Array.isArray(tools)) {
            return undefined;
        }

        return {
            tools: [{
                functionDeclarations: tools.map(fn => ({
                    name: fn.name,
                    description: fn.description || '',
                    parameters: fn.parameters
                }))
            }]
        };
    }

    /**
     * Parse Google AI response into universal ModelResponse format
     * 
     * Extracts content, usage information, and metadata from the Google AI response
     * and converts it to the standard format used across all providers.
     * Supports function calling with Gemini models.
     * 
     * @param response - Raw response from Google AI API
     * @returns Parsed model response in universal format
     * 
     * @internal
     */
    parseResponse(response: any): ModelResponse {
        let content = '';
        const toolCalls: any[] = [];

        // Extract content and function calls from response
        const candidate = response.response?.candidates?.[0];
        if (candidate?.content?.parts) {
            for (const part of candidate.content.parts) {
                if (part.text) {
                    content += part.text;
                } else if (part.functionCall) {
                    // Convert Google AI function call to OpenAI format for consistency
                    toolCalls.push({
                        id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        type: 'function' as const,
                        function: {
                            name: part.functionCall.name,
                            arguments: JSON.stringify(part.functionCall.args || {})
                        }
                    });
                }
            }
        }

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

        const result: ModelResponse = {
            content: content || undefined,
            usage,
            metadata: {
                model: response.response?.model,
                finishReason: candidate?.finishReason,
                safetyRatings: candidate?.safetyRatings
            }
        };

        // Add tool calls if present
        if (toolCalls.length > 0) {
            result.toolCalls = toolCalls;
        }

        return result;
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