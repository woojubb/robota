import OpenAI from 'openai';
import type { OpenAIProviderOptions } from './types';
import type {
    OpenAIError
} from './types/api-types';

/**
 * Universal message interface for provider-agnostic communication
 */
export interface UniversalMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | null;
    timestamp?: Date;
    toolCalls?: ToolCall[];
    toolCallId?: string;
    name?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Tool call interface
 */
export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

/**
 * Tool schema interface
 */
export interface ToolSchema {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

/**
 * Chat options interface
 */
export interface ChatOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: ToolSchema[];
}

/**
 * AI Provider interface
 */
export interface AIProvider {
    readonly name: string;
    readonly version: string;

    chat(messages: UniversalMessage[], options?: ChatOptions): Promise<UniversalMessage>;
    chatStream(messages: UniversalMessage[], options?: ChatOptions): AsyncIterable<UniversalMessage>;
    supportsTools(): boolean;
    validateConfig(): boolean;
    dispose(): Promise<void>;
}

/**
 * OpenAI provider implementation for Robota
 * 
 * Provides integration with OpenAI's GPT models using provider-agnostic UniversalMessage.
 * Uses OpenAI SDK native types internally for optimal performance and feature support.
 * 
 * @public
 */
export class OpenAIProvider implements AIProvider {
    readonly name = 'openai';
    readonly version = '1.0.0';

    private readonly client: OpenAI;
    private readonly options: OpenAIProviderOptions;

    constructor(options: OpenAIProviderOptions) {
        this.options = {
            temperature: 0.7,
            ...options
        };

        if (!options.client) {
            throw new Error('OpenAI client is required');
        }

        this.client = options.client;
    }

    /**
     * Generate response using UniversalMessage
     */
    async chat(messages: UniversalMessage[], options?: ChatOptions): Promise<UniversalMessage> {
        this.validateMessages(messages);

        try {
            // 1. Convert UniversalMessage → OpenAI format
            const openaiMessages = this.convertToOpenAIMessages(messages);

            // 2. Call OpenAI API (native SDK types)
            const requestParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
                model: options?.model || 'gpt-4',
                messages: openaiMessages,
                ...(options?.temperature !== undefined && { temperature: options.temperature }),
                ...(options?.maxTokens && { max_tokens: options.maxTokens }),
                ...(options?.tools && {
                    tools: this.convertToOpenAITools(options.tools),
                    tool_choice: 'auto'
                })
            };

            const response = await this.client.chat.completions.create(requestParams);

            // 3. Convert OpenAI response → UniversalMessage  
            return this.convertFromOpenAIResponse(response);

        } catch (error) {
            const openaiError = error as OpenAIError;
            throw new Error(`OpenAI chat failed: ${openaiError.message || 'Unknown error'}`);
        }
    }

    /**
         * Generate streaming response using UniversalMessage
         */
    async *chatStream(messages: UniversalMessage[], options?: ChatOptions): AsyncIterable<UniversalMessage> {
        this.validateMessages(messages);

        try {
            // 1. Convert UniversalMessage → OpenAI format
            const openaiMessages = this.convertToOpenAIMessages(messages);

            // 2. Call OpenAI streaming API
            const requestParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
                model: options?.model || 'gpt-4',
                messages: openaiMessages,
                stream: true,
                ...(options?.temperature !== undefined && { temperature: options.temperature }),
                ...(options?.maxTokens && { max_tokens: options.maxTokens }),
                ...(options?.tools && {
                    tools: this.convertToOpenAITools(options.tools),
                    tool_choice: 'auto'
                })
            };

            const stream = await this.client.chat.completions.create(requestParams);

            // 3. Stream conversion: OpenAI chunks → UniversalMessage
            for await (const chunk of stream) {
                const universalMessage = this.convertFromOpenAIChunk(chunk);
                if (universalMessage) {
                    yield universalMessage;
                }
            }

        } catch (error) {
            const openaiError = error as OpenAIError;
            throw new Error(`OpenAI stream failed: ${openaiError.message || 'Unknown error'}`);
        }
    }

    supportsTools(): boolean {
        return true;
    }

    validateConfig(): boolean {
        return !!this.client && !!this.options;
    }

    async dispose(): Promise<void> {
        // OpenAI client doesn't need explicit cleanup
    }

    /**
     * Convert UniversalMessage array to OpenAI format
     */
    private convertToOpenAIMessages(messages: UniversalMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
        return messages.map(msg => {
            switch (msg.role) {
                case 'user':
                    return {
                        role: 'user' as const,
                        content: msg.content || ''
                    };
                case 'assistant':
                    if (msg.toolCalls && msg.toolCalls.length > 0) {
                        return {
                            role: 'assistant' as const,
                            content: msg.content || '',
                            tool_calls: msg.toolCalls.map((toolCall: ToolCall) => ({
                                id: toolCall.id,
                                type: 'function' as const,
                                function: {
                                    name: toolCall.function.name,
                                    arguments: toolCall.function.arguments
                                }
                            }))
                        };
                    }
                    return {
                        role: 'assistant' as const,
                        content: msg.content || ''
                    };
                case 'system':
                    return {
                        role: 'system' as const,
                        content: msg.content || ''
                    };
                case 'tool':
                    return {
                        role: 'tool' as const,
                        content: msg.content || '',
                        tool_call_id: msg.toolCallId || ''
                    };
                default:
                    throw new Error(`Unsupported message role: ${(msg as any).role}`);
            }
        });
    }

    /**
     * Convert tool schemas to OpenAI format
     */
    private convertToOpenAITools(tools: ToolSchema[]): OpenAI.Chat.ChatCompletionTool[] {
        return tools.map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
            }
        }));
    }

    /**
       * Convert OpenAI response to UniversalMessage
     * 
       * IMPORTANT: This preserves content: null for tool calls to prevent infinite loops
       */
    private convertFromOpenAIResponse(response: OpenAI.Chat.ChatCompletion): UniversalMessage {
        const choice = response.choices[0];
        if (!choice) {
            throw new Error('No choice in OpenAI response');
        }
        const message = choice.message;

        return {
            role: 'assistant',
            content: message.content, // Keep null as is - crucial for tool execution!
            timestamp: new Date(),
            ...(message.tool_calls && {
                toolCalls: message.tool_calls.map(tc => ({
                    id: tc.id,
                    type: tc.type,
                    function: {
                        name: tc.function.name,
                        arguments: tc.function.arguments
                    }
                }))
            })
        };
    }

    /**
       * Convert OpenAI streaming chunk to UniversalMessage
       */
    private convertFromOpenAIChunk(chunk: OpenAI.Chat.ChatCompletionChunk): UniversalMessage | null {
        const choice = chunk.choices[0];
        if (!choice) return null;

        const delta = choice.delta;

        return {
            role: 'assistant',
            content: delta.content || null,
            timestamp: new Date(),
            ...(delta.tool_calls && {
                toolCalls: delta.tool_calls.map((tc) => ({
                    id: tc.id || '',
                    type: (tc.type as 'function') || 'function',
                    function: {
                        name: tc.function?.name || '',
                        arguments: tc.function?.arguments || ''
                    }
                }))
            })
        };
    }

    /**
       * Validate UniversalMessage array
       */
    protected validateMessages(messages: UniversalMessage[]): void {
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