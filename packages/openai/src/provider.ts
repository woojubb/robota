import OpenAI from 'openai';
import type { UniversalMessage, ToolSchema } from '@robota-sdk/agents';
import { BaseAIProvider } from '@robota-sdk/agents';
import { OpenAIProviderOptions } from './types';
import type {
    OpenAIToolCall,
    OpenAIError
} from './types/api-types';

/**
 * Chat options for AI provider requests
 */
export interface ChatOptions {
    /** Tool schemas to provide to the AI provider */
    tools?: ToolSchema[];
    /** Maximum number of tokens to generate */
    maxTokens?: number;
    /** Temperature for response randomness (0-1) */
    temperature?: number;
    /** Model to use for the request */
    model?: string;
}

/**
 * OpenAI Provider that uses only UniversalMessage (no ModelResponse)
 * 
 * This implementation follows the AI Provider Architecture Separation principles:
 * - Uses OpenAI SDK native types internally
 * - Communicates with agents package using only UniversalMessage
 * - Handles tool execution null content properly
 * 
 * @template TConfig - Provider configuration type (defaults to OpenAIProviderOptions)
 * @template TMessage - Message type (defaults to UniversalMessage)
 * @template TResponse - Response type (defaults to UniversalMessage)
 */
export class OpenAIProvider extends BaseAIProvider<OpenAIProviderOptions, UniversalMessage, UniversalMessage> {
    readonly name = 'openai';
    readonly version = '1.0.0';

    private readonly client: OpenAI;
    private readonly options: OpenAIProviderOptions;

    constructor(options: OpenAIProviderOptions) {
        super();

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

    override supportsTools(): boolean {
        return true;
    }

    override validateConfig(): boolean {
        return !!this.client && !!this.options;
    }

    override async dispose(): Promise<void> {
        // OpenAI client doesn't need explicit cleanup
    }

    /**
     * Convert UniversalMessage array to OpenAI format
     */
    private convertToOpenAIMessages(messages: UniversalMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
        return messages.map(msg => {
            switch (msg.role) {
                case 'system':
                    return { role: 'system', content: msg.content };
                case 'user':
                    return { role: 'user', content: msg.content };
                case 'assistant': {
                    const assistantMsg = msg as UniversalMessage & { toolCalls?: OpenAIToolCall[] };
                    return {
                        role: 'assistant',
                        content: msg.content, // Keep null for tool calls - this is crucial!
                        ...(assistantMsg.toolCalls && {
                            tool_calls: assistantMsg.toolCalls.map((tc) => ({
                                id: tc.id,
                                type: 'function' as const,
                                function: {
                                    name: tc.function.name,
                                    arguments: tc.function.arguments
                                }
                            }))
                        })
                    };
                }
                case 'tool': {
                    const toolMsg = msg as UniversalMessage & { toolCallId: string };
                    return {
                        role: 'tool',
                        content: msg.content,
                        tool_call_id: toolMsg.toolCallId
                    };
                }
                default:
                    throw new Error(`Unsupported message role: ${(msg as UniversalMessage).role}`);
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