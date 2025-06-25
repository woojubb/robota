import { GoogleGenerativeAI } from '@google/generative-ai';
import type { GenerateContentResult, GenerateContentStreamResult } from '@google/generative-ai';
import { BaseAIProvider } from '@robota-sdk/agents';
import type { UniversalMessage, UniversalAssistantMessage, ToolSchema, ChatOptions } from '@robota-sdk/agents';
import type { GoogleProviderOptions } from './types';

/**
 * Google AI provider implementation for Robota
 * 
 * Provides integration with Google's Generative AI services using provider-agnostic UniversalMessage.
 * Uses Google SDK native types internally for optimal performance and feature support.
 * 
 * @public
 */
export class GoogleProvider extends BaseAIProvider {
    readonly name = 'google';
    readonly version = '1.0.0';

    private readonly client: GoogleGenerativeAI;
    private readonly options: GoogleProviderOptions;

    constructor(options: GoogleProviderOptions) {
        super();
        this.options = options;
        this.client = options.client;

        if (!this.client) {
            throw new Error('Google AI client is required');
        }
    }

    /**
     * Generate response using UniversalMessage
     */
    async chat(messages: UniversalMessage[], options?: ChatOptions): Promise<UniversalMessage> {
        this.validateMessages(messages);

        try {
            // 1. Convert UniversalMessage → Google format
            const { contents, systemInstruction } = this.convertToGoogleMessages(messages);

            // 2. Configure Google AI model
            const modelConfig: any = {
                model: options?.model || 'gemini-1.5-flash',
                ...(systemInstruction && { systemInstruction })
            };

            // Add tools if provided
            if (options?.tools && options.tools.length > 0) {
                modelConfig.tools = this.convertToGoogleTools(options.tools);
            }

            const model = this.client.getGenerativeModel(modelConfig);

            // 3. Call Google AI API (native SDK types)
            const generationConfig = {
                temperature: options?.temperature,
                maxOutputTokens: options?.maxTokens
            };

            const result: GenerateContentResult = await model.generateContent({
                contents,
                generationConfig
            });

            // 4. Convert Google response → UniversalMessage
            return this.convertFromGoogleResponse(result);

        } catch (error: any) {
            throw new Error(`Google AI chat failed: ${error.message}`);
        }
    }

    /**
     * Generate streaming response using UniversalMessage
     */
    async *chatStream(messages: UniversalMessage[], options?: ChatOptions): AsyncIterable<UniversalMessage> {
        this.validateMessages(messages);

        try {
            // 1. Convert UniversalMessage → Google format
            const { contents, systemInstruction } = this.convertToGoogleMessages(messages);

            // 2. Configure Google AI model
            const modelConfig: any = {
                model: options?.model || 'gemini-1.5-flash',
                ...(systemInstruction && { systemInstruction })
            };

            // Add tools if provided
            if (options?.tools && options.tools.length > 0) {
                modelConfig.tools = this.convertToGoogleTools(options.tools);
            }

            const model = this.client.getGenerativeModel(modelConfig);

            // 3. Call Google AI streaming API
            const generationConfig = {
                temperature: options?.temperature,
                maxOutputTokens: options?.maxTokens
            };

            const result: GenerateContentStreamResult = await model.generateContentStream({
                contents,
                generationConfig
            });

            // 4. Stream conversion: Google chunks → UniversalMessage
            for await (const chunk of result.stream) {
                const universalMessage = this.convertFromGoogleChunk(chunk);
                if (universalMessage) {
                    yield universalMessage;
                }
            }

        } catch (error: any) {
            throw new Error(`Google AI stream failed: ${error.message}`);
        }
    }

    override supportsTools(): boolean {
        return true;
    }

    override validateConfig(): boolean {
        return !!this.client && !!this.options;
    }

    override async dispose(): Promise<void> {
        // Google AI client doesn't need explicit cleanup
    }

    /**
     * Convert UniversalMessage array to Google format
     */
    private convertToGoogleMessages(messages: UniversalMessage[]): { contents: any[], systemInstruction?: string } {
        const systemMessage = messages.find(msg => msg.role === 'system');
        const nonSystemMessages = messages.filter(msg => msg.role !== 'system');

        const contents = nonSystemMessages.map(msg => {
            switch (msg.role) {
                case 'user':
                    return {
                        role: 'user',
                        parts: [{ text: msg.content || '' }]
                    };
                case 'assistant':
                    const assistantMsg = msg as UniversalAssistantMessage;
                    const parts: any[] = [];

                    if (assistantMsg.content) {
                        parts.push({ text: assistantMsg.content });
                    }

                    // Handle tool calls (Google uses function calls)
                    if (assistantMsg.toolCalls) {
                        for (const toolCall of assistantMsg.toolCalls) {
                            parts.push({
                                functionCall: {
                                    name: toolCall.function.name,
                                    args: JSON.parse(toolCall.function.arguments || '{}')
                                }
                            });
                        }
                    }

                    return {
                        role: 'model',
                        parts
                    };
                case 'tool':
                    return {
                        role: 'function',
                        parts: [{
                            functionResponse: {
                                name: (msg as any).name || 'unknown',
                                response: JSON.parse(msg.content || '{}')
                            }
                        }]
                    };
                default:
                    throw new Error(`Unsupported message role: ${(msg as any).role}`);
            }
        });

        return {
            contents,
            systemInstruction: systemMessage?.content || undefined
        };
    }

    /**
     * Convert tool schemas to Google format
     */
    private convertToGoogleTools(tools: ToolSchema[]): any[] {
        return tools.map(tool => ({
            functionDeclarations: [{
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
            }]
        }));
    }

    /**
     * Convert Google response to UniversalMessage
     */
    private convertFromGoogleResponse(result: GenerateContentResult): UniversalMessage {
        const response = result.response;
        const candidate = response.candidates?.[0];

        if (!candidate) {
            throw new Error('No candidate in Google AI response');
        }

        let content = '';
        const toolCalls: any[] = [];

        // Process parts from the candidate
        for (const part of candidate.content?.parts || []) {
            if (part.text) {
                content += part.text;
            } else if (part.functionCall) {
                toolCalls.push({
                    id: `call_${Math.random().toString(36).substr(2, 9)}`,
                    type: 'function' as const,
                    function: {
                        name: part.functionCall.name,
                        arguments: JSON.stringify(part.functionCall.args || {})
                    }
                });
            }
        }

        return {
            role: 'assistant',
            content: content || null,
            timestamp: new Date(),
            ...(toolCalls.length > 0 && { toolCalls })
        };
    }

    /**
     * Convert Google streaming chunk to UniversalMessage
     */
    private convertFromGoogleChunk(chunk: any): UniversalMessage | null {
        const candidate = chunk.candidates?.[0];

        if (!candidate) {
            return null;
        }

        let content = '';
        const toolCalls: any[] = [];

        // Process parts from the candidate
        for (const part of candidate.content?.parts || []) {
            if (part.text) {
                content += part.text;
            } else if (part.functionCall) {
                toolCalls.push({
                    id: `call_${Math.random().toString(36).substr(2, 9)}`,
                    type: 'function' as const,
                    function: {
                        name: part.functionCall.name,
                        arguments: JSON.stringify(part.functionCall.args || {})
                    }
                });
            }
        }

        return {
            role: 'assistant',
            content: content || null,
            timestamp: new Date(),
            ...(toolCalls.length > 0 && { toolCalls })
        };
    }

    /**
     * Validate UniversalMessage array
     */
    protected override validateMessages(messages: UniversalMessage[]): void {
        if (!Array.isArray(messages)) {
            throw new Error('Messages must be an array');
        }

        if (messages.length === 0) {
            throw new Error('Messages array cannot be empty');
        }

        for (const message of messages) {
            if (!message.role || !['user', 'assistant', 'system', 'tool'].includes(message.role)) {
                throw new Error(`Invalid message role: ${message.role}`);
            }
        }
    }
} 