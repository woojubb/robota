import { GoogleGenerativeAI } from '@google/generative-ai';
import type {
    Content,
    Part,
    FunctionCall,
    FunctionDeclaration,
    EnhancedGenerateContentResponse
} from '@google/generative-ai';
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
    TUniversalMessagePart,
    IImageGenerationProvider,
    IImageGenerationRequest,
    IImageEditRequest,
    IImageComposeRequest,
    IImageGenerationResult,
    IMediaOutputRef,
    TProviderMediaResult
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
export class GoogleProvider extends AbstractAIProvider implements IImageGenerationProvider {
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
                contents: geminiMessages,
                generationConfig: this.buildGenerationConfig(messages, options),
                ...(options?.tools && {
                    tools: [{
                        functionDeclarations: this.convertToolsToGeminiFormat(options.tools)
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
                contents: geminiMessages,
                generationConfig: this.buildGenerationConfig(messages, options),
                ...(options?.tools && {
                    tools: [{
                        functionDeclarations: this.convertToolsToGeminiFormat(options.tools)
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

    public async generateImage(request: IImageGenerationRequest): Promise<TProviderMediaResult<IImageGenerationResult>> {
        if (request.prompt.trim().length === 0) {
            return {
                ok: false,
                error: {
                    code: 'PROVIDER_INVALID_REQUEST',
                    message: 'Image generation requires a non-empty prompt.'
                }
            };
        }
        if (request.model.trim().length === 0) {
            return {
                ok: false,
                error: {
                    code: 'PROVIDER_INVALID_REQUEST',
                    message: 'Image generation requires a non-empty model.'
                }
            };
        }

        const message: TUniversalMessage = {
            role: 'user',
            content: request.prompt,
            parts: [
                {
                    type: 'text',
                    text: request.prompt
                }
            ],
            timestamp: new Date()
        };
        return this.runImageRequest([message], request.model);
    }

    public async editImage(request: IImageEditRequest): Promise<TProviderMediaResult<IImageGenerationResult>> {
        if (request.prompt.trim().length === 0) {
            return {
                ok: false,
                error: {
                    code: 'PROVIDER_INVALID_REQUEST',
                    message: 'Image edit requires a non-empty prompt.'
                }
            };
        }
        if (request.model.trim().length === 0) {
            return {
                ok: false,
                error: {
                    code: 'PROVIDER_INVALID_REQUEST',
                    message: 'Image edit requires a non-empty model.'
                }
            };
        }

        const inputPartResult = this.mapImageInputSourceToPart(request.image);
        if (!inputPartResult.ok) {
            return inputPartResult;
        }

        const message: TUniversalMessage = {
            role: 'user',
            content: request.prompt,
            parts: [
                inputPartResult.value,
                {
                    type: 'text',
                    text: request.prompt
                }
            ],
            timestamp: new Date()
        };
        return this.runImageRequest([message], request.model);
    }

    public async composeImage(request: IImageComposeRequest): Promise<TProviderMediaResult<IImageGenerationResult>> {
        if (request.prompt.trim().length === 0) {
            return {
                ok: false,
                error: {
                    code: 'PROVIDER_INVALID_REQUEST',
                    message: 'Image compose requires a non-empty prompt.'
                }
            };
        }
        if (request.model.trim().length === 0) {
            return {
                ok: false,
                error: {
                    code: 'PROVIDER_INVALID_REQUEST',
                    message: 'Image compose requires a non-empty model.'
                }
            };
        }
        if (request.images.length < 2) {
            return {
                ok: false,
                error: {
                    code: 'PROVIDER_INVALID_REQUEST',
                    message: 'Image compose requires at least two input images.'
                }
            };
        }

        const messageParts: TUniversalMessagePart[] = [];
        for (const imageSource of request.images) {
            const mappedPartResult = this.mapImageInputSourceToPart(imageSource);
            if (!mappedPartResult.ok) {
                return mappedPartResult;
            }
            messageParts.push(mappedPartResult.value);
        }
        messageParts.push({
            type: 'text',
            text: request.prompt
        });

        const message: TUniversalMessage = {
            role: 'user',
            content: request.prompt,
            parts: messageParts,
            timestamp: new Date()
        };
        return this.runImageRequest([message], request.model);
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
    private convertToGeminiFormat(messages: TUniversalMessage[]): Content[] {
        return messages.map(msg => {
            if (msg.role === 'user') {
                return {
                    role: 'user',
                    parts: this.mapMessagePartsToGeminiParts(msg as IUserMessage)
                };
            } else if (msg.role === 'assistant') {
                const assistantMsg = msg as IAssistantMessage;
                const parts: Part[] = [];

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
                                args: JSON.parse(tc.function.arguments) as object
                            }
                        });
                    });
                }

                return {
                    role: 'model',
                    parts
                };
            } else if (msg.role === 'tool') {
                const toolMessage = msg as IToolMessage;
                return {
                    role: 'user',
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
                    role: 'user',
                    parts: systemParts
                };
            }
        });
    }

    /**
     * Convert Gemini response to TUniversalMessage
     */
    private convertFromGeminiResponse(response: EnhancedGenerateContentResponse): TUniversalMessage {
        const candidate = response.candidates?.[0];
        if (!candidate) {
            throw new Error('No candidate in Gemini response');
        }

        const content = candidate.content;
        if (!content || !content.parts || content.parts.length === 0) {
            throw new Error('No content in Gemini response');
        }

        const textValues: string[] = [];
        const messageParts: TUniversalMessagePart[] = [];
        const collectedFunctionCalls: FunctionCall[] = [];

        for (const p of content.parts) {
            if (typeof p.text === 'string') {
                textValues.push(p.text);
                messageParts.push({ type: 'text', text: p.text });
            }
            if (p.inlineData && typeof p.inlineData.data === 'string') {
                messageParts.push({
                    type: 'image_inline',
                    data: p.inlineData.data,
                    mimeType: p.inlineData.mimeType
                });
            }
            if (p.functionCall) {
                collectedFunctionCalls.push(p.functionCall);
            }
        }

        const result: TUniversalMessage = {
            role: 'assistant',
            content: textValues.length > 0 ? textValues.join('') : null,
            parts: messageParts,
            timestamp: new Date()
        };

        if (collectedFunctionCalls.length > 0) {
            const assistantResult = result as IAssistantMessage;
            assistantResult.toolCalls = collectedFunctionCalls.map((fc) => ({
                id: this.generateId(),
                type: 'function' as const,
                function: {
                    name: fc.name,
                    arguments: JSON.stringify(fc.args)
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
    private convertToolsToGeminiFormat(tools: IToolSchema[]): FunctionDeclaration[] {
        return tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            // IToolSchema.parameters follows JSON Schema structure compatible with FunctionDeclarationSchema
            parameters: tool.parameters as FunctionDeclaration['parameters']
        }));
    }

    /**
     * Generate a unique ID
     */
    private generateId(): string {
        return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private mapMessagePartsToGeminiParts(message: IUserMessage | IAssistantMessage | ISystemMessage | IToolMessage): Part[] {
        const parts: Part[] = [];
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

    private async runImageRequest(
        messages: TUniversalMessage[],
        model: string
    ): Promise<TProviderMediaResult<IImageGenerationResult>> {
        try {
            const response = await this.chat(messages, {
                model,
                google: {
                    responseModalities: ['TEXT', 'IMAGE']
                }
            });
            const outputs = this.mapInlineImagePartsToMediaOutputs(response.parts);
            if (outputs.length === 0) {
                return {
                    ok: false,
                    error: {
                        code: 'PROVIDER_UPSTREAM_ERROR',
                        message: 'Google image response did not include image output parts.'
                    }
                };
            }
            return {
                ok: true,
                value: {
                    outputs,
                    model
                }
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Google image request failed.';
            return {
                ok: false,
                error: {
                    code: 'PROVIDER_UPSTREAM_ERROR',
                    message: errorMessage
                }
            };
        }
    }

    private mapInlineImagePartsToMediaOutputs(parts: TUniversalMessagePart[] | undefined): IMediaOutputRef[] {
        if (!parts) {
            return [];
        }
        const outputs: IMediaOutputRef[] = [];
        for (const part of parts) {
            if (part.type !== 'image_inline') {
                continue;
            }
            outputs.push({
                kind: 'uri',
                uri: `data:${part.mimeType};base64,${part.data}`,
                mimeType: part.mimeType
            });
        }
        return outputs;
    }

    private mapImageInputSourceToPart(
        source: IImageEditRequest['image'] | IImageComposeRequest['images'][number]
    ): TProviderMediaResult<TUniversalMessagePart> {
        if (source.kind === 'inline') {
            if (source.mimeType.trim().length === 0 || source.data.trim().length === 0) {
                return {
                    ok: false,
                    error: {
                        code: 'PROVIDER_INVALID_REQUEST',
                        message: 'Inline image source requires non-empty mimeType and data.'
                    }
                };
            }
            return {
                ok: true,
                value: {
                    type: 'image_inline',
                    mimeType: source.mimeType,
                    data: source.data
                }
            };
        }
        if (!source.uri.startsWith('data:')) {
            return {
                ok: false,
                error: {
                    code: 'PROVIDER_INVALID_REQUEST',
                    message: 'Google image provider supports only inline or data URI input sources.'
                }
            };
        }
        const parsedDataUri = this.parseDataUri(source.uri);
        if (!parsedDataUri) {
            return {
                ok: false,
                error: {
                    code: 'PROVIDER_INVALID_REQUEST',
                    message: 'Data URI source must use base64 payload.'
                }
            };
        }
        return {
            ok: true,
            value: {
                type: 'image_inline',
                mimeType: parsedDataUri.mimeType,
                data: parsedDataUri.data
            }
        };
    }

    private parseDataUri(uri: string): { mimeType: string; data: string } | undefined {
        const commaIndex = uri.indexOf(',');
        if (commaIndex < 0) {
            return undefined;
        }
        const header = uri.slice(0, commaIndex);
        const payload = uri.slice(commaIndex + 1);
        if (!header.endsWith(';base64')) {
            return undefined;
        }
        const mimeType = header.replace('data:', '').replace(';base64', '').trim();
        if (mimeType.length === 0 || payload.trim().length === 0) {
            return undefined;
        }
        return {
            mimeType,
            data: payload
        };
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