import Anthropic from '@anthropic-ai/sdk';
import type { IAnthropicProviderOptions } from './types';
import { AbstractAIProvider } from '@robota-sdk/agents';
import type {
    TUniversalMessage,
    IChatOptions,
    IToolSchema,
    IAssistantMessage,
} from '@robota-sdk/agents';

/**
 * Anthropic provider implementation for Robota
 * 
 * IMPORTANT PROVIDER-SPECIFIC RULES:
 * 1. This provider MUST extend BaseAIProvider from @robota-sdk/agents
 * 2. Content handling for Anthropic API:
 *    - When tool_calls are present: content MUST be null (not empty string)
 *    - For regular assistant messages: content should be a string
 * 3. Use override keyword for all methods inherited from BaseAIProvider
 * 4. Provider-specific API behavior should be documented here
 * 
 * @public
 */
export class AnthropicProvider extends AbstractAIProvider {
    override readonly name = 'anthropic';
    override readonly version = '1.0.0';

    private readonly client?: Anthropic;
    private readonly options: IAnthropicProviderOptions;

    constructor(options: IAnthropicProviderOptions) {
        super();
        this.options = options;

        // Set executor if provided
        if (options.executor) {
            this.executor = options.executor;
        }

        // Only create client if not using executor
        if (!this.executor) {
            // Create client from apiKey if not provided
            if (options.client) {
                this.client = options.client;
            } else if (options.apiKey) {
                this.client = new Anthropic({
                    apiKey: options.apiKey,
                    ...(options.timeout && { timeout: options.timeout }),
                    ...(options.baseURL && { baseURL: options.baseURL })
                });
            } else {
                throw new Error('Either Anthropic client, apiKey, or executor is required');
            }
        }
    }

    /**
     * Generate response using TUniversalMessage
     */
    override async chat(messages: TUniversalMessage[], options?: IChatOptions): Promise<TUniversalMessage> {
        this.validateMessages(messages);

        // Try executor first, then fallback to direct execution
        if (this.executor) {
            try {
                return await this.executeViaExecutorOrDirect(messages, options);
            } catch (error) {
                throw error;
            }
        }

        // Direct execution with Anthropic client
        if (!this.client) {
            throw new Error('Anthropic client not available. Either provide a client/apiKey or use an executor.');
        }

        const anthropicMessages = this.convertToAnthropicFormat(messages);

        if (!options?.model) {
            throw new Error('Model is required in chat options. Please specify a model in defaultModel configuration.');
        }

        const requestParams: Anthropic.MessageCreateParams = {
            model: options.model as string,
            messages: anthropicMessages,
            max_tokens: options?.maxTokens || 4096
        };

        if (options?.temperature !== undefined) {
            requestParams.temperature = options.temperature;
        }

        if (options?.tools) {
            requestParams.tools = this.convertToolsToAnthropicFormat(options.tools);
        }

        const response = await this.client.messages.create(requestParams);

        return this.convertFromAnthropicResponse(response);
    }

    /**
     * Generate streaming response using TUniversalMessage
     */
    override async *chatStream(messages: TUniversalMessage[], options?: IChatOptions): AsyncIterable<TUniversalMessage> {
        this.validateMessages(messages);

        // Try executor first, then fallback to direct execution
        if (this.executor) {
            try {
                yield* this.executeStreamViaExecutorOrDirect(messages, options);
                return;
            } catch (error) {
                throw error;
            }
        }

        // Direct execution with Anthropic client
        if (!this.client) {
            throw new Error('Anthropic client not available. Either provide a client/apiKey or use an executor.');
        }

        const anthropicMessages = this.convertToAnthropicFormat(messages);

        if (!options?.model) {
            throw new Error('Model is required in chat options. Please specify a model in defaultModel configuration.');
        }

        const requestParams: Anthropic.MessageCreateParamsStreaming = {
            model: options.model as string,
            messages: anthropicMessages,
            max_tokens: options?.maxTokens || 4096,
            stream: true
        };

        if (options?.temperature !== undefined) {
            requestParams.temperature = options.temperature;
        }

        if (options?.tools) {
            requestParams.tools = this.convertToolsToAnthropicFormat(options.tools);
        }

        const stream = await this.client.messages.create(requestParams);

        for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                yield {
                    role: 'assistant',
                    content: chunk.delta.text,
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
        // Anthropic client doesn't need explicit cleanup
    }

    /**
     * Convert TUniversalMessage to Anthropic format
     * 
     * CRITICAL: Anthropic API requires specific content handling:
     * - tool_use messages: content MUST be null
     * - regular messages: content should be a string
     */
    private convertToAnthropicFormat(messages: TUniversalMessage[]): Anthropic.MessageParam[] {
        return messages.map(msg => {
            if (msg.role === 'user') {
                return {
                    role: 'user',
                    content: msg.content || ''
                };
            } else if (msg.role === 'assistant') {
                const assistantMsg = msg as IAssistantMessage;

                // IMPORTANT: Anthropic requires null content for tool calls
                if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
                    return {
                        role: 'assistant',
                        content: null, // MUST be null for tool calls in Anthropic
                        tool_calls: assistantMsg.toolCalls.map(tc => ({
                            id: tc.id,
                            type: 'function',
                            function: {
                                name: tc.function.name,
                                arguments: JSON.stringify(tc.function.arguments)
                            }
                        }))
                    } as any;
                }

                // Regular assistant message
                return {
                    role: 'assistant',
                    content: assistantMsg.content || ''
                };
            } else {
                // System messages
                return {
                    role: 'user', // Anthropic doesn't have system role, use user
                    content: msg.content || ''
                };
            }
        });
    }

    /**
     * Convert Anthropic response to TUniversalMessage
     */
    private convertFromAnthropicResponse(response: Anthropic.Message): TUniversalMessage {
        if (!response.content || response.content.length === 0) {
            throw new Error('No content in Anthropic response');
        }

        const content = response.content[0];

        if (content && content.type === 'text') {
            const textContent = content as Anthropic.TextBlock;
            const result: TUniversalMessage = {
                role: 'assistant',
                content: textContent.text,
                timestamp: new Date()
            };

            // Add metadata if available
            if (response.usage) {
                (result as any).metadata = {
                    inputTokens: response.usage.input_tokens,
                    outputTokens: response.usage.output_tokens,
                    model: response.model
                };

                // Only add stopReason if it's not null
                if (response.stop_reason) {
                    (result as any).metadata['stopReason'] = response.stop_reason;
                }
            }

            return result;
        } else if (content && content.type === 'tool_use') {
            const toolContent = content as Anthropic.ToolUseBlock;
            const result: TUniversalMessage = {
                role: 'assistant',
                content: '', // Empty string for type compatibility
                timestamp: new Date(),
                toolCalls: [{
                    id: toolContent.id,
                    type: 'function' as const,
                    function: {
                        name: toolContent.name,
                        arguments: JSON.stringify(toolContent.input)
                    }
                }]
            };

            return result;
        }

        throw new Error(`Unsupported content type: ${(content as any).type}`);
    }

    /**
     * Convert tools to Anthropic format
     */
    private convertToolsToAnthropicFormat(tools: IToolSchema[]): Anthropic.Tool[] {
        return tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters as Anthropic.Tool.InputSchema
        }));
    }

    /**
     * Validate TUniversalMessage array
     */
    protected override validateMessages(messages: TUniversalMessage[]): void {
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