import { GoogleGenerativeAI } from '@google/generative-ai';
import type { GoogleProviderOptions } from './types';
import { BaseAIProvider } from '@robota-sdk/agents';
import type {
    UniversalMessage,
    ChatOptions,
    ToolCall,
    ToolSchema,
    AssistantMessage
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
export class GoogleProvider extends BaseAIProvider {
    override readonly name = 'google';
    override readonly version = '1.0.0';

    private readonly client: GoogleGenerativeAI;
    private readonly options: GoogleProviderOptions;

    constructor(options: GoogleProviderOptions) {
        super();
        this.options = options;
        this.client = new GoogleGenerativeAI(options.apiKey);
    }

    /**
     * Generate response using UniversalMessage
     */
    override async chat(messages: UniversalMessage[], options?: ChatOptions): Promise<UniversalMessage> {
        this.validateMessages(messages);

        const model = this.client.getGenerativeModel({
            model: this.options.model || 'gemini-1.5-flash'
        });

        const geminiMessages = this.convertToGeminiFormat(messages);

        const result = await model.generateContent({
            contents: geminiMessages,
            generationConfig: {
                temperature: options?.temperature,
                maxOutputTokens: options?.maxTokens
            },
            ...(options?.tools && {
                tools: [{
                    functionDeclarations: this.convertToolsToGeminiFormat(options.tools)
                }]
            })
        });

        return this.convertFromGeminiResponse(result.response);
    }

    /**
     * Generate streaming response using UniversalMessage
     */
    override async *chatStream(messages: UniversalMessage[], options?: ChatOptions): AsyncIterable<UniversalMessage> {
        this.validateMessages(messages);

        const model = this.client.getGenerativeModel({
            model: this.options.model || 'gemini-1.5-flash'
        });

        const geminiMessages = this.convertToGeminiFormat(messages);

        const result = await model.generateContentStream({
            contents: geminiMessages,
            generationConfig: {
                temperature: options?.temperature,
                maxOutputTokens: options?.maxTokens
            },
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
     * Convert UniversalMessage to Gemini format
     * 
     * IMPORTANT: Google Gemini allows content with function calls
     * - Content can be empty string or text, but NOT null
     */
    private convertToGeminiFormat(messages: UniversalMessage[]): any[] {
        return messages.map(msg => {
            if (msg.role === 'user') {
                return {
                    role: 'user',
                    parts: [{ text: msg.content || '' }]
                };
            } else if (msg.role === 'assistant') {
                const assistantMsg = msg as AssistantMessage;
                const parts: any[] = [];

                // Google allows content with function calls
                if (assistantMsg.content) {
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
                    role: 'model',
                    parts
                };
            } else {
                // System messages
                return {
                    role: 'user',
                    parts: [{ text: `System: ${msg.content || ''}` }]
                };
            }
        });
    }

    /**
     * Convert Gemini response to UniversalMessage
     */
    private convertFromGeminiResponse(response: any): UniversalMessage {
        const candidate = response.candidates?.[0];
        if (!candidate) {
            throw new Error('No candidate in Gemini response');
        }

        const content = candidate.content;
        if (!content || !content.parts || content.parts.length === 0) {
            throw new Error('No content in Gemini response');
        }

        const textParts = content.parts.filter((p: any) => p.text).map((p: any) => p.text);
        const functionCalls = content.parts.filter((p: any) => p.functionCall);

        const result: UniversalMessage = {
            role: 'assistant',
            content: textParts.join('') || '',
            timestamp: new Date()
        };

        if (functionCalls.length > 0) {
            (result as AssistantMessage).toolCalls = functionCalls.map((fc: any) => ({
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
            (result as any).metadata = {
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
    private convertToolsToGeminiFormat(tools: ToolSchema[]): any[] {
        return tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
        }));
    }

    /**
     * Generate a unique ID
     */
    private generateId(): string {
        return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
} 