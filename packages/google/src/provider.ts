import { GoogleGenerativeAI } from '@google/generative-ai';
import {
    BaseAIProvider,
    logger
} from '@robota-sdk/agents';
import type {
    Context,
    ModelResponse,
    StreamingResponseChunk,
    ToolSchema
} from '@robota-sdk/agents';
import type { UniversalMessage } from '@robota-sdk/agents/src/managers/conversation-history-manager';
import type { ProviderExecutionResult } from '@robota-sdk/agents/src/abstracts/base-ai-provider';
import type { GoogleProviderOptions } from './types';
import { GoogleConversationAdapter } from './adapter';

/**
 * Google AI provider implementation for Robota
 * 
 * Provides integration with Google's Generative AI services including Gemini models.
 * Extends BaseAIProvider for common functionality and tool calling support.
 * 
 * @see {@link @examples/03-integrations | Provider Integration Examples}
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
     * Available models
     * @readonly
     */
    public readonly models: string[] = [
        'gemini-1.5-pro',
        'gemini-1.5-flash',
        'gemini-pro',
        'gemini-pro-vision'
    ];

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
            // Set default values for parallel tool call options
            enableParallelToolCalls: true,
            maxConcurrentToolCalls: 3,
            toolCallDelayMs: 100,
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

        const { messages, systemMessage } = context;

        try {
            // Convert UniversalMessage[] to Google AI format
            const { contents, systemInstruction } = this.processGoogleMessages(
                messages as UniversalMessage[],
                systemMessage
            );

            // Configure tools if provided
            const toolConfig = this.configureTools(context.tools);
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
     * Generate streaming response using raw request payload (for agents package compatibility)
     * 
     * This method is required by the agents package's ConversationService for streaming.
     * It adapts the raw request payload to the Google AI streaming API format.
     * 
     * @param request - Raw request payload from ConversationService
     * @returns AsyncGenerator yielding streaming response chunks
     */
    override async *generateStreamingResponse(request: any): AsyncGenerator<any, void, unknown> {
        try {
            // Extract parameters from request payload
            const model = request.model;
            const messages = request.messages || [];
            const temperature = request.temperature;
            const maxTokens = request.max_tokens;
            const tools = request.tools;
            const systemMessage = request.system;

            // Convert to Google format
            const { contents, systemInstruction } = this.processGoogleMessages(messages, systemMessage);

            // Configure tools if provided
            const toolConfig = this.configureTools(tools);
            const modelConfig: any = {
                model: model || 'gemini-1.5-flash',
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
                temperature,
                maxOutputTokens: maxTokens
            };

            // Generate streaming content
            const result = await generativeModel.generateContentStream({
                contents,
                generationConfig
            });

            // Yield each chunk
            for await (const chunk of result.stream) {
                yield this.parseStreamingChunk(chunk);
            }
        } catch (error) {
            this.handleApiError(error, 'generateStreamingResponse');
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

        const { messages, systemMessage } = context;

        try {
            // Convert UniversalMessage[] to Google AI format
            const { contents, systemInstruction } = this.processGoogleMessages(
                messages as UniversalMessage[],
                systemMessage
            );

            // Configure tools if provided
            const toolConfig = this.configureTools(context.tools);
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
     * Convert UniversalMessage[] to Google AI-specific message format
     * 
     * @param messages - Array of UniversalMessage to convert
     * @returns Google AI-formatted messages and system instruction
     */
    protected convertMessages(messages: UniversalMessage[]): any[] {
        // For base class compatibility, just return the messages
        // Actual processing is done in Google-specific methods
        return messages as any[];
    }

    /**
     * Process messages with Google AI-specific format
     * 
     * @param messages - Array of UniversalMessage to process
     * @param systemMessage - Optional system message
     * @returns Google AI-formatted messages and system instruction
     */
    private processGoogleMessages(messages: UniversalMessage[], systemMessage?: string): { contents: any[], systemInstruction?: string } {
        return GoogleConversationAdapter.processMessages(messages, systemMessage);
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
    protected configureTools(tools?: ToolSchema[]): { tools: any[] } | undefined {
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

    /**
     * Process Google provider response into standardized format
     * 
     * Overrides the base implementation to use Google-specific parsing logic.
     * 
     * @param response - Raw response from Google chat method
     * @returns Standardized ProviderExecutionResult
     */
    protected processResponse(response: ModelResponse): ProviderExecutionResult {
        return {
            content: response.content || '',
            toolCalls: response.toolCalls,
            usage: response.usage,
            finishReason: response.metadata?.finishReason,
            metadata: response.metadata
        };
    }
} 