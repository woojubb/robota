import Anthropic from '@anthropic-ai/sdk';
import {
    Context,
    FunctionDefinition,
    Message,
    ModelContextProtocol,
    ModelResponse,
    StreamingResponseChunk,
    removeUndefined
} from '@robota-sdk/core';
import { AnthropicProviderOptions } from './types';

/**
 * Anthropic provider implementation
 */
export class AnthropicProvider implements ModelContextProtocol {
    /**
     * Anthropic client instance
     */
    private client: Anthropic;

    /**
     * Provider options
     */
    public options: AnthropicProviderOptions;

    constructor(options: AnthropicProviderOptions) {
        this.options = {
            temperature: 0.7,
            maxTokens: undefined,
            ...options
        };

        // Throw error if client is not injected
        if (!options.client) {
            throw new Error('Anthropic client is not injected. The client option is required.');
        }

        this.client = options.client;
    }

    /**
     * Send request to model with given context and receive response.
     */
    async chat(context: Context): Promise<ModelResponse> {
        try {
            const response = await this.client.completions.create({
                model: this.options.model || 'claude-2',
                prompt: this.formatPrompt(context.messages, context.systemPrompt),
                max_tokens_to_sample: this.options.maxTokens || 1000,
                temperature: this.options.temperature
            });

            return this.parseResponse(response);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Anthropic API call error: ${errorMessage}`);
        }
    }

    /**
     * Send streaming request to model with given context and receive response chunks.
     */
    async *chatStream(context: Context): AsyncGenerator<StreamingResponseChunk, void, unknown> {
        try {
            const stream = await this.client.completions.create({
                model: this.options.model || 'claude-2',
                prompt: this.formatPrompt(context.messages, context.systemPrompt),
                max_tokens_to_sample: this.options.maxTokens || 1000,
                temperature: this.options.temperature,
                stream: true
            });

            for await (const chunk of stream) {
                yield this.parseStreamingChunk(chunk);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Anthropic API streaming call error: ${errorMessage}`);
        }
    }

    /**
     * Format messages into a format the model can understand.
     */
    formatMessages(messages: Message[]): any[] {
        // This method exists for type compatibility but is not actually used.
        // Anthropic v0.5.0 uses prompt strings instead of messages format.
        return [];
    }

    /**
     * Convert messages to Anthropic prompt format.
     */
    private formatPrompt(messages: Message[], systemPrompt?: string): string {
        let prompt = '';

        // Add system prompt if present
        if (systemPrompt) {
            prompt += systemPrompt + '\n\n';
        }

        // Add messages in Human/Assistant alternating format
        for (const message of messages) {
            if (message.role === 'user') {
                prompt += `\n\nHuman: ${message.content}`;
            } else if (message.role === 'assistant') {
                prompt += `\n\nAssistant: ${message.content}`;
            }
        }

        // Add Assistant prompt after the last user message
        if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
            prompt += '\n\nAssistant:';
        }

        return prompt;
    }

    /**
     * Format function definitions into a format the model can understand.
     */
    formatFunctions(functions: FunctionDefinition[]): any {
        // Anthropic API may not yet support function calling features.
        // Return empty array here.
        return [];
    }

    /**
     * Parse model response into standard format.
     */
    parseResponse(response: any): ModelResponse {
        return {
            content: response.completion || '',
            functionCall: undefined,
            usage: {
                promptTokens: 0, // Anthropic v0.5.0 does not provide usage information
                completionTokens: 0,
                totalTokens: 0
            }
        };
    }

    /**
     * Parse streaming response chunk into standard format.
     */
    parseStreamingChunk(chunk: any): StreamingResponseChunk {
        return {
            content: chunk.completion || '',
            functionCall: undefined
        };
    }
} 