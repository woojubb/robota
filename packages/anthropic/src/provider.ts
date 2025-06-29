import Anthropic from '@anthropic-ai/sdk';
import { BaseAIProvider } from '@robota-sdk/agents';
import type { UniversalMessage, ToolSchema, ChatOptions } from '@robota-sdk/agents';
import { AnthropicProviderOptions } from './types';


/**
 * Anthropic AI provider implementation for Robota
 * 
 * Provides integration with Anthropic's Claude models using provider-agnostic UniversalMessage.
 * Uses Anthropic SDK native types internally for optimal performance and feature support.
 * 
 * @public
 */
export class AnthropicProvider extends BaseAIProvider<
    AnthropicProviderOptions,
    UniversalMessage,
    UniversalMessage
> {
    readonly name = 'anthropic';
    readonly version = '1.0.0';

    private readonly client: Anthropic;
    private readonly options: AnthropicProviderOptions;

    constructor(options: AnthropicProviderOptions) {
        super();
        this.options = options;
        this.client = options.client;

        if (!this.client) {
            throw new Error('Anthropic client is required');
        }
    }

    /**
     * Generate response using UniversalMessage
     */
    async chat(messages: UniversalMessage[], options?: ChatOptions): Promise<UniversalMessage> {
        this.validateMessages(messages);

        try {
            // 1. Convert UniversalMessage → Anthropic format
            const anthropicMessages = this.convertToAnthropicMessages(messages);
            const systemMessage = this.extractSystemMessage(messages);

            // 2. Call Anthropic API (native SDK types)
            const requestParams: Anthropic.MessageCreateParams = {
                model: options?.model || 'claude-3-haiku-20240307',
                max_tokens: options?.maxTokens || 1000,
                messages: anthropicMessages,
                ...(options?.temperature !== undefined && { temperature: options.temperature }),
                ...(systemMessage && { system: systemMessage }),
                ...(options?.tools && {
                    tools: this.convertToAnthropicTools(options.tools)
                })
            };

            const response: Anthropic.Message = await this.client.messages.create(requestParams);

            // 3. Convert Anthropic response → UniversalMessage
            return this.convertFromAnthropicResponse(response);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Anthropic chat failed: ${errorMessage}`);
        }
    }

    /**
     * Generate streaming response using UniversalMessage
     */
    async *chatStream(messages: UniversalMessage[], options?: ChatOptions): AsyncIterable<UniversalMessage> {
        this.validateMessages(messages);

        try {
            // 1. Convert UniversalMessage → Anthropic format
            const anthropicMessages = this.convertToAnthropicMessages(messages);
            const systemMessage = this.extractSystemMessage(messages);

            // 2. Call Anthropic streaming API
            const requestParams: Anthropic.MessageCreateParams = {
                model: options?.model || 'claude-3-haiku-20240307',
                max_tokens: options?.maxTokens || 1000,
                messages: anthropicMessages,
                stream: true,
                ...(options?.temperature !== undefined && { temperature: options.temperature }),
                ...(systemMessage && { system: systemMessage }),
                ...(options?.tools && {
                    tools: this.convertToAnthropicTools(options.tools)
                })
            };

            const stream = await this.client.messages.create(requestParams as Anthropic.MessageCreateParamsStreaming);

            // 3. Stream conversion: Anthropic chunks → UniversalMessage
            for await (const chunk of stream) {
                const universalMessage = this.convertFromAnthropicChunk(chunk);
                if (universalMessage) {
                    yield universalMessage;
                }
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Anthropic stream failed: ${errorMessage}`);
        }
    }

    override supportsTools(): boolean {
        return true;
    }

    override validateConfig(): boolean {
        return !!this.client && !!this.options;
    }

    override async dispose(): Promise<void> {
        // Anthropic client doesn't need explicit cleanup
    }

    /**
     * Convert UniversalMessage array to Anthropic format
     */
    private convertToAnthropicMessages(messages: UniversalMessage[]): Anthropic.MessageParam[] {
        // Filter out system messages (handled separately)
        const nonSystemMessages = messages.filter(msg => msg.role !== 'system');

        return nonSystemMessages.map(msg => {
            switch (msg.role) {
                case 'user':
                    return { role: 'user', content: msg.content || '' };
                case 'assistant':
                    return {
                        role: 'assistant',
                        content: msg.content || '',
                        ...(msg.toolCalls && {
                            tool_calls: msg.toolCalls.map(tc => ({
                                id: tc.id,
                                type: 'function' as const,
                                function: {
                                    name: tc.function.name,
                                    arguments: tc.function.arguments
                                }
                            }))
                        })
                    };
                case 'tool':
                    return {
                        role: 'user',
                        content: msg.content || '',
                        // Note: Anthropic handles tool results differently
                    };
                default:
                    throw new Error(`Unsupported message role: ${(msg as UniversalMessage).role}`);
            }
        });
    }

    /**
     * Extract system message from UniversalMessage array
     */
    private extractSystemMessage(messages: UniversalMessage[]): string | undefined {
        const systemMessage = messages.find(msg => msg.role === 'system');
        return systemMessage?.content || undefined;
    }

    /**
     * Convert tool schemas to Anthropic format
     */
    private convertToAnthropicTools(tools: ToolSchema[]): Anthropic.Tool[] {
        return tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters
        }));
    }

    /**
     * Convert Anthropic response to UniversalMessage
     */
    private convertFromAnthropicResponse(response: Anthropic.Message): UniversalMessage {
        const content = response.content
            .filter((block): block is Anthropic.TextBlock => block.type === 'text')
            .map(block => block.text)
            .join('\n');

        // Check for tool use blocks
        const toolUseBlocks = response.content.filter(
            (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        );

        return {
            role: 'assistant',
            content: content || null,
            timestamp: new Date(),
            ...(toolUseBlocks.length > 0 && {
                toolCalls: toolUseBlocks.map(block => ({
                    id: block.id,
                    type: 'function' as const,
                    function: {
                        name: block.name,
                        arguments: JSON.stringify(block.input)
                    }
                }))
            })
        };
    }

    /**
     * Convert Anthropic streaming chunk to UniversalMessage
     */
    private convertFromAnthropicChunk(chunk: Anthropic.MessageStreamEvent): UniversalMessage | null {
        if (chunk.type === 'content_block_delta' && chunk.delta && 'text' in chunk.delta) {
            return {
                role: 'assistant',
                content: chunk.delta.text,
                timestamp: new Date()
            };
        }

        if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'tool_use') {
            return {
                role: 'assistant',
                content: null,
                timestamp: new Date(),
                toolCalls: [{
                    id: chunk.content_block.id,
                    type: 'function' as const,
                    function: {
                        name: chunk.content_block.name,
                        arguments: JSON.stringify(chunk.content_block.input || {})
                    }
                }]
            };
        }

        return null;
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