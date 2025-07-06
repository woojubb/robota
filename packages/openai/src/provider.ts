import OpenAI from 'openai';
import type { OpenAIProviderOptions } from './types';
import type {
    OpenAIError
} from './types/api-types';
import { BaseAIProvider } from '@robota-sdk/agents';
import type {
    UniversalMessage,
    ChatOptions,
    ToolCall,
    ToolSchema,
    AssistantMessage
} from '@robota-sdk/agents';

/**
 * OpenAI provider implementation for Robota
 * 
 * Provides integration with OpenAI's GPT models following BaseAIProvider guidelines.
 * Uses OpenAI SDK native types internally for optimal performance and feature support.
 * 
 * @public
 */
export class OpenAIProvider extends BaseAIProvider {
    override readonly name = 'openai';
    override readonly version = '1.0.0';

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
    override async chat(messages: UniversalMessage[], options?: ChatOptions): Promise<UniversalMessage> {
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
            const errorMessage = openaiError.message || 'OpenAI API request failed';
            throw new Error(`OpenAI chat failed: ${errorMessage}`);
        }
    }

    /**
     * Generate streaming response using UniversalMessage
     */
    override async *chatStream(messages: UniversalMessage[], options?: ChatOptions): AsyncIterable<UniversalMessage> {
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
            const errorMessage = openaiError.message || 'OpenAI API request failed';
            throw new Error(`OpenAI stream failed: ${errorMessage}`);
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
                case 'user':
                    return {
                        role: 'user' as const,
                        content: msg.content || ''
                    };
                case 'assistant':
                    const assistantMsg = msg as AssistantMessage;
                    if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
                        return {
                            role: 'assistant' as const,
                            // IMPORTANT: Preserve null for tool calls as per OpenAI API spec
                            content: assistantMsg.content === '' ? null : (assistantMsg.content || null),
                            tool_calls: assistantMsg.toolCalls.map((toolCall: ToolCall) => ({
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
                    // This should never happen with proper TypeScript
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

        const result: UniversalMessage = {
            role: 'assistant',
            content: message.content || '', // Convert null to empty string for type compatibility
            timestamp: new Date(),
            ...(message.tool_calls && {
                toolCalls: message.tool_calls.map(tc => ({
                    id: tc.id,
                    type: tc.type as 'function',
                    function: {
                        name: tc.function.name,
                        arguments: tc.function.arguments
                    }
                }))
            })
        };

        // Add usage metadata if available
        if (response.usage) {
            // Flatten usage data for metadata compatibility
            result.metadata = {
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
                totalTokens: response.usage.total_tokens,
                model: response.model,
                finishReason: choice.finish_reason || undefined
            };
        }

        return result;
    }

    /**
     * Convert OpenAI streaming chunk to UniversalMessage
     */
    private convertFromOpenAIChunk(chunk: OpenAI.Chat.ChatCompletionChunk): UniversalMessage | null {
        const choice = chunk.choices[0];
        if (!choice) return null;

        const delta = choice.delta;

        const result: UniversalMessage = {
            role: 'assistant',
            content: delta.content || '', // Convert null to empty string for type compatibility
            timestamp: new Date(),
            ...(delta.tool_calls && {
                toolCalls: delta.tool_calls.map((tc) => ({
                    id: tc.id || '',
                    type: 'function' as const,
                    function: {
                        name: tc.function?.name || '',
                        arguments: tc.function?.arguments || ''
                    }
                }))
            })
        };

        // Add streaming metadata
        if (choice.finish_reason) {
            result.metadata = {
                finishReason: choice.finish_reason,
                isStreamChunk: 'true' // Convert boolean to string for metadata compatibility
            };
        }

        return result;
    }

    /**
     * Validate messages before sending to API
     * 
     * IMPORTANT: OpenAI API Content Handling Policy
     * =============================================
     * 
     * Based on OpenAI API documentation and community feedback:
     * 
     * 1. When sending TO OpenAI API:
     *    - Assistant messages with tool_calls: content MUST be null (not empty string)
     *    - Regular assistant messages: content can be string or null
     *    - This prevents "400 Bad Request" errors
     * 
     * 2. When receiving FROM our API (UniversalMessage):
     *    - All messages must have content as string (TypeScript requirement)
     *    - Convert null to empty string for type compatibility
     * 
     * 3. This dual handling ensures:
     *    - OpenAI API compatibility (null for tool calls)
     *    - TypeScript type safety (string content in UniversalMessage)
     *    - No infinite loops in tool execution
     * 
     * Reference: OpenAI Community discussions confirm that tool_calls
     * require content to be null, not empty string.
     */
    protected override validateMessages(messages: UniversalMessage[]): void {
        super.validateMessages(messages);

        // Additional OpenAI-specific validation
        for (const message of messages) {
            if (message.role === 'assistant') {
                const assistantMsg = message as AssistantMessage;
                if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0 && assistantMsg.content === '') {
                    // This is valid - we'll convert to null when sending to OpenAI
                    continue;
                }
            }
        }
    }
} 