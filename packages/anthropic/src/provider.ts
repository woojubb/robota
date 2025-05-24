import Anthropic from '@anthropic-ai/sdk';
import {
    Context,
    FunctionDefinition,
    Message,
    AIProvider,
    ModelResponse,
    StreamingResponseChunk,
    UniversalMessage
} from '@robota-sdk/core';
import { AnthropicProviderOptions } from './types';
import { AnthropicConversationAdapter } from './adapter';

/**
 * Anthropic provider implementation
 */
export class AnthropicProvider implements AIProvider {
    /**
     * Provider name
     */
    public name: string = 'anthropic';

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
    async chat(model: string, context: Context, options?: any): Promise<ModelResponse> {
        if (!context || typeof context !== 'object') {
            throw new Error('유효한 Context 객체가 필요합니다');
        }

        const { messages, systemPrompt } = context;

        if (!Array.isArray(messages)) {
            throw new Error('유효한 메시지 배열이 필요합니다');
        }

        try {
            // UniversalMessage[]를 Anthropic prompt 형식으로 변환
            const prompt = AnthropicConversationAdapter.toAnthropicPrompt(
                messages as UniversalMessage[],
                systemPrompt
            );

            const response = await this.client.completions.create({
                model: model || this.options.model || 'claude-2',
                prompt: prompt,
                max_tokens_to_sample: options?.maxTokens ?? this.options.maxTokens ?? 1000,
                temperature: options?.temperature ?? this.options.temperature
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
    async *chatStream(model: string, context: Context, options?: any): AsyncGenerator<StreamingResponseChunk, void, unknown> {
        if (!context || typeof context !== 'object') {
            throw new Error('유효한 Context 객체가 필요합니다');
        }

        const { messages, systemPrompt } = context;

        if (!Array.isArray(messages)) {
            throw new Error('유효한 메시지 배열이 필요합니다');
        }

        try {
            // UniversalMessage[]를 Anthropic prompt 형식으로 변환
            const prompt = AnthropicConversationAdapter.toAnthropicPrompt(
                messages as UniversalMessage[],
                systemPrompt
            );

            const stream = await this.client.completions.create({
                model: model || this.options.model || 'claude-2',
                prompt: prompt,
                max_tokens_to_sample: options?.maxTokens ?? this.options.maxTokens ?? 1000,
                temperature: options?.temperature ?? this.options.temperature,
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
     * @deprecated Use AnthropicConversationAdapter.toAnthropicPrompt instead
     */
    formatMessages(_messages: Message[]): unknown[] {
        // This method exists for type compatibility but is not actually used.
        // Anthropic v0.5.0 uses prompt strings instead of messages format.
        return [];
    }

    /**
     * Convert messages to Anthropic prompt format.
     * @deprecated Use AnthropicConversationAdapter.toAnthropicPrompt instead
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
    formatFunctions(_functions: FunctionDefinition[]): unknown {
        // Anthropic API may not yet support function calling features.
        // Return empty array here.
        return [];
    }

    /**
     * Parse model response into standard format.
     */
    parseResponse(response: unknown): ModelResponse {
        const responseObj = response as { completion?: string };
        return {
            content: responseObj.completion || '',
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
    parseStreamingChunk(chunk: unknown): StreamingResponseChunk {
        const chunkObj = chunk as { completion?: string };
        return {
            content: chunkObj.completion || '',
            functionCall: undefined
        };
    }

    /**
     * 리소스 해제 (필요시)
     */
    async close(): Promise<void> {
        // Anthropic 클라이언트는 특별한 종료 메서드가 없으므로 빈 함수로 구현
    }
} 