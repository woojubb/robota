import type { AIProvider, Context, ModelResponse, StreamingResponseChunk } from '../interfaces/ai-provider';
import { logger } from '../utils';

/**
 * OpenAI Provider 래퍼
 * OpenAI 클라이언트를 통합 AIProvider 인터페이스로 감쌉니다.
 */
export class OpenAIProvider implements AIProvider {
    public readonly name = 'openai';
    public readonly availableModels = [
        'gpt-4',
        'gpt-4-turbo',
        'gpt-4-turbo-preview',
        'gpt-3.5-turbo',
        'gpt-3.5-turbo-0125',
        'gpt-3.5-turbo-1106'
    ];

    private client: any; // OpenAI 클라이언트

    constructor(client: any) {
        this.client = client;
    }

    /**
     * 채팅 요청
     */
    async chat(model: string, context: Context, options?: any): Promise<ModelResponse> {
        if (!this.availableModels.includes(model)) {
            throw new Error(`OpenAI에서 지원하지 않는 모델입니다: ${model}`);
        }

        try {
            const { messages, systemPrompt } = context;

            // 시스템 프롬프트 추가 (없는 경우)
            const messagesWithSystem = systemPrompt && !messages.some((m: any) => m.role === 'system')
                ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
                : messages;

            // OpenAI 형식으로 메시지 변환
            const formattedMessages = messagesWithSystem.map((m: any) => ({
                role: m.role,
                content: m.content,
                name: m.name
            }));

            // OpenAI API 요청 옵션 구성
            const completionOptions: any = {
                model,
                messages: formattedMessages,
                temperature: options?.temperature ?? 0.7,
                max_tokens: options?.maxTokens
            };

            // 도구가 있을 경우 함수 정의 추가
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

            // OpenAI API 호출
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
            logger.error('[OpenAIProvider] API 호출 오류:', error);
            throw error;
        }
    }

    /**
     * 스트리밍 채팅 요청
     */
    async *chatStream(model: string, context: Context, options?: any): AsyncGenerator<StreamingResponseChunk, void, unknown> {
        if (!this.availableModels.includes(model)) {
            throw new Error(`OpenAI에서 지원하지 않는 모델입니다: ${model}`);
        }

        try {
            const { messages, systemPrompt } = context;

            // 시스템 프롬프트 추가 (없는 경우)
            const messagesWithSystem = systemPrompt && !messages.some((m: any) => m.role === 'system')
                ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
                : messages;

            // OpenAI 형식으로 메시지 변환
            const formattedMessages = messagesWithSystem.map((m: any) => ({
                role: m.role,
                content: m.content,
                name: m.name
            }));

            // OpenAI API 요청 옵션 구성
            const completionOptions: any = {
                model,
                messages: formattedMessages,
                temperature: options?.temperature ?? 0.7,
                max_tokens: options?.maxTokens,
                stream: true
            };

            // 도구가 있을 경우 함수 정의 추가
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
            logger.error('[OpenAIProvider] 스트리밍 API 호출 오류:', error);
            throw error;
        }
    }

    /**
     * 리소스 해제
     */
    async close(): Promise<void> {
        // OpenAI 클라이언트는 특별한 종료 메서드가 없음
    }
} 