/**
 * 함수 도구 제공자 모듈
 * 
 * @module function-tool-provider
 * @description
 * Zod 스키마를 기반으로 함수 도구를 제공하는 도구 제공자 구현을 제공합니다.
 */

import { z } from 'zod';
import type { ZodFunctionTool, zodFunctionToSchema } from './zod-schema';

/**
 * Zod 스키마 기반 함수 도구 제공자 옵션
 */
export interface ZodFunctionToolProviderOptions {
    /** 모델 이름 */
    model: string;
    /** 온도 (0~1) */
    temperature?: number;
    /** 최대 토큰 수 */
    maxTokens?: number;
    /** 도구 정의 객체 */
    tools: Record<string, ZodFunctionTool<z.ZodObject<any>>>;
    /** 
     * 사용자 지정 메시지 처리 함수 (선택적)
     * 정의하지 않으면 기본 응답을 반환합니다.
     */
    processMessage?: (message: string, tools: Record<string, ZodFunctionTool<z.ZodObject<any>>>) => Promise<any>;
}

/**
 * Zod 스키마 기반 함수 도구 제공자를 생성합니다.
 * 
 * @param options - 함수 도구 제공자 옵션
 * @returns 도구 제공자 인스턴스
 * 
 * @example
 * ```typescript
 * const calculatorTool = {
 *   name: 'add',
 *   description: '두 숫자를 더합니다',
 *   parameters: z.object({
 *     a: z.number().describe('첫 번째 숫자'),
 *     b: z.number().describe('두 번째 숫자')
 *   }),
 *   handler: async ({ a, b }) => ({ result: a + b })
 * };
 * 
 * const provider = createZodFunctionToolProvider({
 *   model: 'function-model',
 *   tools: { add: calculatorTool }
 * });
 * 
 * const robota = new Robota({
 *   provider,
 *   systemPrompt: '당신은 도움이 되는 계산기입니다.'
 * });
 * ```
 */
export function createZodFunctionToolProvider(options: ZodFunctionToolProviderOptions): any {
    // 기본 메시지 처리 함수
    const defaultProcessMessage = async (message: string, tools: Record<string, ZodFunctionTool<z.ZodObject<any>>>): Promise<any> => {
        // 기본 응답 생성
        return { content: `'${message}'에 대한 응답입니다.` };
    };

    // 함수 호출 처리 함수
    const processMessageWithTools = options.processMessage || defaultProcessMessage;

    // 채팅 함수 구현
    const chat = async (requestOptions: any): Promise<any> => {
        // 마지막 사용자 메시지 가져오기
        const lastUserMessage = requestOptions.messages
            .slice().reverse()
            .find((msg: { role: string }) => msg.role === 'user')?.content || '';

        try {
            // 메시지 처리 및 응답 생성
            const response = await processMessageWithTools(lastUserMessage, options.tools);
            return response;
        } catch (error) {
            console.error('함수 도구 처리 중 오류 발생:', error);
            return { content: `오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}` };
        }
    };

    // 스트리밍 함수 구현 (선택적)
    const stream = async function* (requestOptions: any): AsyncIterable<any> {
        try {
            // 일반 응답 생성
            const response = await chat(requestOptions);

            // 응답을 단어 단위로 나누어 스트리밍 (간단한 구현)
            if (response.content) {
                const words = response.content.split(' ');
                for (const word of words) {
                    yield { content: word + ' ' };
                    await new Promise(resolve => setTimeout(resolve, 50)); // 작은 지연 추가
                }
            }

            // 함수 호출이 있는 경우 완전한 응답 전달
            if (response.function_call) {
                yield response;
            }
        } catch (error) {
            console.error('스트리밍 처리 중 오류 발생:', error);
            yield { content: `오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}` };
        }
    };

    // 도구 정의를 JSON 스키마로 변환
    const functions = Object.values(options.tools).map(tool => {
        // zodFunctionToSchema 함수를 직접 구현
        return {
            name: tool.name,
            description: tool.description,
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        };
    });

    // 함수 도구 제공자 객체 반환 (ToolProvider 인터페이스 구현)
    return {
        id: 'zod-function-tool-provider',
        options: {
            model: options.model
        },
        async generateCompletion(context: any): Promise<any> {
            const requestOptions = {
                model: options.model,
                messages: context.messages,
                functions: functions,
                temperature: options.temperature,
                max_tokens: options.maxTokens
            };

            const response = await chat(requestOptions);

            return {
                content: response.content,
                functionCall: response.function_call ? {
                    name: response.function_call.name,
                    arguments: JSON.parse(response.function_call.arguments || '{}')
                } : undefined
            };
        },
        async generateCompletionStream(context: any): Promise<AsyncIterable<any>> {
            const requestOptions = {
                model: options.model,
                messages: context.messages,
                functions: functions,
                temperature: options.temperature,
                max_tokens: options.maxTokens,
                stream: true
            };

            // 스트리밍 처리
            return (async function* () {
                for await (const chunk of stream(requestOptions)) {
                    yield {
                        content: chunk.content,
                        functionCall: chunk.function_call ? {
                            name: chunk.function_call.name,
                            arguments: JSON.parse(chunk.function_call.arguments || '{}')
                        } : undefined
                    };
                }
            })();
        }
    };
} 