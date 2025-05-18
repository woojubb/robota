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
 * Anthropic 제공업체 구현
 */
export class AnthropicProvider implements ModelContextProtocol {
    /**
     * Anthropic 클라이언트 인스턴스
     */
    private client: Anthropic;

    /**
     * 제공업체 옵션
     */
    public options: AnthropicProviderOptions;

    constructor(options: AnthropicProviderOptions) {
        this.options = {
            temperature: 0.7,
            maxTokens: undefined,
            ...options
        };

        // 클라이언트가 주입되지 않았으면 에러 발생
        if (!options.client) {
            throw new Error('Anthropic 클라이언트가 주입되지 않았습니다. client 옵션은 필수입니다.');
        }

        this.client = options.client;
    }

    /**
     * 주어진 컨텍스트로 모델에 요청을 보내고 응답을 받습니다.
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
            const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
            throw new Error(`Anthropic API 호출 오류: ${errorMessage}`);
        }
    }

    /**
     * 주어진 컨텍스트로 모델에 스트리밍 요청을 보내고 응답 청크를 받습니다.
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
            const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
            throw new Error(`Anthropic API 스트리밍 호출 오류: ${errorMessage}`);
        }
    }

    /**
     * 메시지를 모델이 이해할 수 있는 형식으로 포맷합니다.
     */
    formatMessages(messages: Message[]): any[] {
        // 이 메서드는 타입 호환성을 위해 존재하지만 실제로는 사용하지 않습니다.
        // Anthropic v0.5.0에서는 messages 형식이 아닌 prompt 문자열을 사용합니다.
        return [];
    }

    /**
     * 메시지를 Anthropic prompt 형식으로 변환합니다.
     */
    private formatPrompt(messages: Message[], systemPrompt?: string): string {
        let prompt = '';

        // 시스템 프롬프트가 있으면 추가
        if (systemPrompt) {
            prompt += systemPrompt + '\n\n';
        }

        // Human/Assistant 교차 형식으로 메시지 추가
        for (const message of messages) {
            if (message.role === 'user') {
                prompt += `\n\nHuman: ${message.content}`;
            } else if (message.role === 'assistant') {
                prompt += `\n\nAssistant: ${message.content}`;
            }
        }

        // 마지막 사용자 메시지 후에 Assistant 프롬프트 추가
        if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
            prompt += '\n\nAssistant:';
        }

        return prompt;
    }

    /**
     * 함수 정의를 모델이 이해할 수 있는 형식으로 포맷합니다.
     */
    formatFunctions(functions: FunctionDefinition[]): any {
        // Anthropic API는 아직 함수 호출 기능을 지원하지 않을 수 있습니다.
        // 여기서는 빈 배열을 반환합니다.
        return [];
    }

    /**
     * 모델 응답을 표준 형식으로 파싱합니다.
     */
    parseResponse(response: any): ModelResponse {
        return {
            content: response.completion || '',
            functionCall: undefined,
            usage: {
                promptTokens: 0, // Anthropic v0.5.0은 usage 정보를 제공하지 않습니다
                completionTokens: 0,
                totalTokens: 0
            }
        };
    }

    /**
     * 스트리밍 응답 청크를 표준 형식으로 파싱합니다.
     */
    parseStreamingChunk(chunk: any): StreamingResponseChunk {
        return {
            content: chunk.completion || '',
            functionCall: undefined
        };
    }
} 