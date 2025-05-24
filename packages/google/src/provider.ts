import { GoogleGenerativeAI } from '@google/generative-ai';
import type {
    Context,
    FunctionDefinition,
    AIProvider,
    ModelResponse,
    StreamingResponseChunk,
    UniversalMessage
} from '@robota-sdk/core';
import type { GoogleProviderOptions } from './types';
import { GoogleConversationAdapter } from './adapter';

/**
 * Google AI provider implementation
 */
export class GoogleProvider implements AIProvider {
    /**
     * Provider name
     */
    public name: string = 'google';

    /**
     * Google AI client instance
     */
    private client: GoogleGenerativeAI;

    /**
     * Provider options
     */
    public options: GoogleProviderOptions;

    constructor(options: GoogleProviderOptions) {
        this.options = {
            temperature: 0.7,
            maxTokens: undefined,
            ...options
        };

        // Throw error if client is not injected
        if (!options.client) {
            throw new Error('Google AI client is not injected. The client option is required.');
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
            // UniversalMessage[]를 Google AI 형식으로 변환
            const { contents, systemInstruction } = GoogleConversationAdapter.processMessages(
                messages as UniversalMessage[],
                systemPrompt
            );

            // Google AI 모델 가져오기
            const generativeModel = this.client.getGenerativeModel({
                model: model || this.options.model || 'gemini-1.5-flash',
                systemInstruction: systemInstruction
            });

            // 생성 구성
            const generationConfig = {
                temperature: options?.temperature ?? this.options.temperature,
                maxOutputTokens: options?.maxTokens ?? this.options.maxTokens,
            };

            const result = await generativeModel.generateContent({
                contents,
                generationConfig
            });

            return this.parseResponse(result);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Google AI API call error: ${errorMessage}`);
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
            // UniversalMessage[]를 Google AI 형식으로 변환
            const { contents, systemInstruction } = GoogleConversationAdapter.processMessages(
                messages as UniversalMessage[],
                systemPrompt
            );

            // Google AI 모델 가져오기
            const generativeModel = this.client.getGenerativeModel({
                model: model || this.options.model || 'gemini-1.5-flash',
                systemInstruction: systemInstruction
            });

            // 생성 구성
            const generationConfig = {
                temperature: options?.temperature ?? this.options.temperature,
                maxOutputTokens: options?.maxTokens ?? this.options.maxTokens,
            };

            const result = await generativeModel.generateContentStream({
                contents,
                generationConfig
            });

            for await (const chunk of result.stream) {
                yield this.parseStreamingChunk(chunk);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Google AI streaming API call error: ${errorMessage}`);
        }
    }

    /**
     * Format function definitions into a format the model can understand.
     */
    formatFunctions(_functions: FunctionDefinition[]): unknown {
        // Google AI function calling 지원 구현 예정
        return [];
    }

    /**
     * Parse model response into standard format.
     */
    parseResponse(response: any): ModelResponse {
        const text = response.response?.text() || '';

        return {
            content: text,
            functionCall: undefined, // 추후 function calling 지원 시 구현
            usage: {
                promptTokens: 0, // Google AI API에서 사용량 정보 추출 필요
                completionTokens: 0,
                totalTokens: 0
            },
            metadata: {
                model: response.response?.model,
                finishReason: response.response?.candidates?.[0]?.finishReason
            }
        };
    }

    /**
     * Parse streaming response chunk into standard format.
     */
    parseStreamingChunk(chunk: any): StreamingResponseChunk {
        const text = chunk.text() || '';

        return {
            content: text,
            functionCall: undefined,
            isComplete: false // 스트림 완료 감지 로직 필요
        };
    }

    /**
     * 리소스 해제 (필요시)
     */
    async close(): Promise<void> {
        // Google AI 클라이언트는 특별한 종료 메서드가 없으므로 빈 함수로 구현
    }
} 