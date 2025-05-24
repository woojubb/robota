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
     * Chat request
     */
    async chat(model: string, context: Context, options?: any): Promise<ModelResponse> {
        try {
            const { messages, systemPrompt } = context;

            // Add system prompt (if not present)
            const messagesWithSystem = systemPrompt && !messages.some((m: any) => m.role === 'system')
                ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
                : messages;

            // Convert messages to OpenAI format
            const formattedMessages = messagesWithSystem.map((m: any) => ({
                role: m.role,
                content: m.content,
                name: m.name
            }));

            // Configure OpenAI API request options
            const completionOptions: any = {
                model,
                messages: formattedMessages,
                temperature: options?.temperature ?? 0.7,
                max_tokens: options?.maxTokens
            };

            // Add function definitions if tools are present
            if (options?.tools && Array.isArray(options.tools)) {
                completionOptions.tools = options.tools.map((fn: any) => ({
                    type: 'function',
                    function: {
                        name: fn.name,
                        description: fn.description || '',
                        parameters: fn.parameters || { type: 'object', properties: {} }
                    }
                }));
            }

            // Call OpenAI API
            const response = await this.client.chat.completions.create(completionOptions);

            return {
                content: response.choices[0]?.message?.content || "",
                functionCall: response.choices[0]?.message?.tool_calls?.[0] ? {
                    name: response.choices[0].message.tool_calls[0].function.name,
                    arguments: typeof response.choices[0].message.tool_calls[0].function.arguments === 'string'
                        ? JSON.parse(response.choices[0].message.tool_calls[0].function.arguments)
                        : response.choices[0].message.tool_calls[0].function.arguments
                } : undefined,
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
            const { messages, systemPrompt } = context;

            // Add system prompt (if not present)
            const messagesWithSystem = systemPrompt && !messages.some((m: any) => m.role === 'system')
                ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
                : messages;

            // Convert messages to OpenAI format
            const formattedMessages = messagesWithSystem.map((m: any) => ({
                role: m.role,
                content: m.content,
                name: m.name
            }));

            // Configure OpenAI API request options
            const completionOptions: any = {
                model,
                messages: formattedMessages,
                temperature: options?.temperature ?? 0.7,
                max_tokens: options?.maxTokens,
                stream: true
            };

            // Add function definitions if tools are present
            if (options?.tools && Array.isArray(options.tools)) {
                completionOptions.tools = options.tools.map((fn: any) => ({
                    type: 'function',
                    function: {
                        name: fn.name,
                        description: fn.description || '',
                        parameters: fn.parameters || { type: 'object', properties: {} }
                    }
                }));
            }

            const stream = await this.client.chat.completions.create(completionOptions);

            for await (const chunk of stream) {
                const delta = chunk.choices[0].delta;
                yield {
                    content: delta.content || undefined,
                    isComplete: chunk.choices[0].finish_reason !== null,
                    functionCall: delta.tool_calls?.[0] ? {
                        name: delta.tool_calls[0].function?.name,
                        arguments: delta.tool_calls[0].function?.arguments
                    } : undefined
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