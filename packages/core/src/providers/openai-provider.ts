import type { AIProvider, Context, ModelResponse, StreamingResponseChunk } from '../interfaces/ai-provider';
import { logger } from '../utils';

/**
 * OpenAI Provider wrapper
 * Wraps OpenAI client with unified AIProvider interface.
 */
export class OpenAIProvider implements AIProvider {
    public readonly name = 'openai';

    private client: any; // OpenAI client

    constructor(client: any) {
        this.client = client;
    }

    /**
     * Filter and format conversation history for API
     * Takes complete conversation history and converts to API format
     */
    private filterHistory(messages: any[]): any[] {
        return messages
            .filter((m: any) => {
                // Include all non-tool messages (system, user, assistant)
                if (m.role !== 'tool') return true;
                // For tool messages, only include those with toolCallId (valid tool results)
                return m.toolCallId != null;
            })
            .map((m: any) => {
                if (m.role === 'tool') {
                    return {
                        role: m.role,
                        content: m.content || '',
                        tool_call_id: m.toolCallId
                    };
                }

                const baseMessage: any = {
                    role: m.role,
                    content: m.content || '', // Ensure content is never null
                };

                if (m.name) baseMessage.name = m.name;
                if (m.toolCalls) baseMessage.tool_calls = m.toolCalls;

                return baseMessage;
            });
    }

    /**
     * Configure tools for API request
     */
    private configureTools(completionOptions: any, tools?: any[]): void {
        if (tools && Array.isArray(tools)) {
            completionOptions.tools = tools.map((fn: any) => ({
                type: 'function',
                function: {
                    name: fn.name,
                    description: fn.description || '',
                    parameters: fn.parameters || { type: 'object', properties: {} }
                }
            }));
            completionOptions.tool_choice = 'auto'; // Enable tool calling
        }
    }

    /**
     * Chat request
     */
    async chat(model: string, context: Context, options?: any): Promise<ModelResponse> {
        try {
            const { messages } = context;

            // Filter conversation history for API
            const formattedMessages = this.filterHistory(messages);

            // Debug: Log the messages being sent to OpenAI
            logger.info('Debug [Core OpenAI Provider] - Messages being sent to OpenAI:');
            logger.info(JSON.stringify(formattedMessages, null, 2));
            logger.info('Original messages count:', messages.length);
            logger.info('Filtered messages count:', formattedMessages.length);

            // Configure OpenAI API request options
            const completionOptions: any = {
                model,
                messages: formattedMessages,
                temperature: options?.temperature ?? 0.7,
                max_tokens: options?.maxTokens
            };

            // Configure tools if present
            this.configureTools(completionOptions, options?.tools);

            // Call OpenAI API
            const response = await this.client.chat.completions.create(completionOptions);

            return {
                content: response.choices[0]?.message?.content || "",
                toolCalls: response.choices[0]?.message?.tool_calls || undefined,
                usage: response.usage ? {
                    promptTokens: response.usage.prompt_tokens,
                    completionTokens: response.usage.completion_tokens,
                    totalTokens: response.usage.total_tokens
                } : undefined,
                metadata: {
                    model: response.model,
                    finishReason: response.choices[0].finish_reason
                }
            };
        } catch (error) {
            logger.error('[OpenAIProvider] API call error:', error);
            throw error;
        }
    }

    /**
     * Streaming chat request
     */
    async *chatStream(model: string, context: Context, options?: any): AsyncGenerator<StreamingResponseChunk, void, unknown> {
        try {
            const { messages } = context;

            // Filter conversation history for API
            const formattedMessages = this.filterHistory(messages);

            // Debug: Log the messages being sent to OpenAI
            logger.info('Debug [Core OpenAI Provider Streaming] - Messages being sent to OpenAI:');
            logger.info(JSON.stringify(formattedMessages, null, 2));
            logger.info('Original messages count:', messages.length);
            logger.info('Filtered messages count:', formattedMessages.length);

            // Configure OpenAI API request options
            const completionOptions: any = {
                model,
                messages: formattedMessages,
                temperature: options?.temperature ?? 0.7,
                max_tokens: options?.maxTokens,
                stream: true
            };

            // Configure tools if present
            this.configureTools(completionOptions, options?.tools);

            const stream = await this.client.chat.completions.create(completionOptions);

            for await (const chunk of stream) {
                const delta = chunk.choices[0].delta;
                yield {
                    content: delta.content || undefined,
                    isComplete: chunk.choices[0].finish_reason !== null
                } as StreamingResponseChunk;
            }
        } catch (error) {
            logger.error('[OpenAIProvider] Streaming API call error:', error);
            throw error;
        }
    }

    /**
     * Release resources
     */
    async close(): Promise<void> {
        // OpenAI client has no special close method
    }
} 