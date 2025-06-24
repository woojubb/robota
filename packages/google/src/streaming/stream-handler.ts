import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '@robota-sdk/agents';
import type { StreamingResponseChunk } from '@robota-sdk/agents';

/**
 * Google streaming response handler
 * 
 * Handles streaming chat completions from Google Generative AI API.
 * Extracts streaming logic from the main provider for better modularity.
 */
export class GoogleStreamHandler {
    constructor(
        private readonly client: GoogleGenerativeAI
    ) { }

    /**
     * Handle streaming response for Google Generative AI
     * 
     * @param modelConfig - Google AI model configuration
     * @param requestParams - Google AI API request parameters
     * @returns AsyncGenerator yielding streaming response chunks
     */
    async *handleStream(modelConfig: any, requestParams: any): AsyncGenerator<StreamingResponseChunk, void, unknown> {
        try {
            // Get Google AI model instance
            const generativeModel = this.client.getGenerativeModel(modelConfig);

            // Generate streaming content
            const stream = await generativeModel.generateContentStream(requestParams);

            // Process each chunk in the stream
            for await (const chunk of stream.stream) {
                const parsedChunk = this.parseStreamingChunk(chunk);
                if (parsedChunk) {
                    yield parsedChunk;
                }
            }
        } catch (error) {
            logger.error('Google streaming error:', error as Record<string, any>);
            throw error;
        }
    }

    /**
     * Generate streaming response using raw request payload (for agents package compatibility)
     * 
     * @param request - Raw request payload from ConversationService
     * @returns AsyncGenerator yielding streaming response chunks
     */
    async *generateStreamingResponse(request: any): AsyncGenerator<any, void, unknown> {
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
            const toolConfig = tools && Array.isArray(tools) && tools.length > 0 ? { tools: [{ functionDeclarations: tools }] } : undefined;

            const modelConfig: any = {
                model: model || 'gemini-1.5-flash',
                systemInstruction: systemInstruction
            };

            // Add tools to model configuration if available
            if (toolConfig) {
                modelConfig.tools = toolConfig.tools;
            }

            // Configure generation parameters
            const requestParams = {
                contents,
                generationConfig: {
                    temperature,
                    maxOutputTokens: maxTokens
                }
            };

            // Use existing stream handler
            yield* this.handleStream(modelConfig, requestParams);
        } catch (error) {
            logger.error('Google generateStreamingResponse error:', error as Record<string, any>);
            throw error;
        }
    }

    /**
     * Process messages into Google AI format
     * 
     * @param messages - Array of universal messages
     * @param systemMessage - Optional system message
     * @returns Processed contents and system instruction
     */
    private processGoogleMessages(messages: any[], systemMessage?: string): { contents: any[], systemInstruction?: string } {
        const contents = messages.map((msg: any) => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
        }));

        return {
            contents,
            systemInstruction: systemMessage
        };
    }

    /**
     * Parse individual streaming chunk from Google
     * 
     * @param chunk - Raw streaming chunk from Google AI API
     * @returns Parsed streaming response chunk or null if no content
     */
    private parseStreamingChunk(chunk: any): StreamingResponseChunk | null {
        try {
            const candidate = chunk.candidates?.[0];
            if (!candidate) {
                return null;
            }

            const content = candidate.content?.parts?.[0]?.text || '';
            const finishReason = candidate.finishReason;

            // Handle function calls
            if (candidate.content?.parts?.[0]?.functionCall) {
                const functionCall = candidate.content.parts[0].functionCall;
                return {
                    content: '',
                    toolCall: {
                        id: `call_${Date.now()}`, // Google doesn't provide IDs, generate one
                        type: 'function' as const,
                        function: {
                            name: functionCall.name || '',
                            arguments: JSON.stringify(functionCall.args || {})
                        }
                    },
                    isComplete: finishReason === 'STOP'
                };
            }

            // Handle regular content
            return {
                content,
                isComplete: finishReason === 'STOP'
            };
        } catch (error) {
            logger.error('Error parsing Google streaming chunk:', error as Record<string, any>);
            return null;
        }
    }
} 