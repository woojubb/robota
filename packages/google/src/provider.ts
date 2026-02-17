import { GoogleGenerativeAI } from '@google/generative-ai';
import type { IGoogleProviderOptions } from './types';
import { AbstractAIProvider } from '@robota-sdk/agents';
import type {
    TUniversalMessage,
    IChatOptions,
    IToolSchema,
    IAssistantMessage,
    IUserMessage,
    ISystemMessage,
    IToolMessage,
    TUniversalMessagePart
} from '@robota-sdk/agents';



/**
 * Google Gemini provider implementation for Robota
 * 
 * IMPORTANT PROVIDER-SPECIFIC RULES:
 * 1. This provider MUST extend BaseAIProvider from @robota-sdk/agents
 * 2. Content handling for Google Gemini API:
 *    - Function calls can have content (text) along with function calls
 *    - Content can be empty string or actual text, NOT null
 * 3. Use override keyword for all methods inherited from BaseAIProvider
 * 4. Provider-specific API behavior should be documented here
 * 
 * @public
 */
export class GoogleProvider extends AbstractAIProvider {
    override readonly name = 'google';
    override readonly version = '1.0.0';

    private readonly client?: GoogleGenerativeAI;
    private readonly options: IGoogleProviderOptions;

    constructor(options: IGoogleProviderOptions) {
        super();
        this.options = options;

        // Set executor if provided
        if (options.executor) {
            this.executor = options.executor;
        }

        // Only create client if not using executor
        if (!this.executor) {
            this.client = new GoogleGenerativeAI(options.apiKey);
        }
    }

    /**
     * Generate response using TUniversalMessage
     */
    override async chat(messages: TUniversalMessage[], options?: IChatOptions): Promise<TUniversalMessage> {
        this.validateMessages(messages);

        // Use executor when configured; otherwise use direct execution
        if (this.executor) {
            try {
                return await this.executeViaExecutorOrDirect(messages, options);
            } catch (error) {
                this.logger.error('Google Provider executor chat error:', error instanceof Error ? error.message : String(error));
                throw error;
            }
        }

        try {
            // Direct execution with Google client
            if (!this.client) {
                throw new Error('Google client not available. Either provide apiKey or use an executor.');
            }

            if (!options?.model) {
                throw new Error('Model is required in IChatOptions. Please specify a model in defaultModel configuration.');
            }

            const model = this.client.getGenerativeModel({
                model: options.model as string
            });

            const geminiMessages = this.convertToGeminiFormat(messages);

            const result = await model.generateContent({
                contents: geminiMessages as any, // Google SDK types are complex, using any here
                generationConfig: this.buildGenerationConfig(messages, options),
                ...(options?.tools && {
                    tools: [{
                        functionDeclarations: this.convertToolsToGeminiFormat(options.tools) as any
                    }]
                })
            });

            const convertedResponse = this.convertFromGeminiResponse(result.response);
            const responseModalities = this.buildResponseModalities(messages, options);
            if (
                responseModalities.includes('IMAGE')
                && !this.hasImagePart(convertedResponse.parts)
            ) {
                throw new Error('Gemini response did not include an image part while IMAGE modality was requested.');
            }
            return convertedResponse;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Google API request failed';
            throw new Error(`Google chat failed: ${errorMessage}`);
        }
    }

    /**
     * Generate streaming response using TUniversalMessage
     */
    override async *chatStream(messages: TUniversalMessage[], options?: IChatOptions): AsyncIterable<TUniversalMessage> {
        this.validateMessages(messages);
        // Use executor when configured; otherwise use direct execution
        if (this.executor) {
            try {
                yield* this.executeStreamViaExecutorOrDirect(messages, options);
                return;
            } catch (error) {
                this.logger.error('Google Provider executor stream error:', error instanceof Error ? error.message : String(error));
                throw error;
            }
        }

        try {
            const responseModalities = this.buildResponseModalities(messages, options);
            if (responseModalities.includes('IMAGE')) {
                throw new Error('Google provider does not support streaming image modality responses.');
            }

            // Direct execution with Google client
            if (!this.client) {
                throw new Error('Google client not available. Either provide apiKey or use an executor.');
            }

            if (!options?.model) {
                throw new Error('Model is required in IChatOptions. Please specify a model in defaultModel configuration.');
            }

            const model = this.client.getGenerativeModel({
                model: options.model as string
            });

            const geminiMessages = this.convertToGeminiFormat(messages);

            const result = await model.generateContentStream({
                contents: geminiMessages as any, // Google SDK types are complex, using any here
                generationConfig: this.buildGenerationConfig(messages, options),
                ...(options?.tools && {
                    tools: [{
                        functionDeclarations: this.convertToolsToGeminiFormat(options.tools) as any
                    }]
                })
            });

            for await (const chunk of result.stream) {
                const text = chunk.text();
                if (text) {
                    yield {
                        role: 'assistant',
                        content: text,
                        timestamp: new Date()
                    };
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Google API request failed';
            throw new Error(`Google stream failed: ${errorMessage}`);
        }
    }

    override supportsTools(): boolean {
        return true;
    }

    override validateConfig(): boolean {
        return !!this.client && !!this.options && !!this.options.apiKey;
    }

    override async dispose(): Promise<void> {
        // Google client doesn't need explicit cleanup
    }

    /**
     * Convert TUniversalMessage to Gemini format
     * 
     * IMPORTANT: Google Gemini allows content with function calls
     * - Content can be empty string or text, but NOT null
     */
    private convertToGeminiFormat(messages: TUniversalMessage[]): Array<{
        role: 'user' | 'model';
        parts: Array<{
            text?: string;
            inlineData?: {
                mimeType: string;
                data: string;
            };
            functionCall?: {
                name: string;
                args: Record<string, any>;
            };
        }>;
    }> {
        return messages.map(msg => {
            if (msg.role === 'user') {
                return {
                    role: 'user' as const,
                    parts: this.mapMessagePartsToGeminiParts(msg as IUserMessage)
                };
            } else if (msg.role === 'assistant') {
                const assistantMsg = msg as IAssistantMessage;
                const parts: Array<{
                    text?: string;
                    inlineData?: {
                        mimeType: string;
                        data: string;
                    };
                    functionCall?: {
                        name: string;
                        args: Record<string, any>;
                    };
                }> = [];

                // Google allows content with function calls
                const mappedAssistantParts = this.mapMessagePartsToGeminiParts(assistantMsg);
                for (const mappedPart of mappedAssistantParts) {
                    parts.push(mappedPart);
                }
                if (parts.length === 0 && assistantMsg.content) {
                    parts.push({ text: assistantMsg.content });
                }

                if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
                    assistantMsg.toolCalls.forEach(tc => {
                        parts.push({
                            functionCall: {
                                name: tc.function.name,
                                args: JSON.parse(tc.function.arguments)
                            }
                        });
                    });
                }

                return {
                    role: 'model' as const,
                    parts
                };
            } else if (msg.role === 'tool') {
                const toolMessage = msg as IToolMessage;
                return {
                    role: 'user' as const,
                    parts: this.mapMessagePartsToGeminiParts(toolMessage)
                };
            } else {
                // System messages
                const systemMessage = msg as ISystemMessage;
                const systemParts = this.mapMessagePartsToGeminiParts(systemMessage);
                if (systemParts.length === 0) {
                    systemParts.push({ text: `System: ${systemMessage.content || ''}` });
                }
                return {
                    role: 'user' as const,
                    parts: systemParts
                };
            }
        });
    }

    /**
     * Convert Gemini response to TUniversalMessage
     */
    private convertFromGeminiResponse(response: any): TUniversalMessage {
        const candidate = response.candidates?.[0];
        if (!candidate) {
            throw new Error('No candidate in Gemini response');
        }

        const content = candidate.content;
        if (!content || !content.parts || content.parts.length === 0) {
            throw new Error('No content in Gemini response');
        }

        const textParts = content.parts.filter((p: any) => typeof p.text === 'string').map((p: any) => p.text);
        const imageParts = content.parts.filter((p: any) =>
            (p.inlineData && typeof p.inlineData.data === 'string' && typeof p.inlineData.mimeType === 'string')
            || (p.inline_data && typeof p.inline_data.data === 'string' && typeof p.inline_data.mime_type === 'string')
        );
        const functionCalls = content.parts.filter((p: any) => p.functionCall);

        const messageParts: TUniversalMessagePart[] = [];
        for (const textPart of textParts) {
            messageParts.push({
                type: 'text',
                text: textPart
            });
        }
        for (const imagePart of imageParts) {
            const inlineData = imagePart.inlineData
                ?? {
                    data: imagePart.inline_data.data,
                    mimeType: imagePart.inline_data.mime_type
                };
            messageParts.push({
                type: 'image_inline',
                data: inlineData.data,
                mimeType: inlineData.mimeType
            });
        }

        const result: TUniversalMessage = {
            role: 'assistant',
            content: textParts.length > 0 ? textParts.join('') : null,
            parts: messageParts,
            timestamp: new Date()
        };

        if (functionCalls.length > 0) {
            const assistantResult = result as IAssistantMessage;
            assistantResult.toolCalls = functionCalls.map((fc: any) => ({
                id: this.generateId(),
                type: 'function' as const,
                function: {
                    name: fc.functionCall.name,
                    arguments: JSON.stringify(fc.functionCall.args)
                }
            }));
        }

        // Add metadata if available
        if (response.usageMetadata) {
            result.metadata = {
                promptTokens: response.usageMetadata.promptTokenCount,
                completionTokens: response.usageMetadata.candidatesTokenCount,
                totalTokens: response.usageMetadata.totalTokenCount
            };
        }

        return result;
    }

    /**
     * Convert tools to Gemini format
     */
    private convertToolsToGeminiFormat(tools: IToolSchema[]): Array<{
        name: string;
        description: string;
        parameters: Record<string, any>;
    }> {
        return tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters as Record<string, any>
        }));
    }

    /**
     * Generate a unique ID
     */
    private generateId(): string {
        return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private mapMessagePartsToGeminiParts(message: IUserMessage | IAssistantMessage | ISystemMessage | IToolMessage): Array<{
        text?: string;
        inlineData?: {
            mimeType: string;
            data: string;
        };
    }> {
        const parts: Array<{
            text?: string;
            inlineData?: {
                mimeType: string;
                data: string;
            };
        }> = [];
        const messageParts = message.parts ?? [];
        for (const part of messageParts) {
            if (part.type === 'text') {
                parts.push({ text: part.text });
                continue;
            }
            if (part.type === 'image_inline') {
                parts.push({
                    inlineData: {
                        mimeType: part.mimeType,
                        data: part.data
                    }
                });
                continue;
            }
            throw new Error(`Google provider does not support image URI parts directly: ${part.uri}`);
        }
        if (parts.length === 0 && typeof message.content === 'string' && message.content.length > 0) {
            parts.push({ text: message.content });
        }
        return parts;
    }

    private hasImagePart(parts: TUniversalMessagePart[] | undefined): boolean {
        if (!parts) {
            return false;
        }
        return parts.some((part) => part.type === 'image_inline' || part.type === 'image_uri');
    }

    private buildResponseModalities(messages: TUniversalMessage[], options?: IChatOptions): Array<'TEXT' | 'IMAGE'> {
        const optionModalities = options?.google?.responseModalities;
        if (optionModalities && optionModalities.length > 0) {
            return optionModalities;
        }
        const hasImageInput = messages.some((message) => this.hasImagePart(message.parts));
        if (hasImageInput) {
            return ['TEXT', 'IMAGE'];
        }
        const defaultModalities = this.options.defaultResponseModalities;
        if (defaultModalities && defaultModalities.length > 0) {
            return defaultModalities;
        }
        return ['TEXT'];
    }

    private isImageCapableModel(model: string): boolean {
        const configuredImageModels = this.options.imageCapableModels;
        if (configuredImageModels && configuredImageModels.length > 0) {
            return configuredImageModels.includes(model);
        }
        return model.includes('image');
    }

    private buildGenerationConfig(messages: TUniversalMessage[], options?: IChatOptions): {
        temperature?: number;
        maxOutputTokens?: number;
        responseModalities?: Array<'TEXT' | 'IMAGE'>;
    } {
        const responseModalities = this.buildResponseModalities(messages, options);
        if (!options?.model) {
            return {
                temperature: options?.temperature,
                maxOutputTokens: options?.maxTokens,
                responseModalities
            };
        }
        if (
            responseModalities.includes('IMAGE')
            && !this.isImageCapableModel(options.model)
        ) {
            throw new Error(
                `Selected model "${options.model}" is not configured as image-capable for Google provider.`
            );
        }
        return {
            temperature: options?.temperature,
            maxOutputTokens: options?.maxTokens,
            responseModalities
        };
    }
} 