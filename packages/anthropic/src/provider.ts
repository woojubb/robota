import Anthropic from '@anthropic-ai/sdk';
import type { AnthropicProviderOptions } from './types';
import { BaseAIProvider } from '@robota-sdk/agents';
import type {
    UniversalMessage as RobotaUniversalMessage,
    ChatOptions as RobotaChatOptions,
    ToolSchema as RobotaToolSchema,
    AssistantMessage as RobotaAssistantMessage
} from '@robota-sdk/agents';

// Re-export with cleaner names for internal use
type UniversalMessage = RobotaUniversalMessage;
type ChatOptions = RobotaChatOptions;
type ToolSchema = RobotaToolSchema;
type AssistantMessage = RobotaAssistantMessage;

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
export class AnthropicProvider extends BaseAIProvider {
    override readonly name = 'anthropic';
    override readonly version = '1.0.0';

    private readonly client: Anthropic;
    private readonly options: AnthropicProviderOptions;

    constructor(options: AnthropicProviderOptions) {
        super();
        this.options = options;
        this.client = new Anthropic({
            apiKey: options.apiKey
        });
    }

    /**
     * Generate response using UniversalMessage
     */
    override async chat(messages: UniversalMessage[], options?: ChatOptions): Promise<UniversalMessage> {
        this.validateMessages(messages);

        const anthropicMessages = this.convertToAnthropicFormat(messages);

        const requestParams: Anthropic.MessageCreateParams = {
            model: this.options.model || 'claude-3-5-sonnet-20241022',
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
     * Generate streaming response using UniversalMessage
     */
    override async *chatStream(messages: UniversalMessage[], options?: ChatOptions): AsyncIterable<UniversalMessage> {
        this.validateMessages(messages);

        const anthropicMessages = this.convertToAnthropicFormat(messages);

        const requestParams: Anthropic.MessageCreateParamsStreaming = {
            model: this.options.model || 'claude-3-5-sonnet-20241022',
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
     * Convert UniversalMessage to Anthropic format
     * 
     * CRITICAL: Anthropic API requires specific content handling:
     * - tool_use messages: content MUST be null
     * - regular messages: content should be a string
     */
    private convertToAnthropicFormat(messages: UniversalMessage[]): Anthropic.MessageParam[] {
        return messages.map(msg => {
            if (msg.role === 'user') {
                return {
                    role: 'user',
                    content: msg.content || ''
                };
            } else if (msg.role === 'assistant') {
                const assistantMsg = msg as AssistantMessage;

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
     * Convert Anthropic response to UniversalMessage
     */
    private convertFromAnthropicResponse(response: Anthropic.Message): UniversalMessage {
        if (!response.content || response.content.length === 0) {
            throw new Error('No content in Anthropic response');
        }

        const content = response.content[0];

        if (content && content.type === 'text') {
            const textContent = content as Anthropic.TextBlock;
            const result: UniversalMessage = {
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
            const result: UniversalMessage = {
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
    private convertToolsToAnthropicFormat(tools: ToolSchema[]): Anthropic.Tool[] {
        return tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters as Anthropic.Tool.InputSchema
        }));
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