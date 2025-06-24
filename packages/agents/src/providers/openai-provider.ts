import OpenAI from 'openai';
import type { AIProvider, Context, ModelResponse, StreamingResponseChunk, ToolSchema } from '../interfaces/provider';
import { BaseAIProvider } from '../abstracts/base-ai-provider';
import { logger } from '../utils/logger';

/**
 * OpenAI provider options
 */
export interface OpenAIProviderOptions {
    client: OpenAI;
    model?: string;
    temperature?: number;
    maxTokens?: number;
}

/**
 * OpenAI AI provider implementation for agents package
 */
export class OpenAIProvider extends BaseAIProvider {
    public readonly name: string = 'openai';
    public readonly models: string[] = [
        'gpt-4',
        'gpt-4-turbo',
        'gpt-4o',
        'gpt-4o-mini',
        'gpt-3.5-turbo',
        'gpt-3.5-turbo-16k'
    ];

    private readonly client: OpenAI;
    private readonly options: OpenAIProviderOptions;

    constructor(options: OpenAIProviderOptions) {
        super();

        if (!options.client) {
            throw new Error('OpenAI client is required');
        }

        this.client = options.client;
        this.options = {
            temperature: 0.7,
            maxTokens: undefined,
            ...options
        };
    }

    /**
     * Generate response using raw request payload (required by ConversationService)
     */
    async generateResponse(request: any): Promise<any> {
        try {
            logger.debug(`[${this.name}] Generating response`, {
                model: request.model,
                messageCount: request.messages?.length,
                hasTools: !!request.tools?.length
            });

            // Convert messages to OpenAI format
            const openaiMessages = this.convertMessages(request.messages || []);

            // Prepare completion options
            const completionOptions: OpenAI.Chat.ChatCompletionCreateParams = {
                model: request.model,
                messages: openaiMessages,
                temperature: request.temperature ?? this.options.temperature,
                max_tokens: request.max_tokens ?? this.options.maxTokens,
            };

            // Add tools if provided
            if (request.tools && Array.isArray(request.tools) && request.tools.length > 0) {
                completionOptions.tools = this.convertTools(request.tools);
                completionOptions.tool_choice = 'auto';
            }

            // Debug: Log payload to console (Agents Package)
            console.log('🔍 OpenAI Provider (Agents) - API Payload:', JSON.stringify({
                model: completionOptions.model,
                messages: completionOptions.messages?.length,
                tools: completionOptions.tools ? `${completionOptions.tools.length} tools` : 'no tools',
                request_tools: request.tools ? `${request.tools.length} request tools` : 'no request tools',
                tools_detail: completionOptions.tools
            }, null, 2));

            // 🔍 Debug: Log all messages being sent to OpenAI
            console.log('🔍 OpenAI Provider - Full Messages Array:');
            completionOptions.messages?.forEach((msg, index) => {
                console.log(`  [${index}] ${msg.role}: ${JSON.stringify(msg)}`);
            });

            // Call OpenAI API
            const response = await this.client.chat.completions.create(completionOptions);

            // Convert response to expected format
            const choice = response.choices[0];
            if (!choice) {
                throw new Error('No response choices returned from OpenAI');
            }

            const result = {
                content: choice.message.content || '',
                message: { content: choice.message.content || '' },
                tool_calls: choice.message.tool_calls?.map((tc: any) => ({
                    id: tc.id,
                    type: tc.type,
                    function: tc.function
                })),
                toolCalls: choice.message.tool_calls?.map((tc: any) => ({
                    id: tc.id,
                    type: tc.type,
                    function: tc.function
                })),
                usage: response.usage && {
                    prompt_tokens: response.usage.prompt_tokens,
                    completion_tokens: response.usage.completion_tokens,
                    total_tokens: response.usage.total_tokens,
                    promptTokens: response.usage.prompt_tokens,
                    completionTokens: response.usage.completion_tokens,
                    totalTokens: response.usage.total_tokens
                },
                finish_reason: choice.finish_reason,
                finishReason: choice.finish_reason,
                metadata: {
                    model: response.model,
                    finishReason: choice.finish_reason
                }
            };

            logger.debug(`[${this.name}] Response generated successfully`, {
                model: request.model,
                contentLength: result.content.length,
                hasToolCalls: !!result.tool_calls?.length,
                finishReason: result.finish_reason
            });

            return result;

        } catch (error) {
            logger.error(`[${this.name}] Failed to generate response`, {
                model: request.model,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Chat method implementation (required by BaseAIProvider)
     */
    async chat(model: string, context: Context, options?: any): Promise<ModelResponse> {
        // Convert context to request format and use generateResponse
        const request = {
            model,
            messages: context.messages,
            temperature: options?.temperature,
            max_tokens: options?.maxTokens,
            tools: context.tools
        };

        const response = await this.generateResponse(request);

        return {
            content: response.content,
            toolCalls: response.toolCalls,
            usage: response.usage,
            metadata: response.metadata
        };
    }

    /**
     * Convert messages to OpenAI format
     */
    private convertMessages(messages: any[]): OpenAI.Chat.ChatCompletionMessageParam[] {
        return messages.map(message => {
            switch (message.role) {
                case 'system':
                    return {
                        role: 'system',
                        content: message.content
                    };
                case 'user':
                    return {
                        role: 'user',
                        content: message.content
                    };
                case 'assistant':
                    const assistantMessage: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
                        role: 'assistant',
                        content: message.content
                    };
                    if (message.toolCalls || message.tool_calls) {
                        assistantMessage.tool_calls = (message.toolCalls || message.tool_calls)?.map((tc: any) => ({
                            id: tc.id,
                            type: tc.type || 'function',
                            function: tc.function
                        }));
                    }
                    return assistantMessage;
                case 'tool':
                    return {
                        role: 'tool',
                        tool_call_id: message.toolCallId || message.tool_call_id,
                        content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
                    };
                default:
                    logger.warn(`[${this.name}] Unknown message role: ${message.role}, treating as user message`);
                    return {
                        role: 'user',
                        content: message.content
                    };
            }
        });
    }

    /**
     * Convert tools to OpenAI format
     */
    private convertTools(tools: ToolSchema[]): OpenAI.Chat.ChatCompletionTool[] {
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
     * Check if model is supported
     */
    supportsModel(model: string): boolean {
        return this.models.includes(model);
    }

    /**
     * Cleanup resources
     */
    async close(): Promise<void> {
        // OpenAI client doesn't need explicit cleanup
        await this.dispose();
    }
} 