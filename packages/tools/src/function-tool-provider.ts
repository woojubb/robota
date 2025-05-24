/**
 * 함수 도구 제공자 모듈
 * 
 * @module function-tool-provider
 * @description
 * Zod 스키마를 기반으로 함수 도구를 제공하는 도구 제공자 구현을 제공합니다.
 */

import { z } from 'zod';
import type { ZodFunctionTool } from './zod-schema';
import type { ToolProvider } from './tool-provider';

/**
 * Zod 스키마 기반 함수 도구 제공자 옵션
 */
export interface ZodFunctionToolProviderOptions {
    /** 도구 정의 객체 */
    tools: Record<string, ZodFunctionTool<z.ZodObject<z.ZodRawShape>>>;
}

/**
 * Zod 스키마 기반 함수 도구 제공자를 생성합니다.
 * 
 * @param options - 함수 도구 제공자 옵션
 * @returns 도구 제공자 인스턴스 (ToolProvider 인터페이스 구현)
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
 *   tools: { add: calculatorTool }
 * });
 * 
 * const robota = new Robota({
 *   aiClient: openaiProvider,
 *   provider: provider,
 *   systemPrompt: '당신은 도움이 되는 계산기입니다.'
 * });
 * ```
 */
export function createZodFunctionToolProvider(options: ZodFunctionToolProviderOptions): ToolProvider {
    // 도구 정의를 JSON 스키마로 변환
    const functions = Object.values(options.tools).map(tool => {
        // zodFunctionToSchema 함수 대신 직접 스키마 변환 처리
        const properties: Record<string, {
            type: string;
            description?: string;
            enum?: unknown[];
        }> = {};
        const required: string[] = [];

        // Zod 스키마에서 속성 추출
        const shape = tool.parameters.shape || {};
        for (const propName in shape) {
            const prop = shape[propName];

            // 속성 타입 및 설명 추출
            let type = 'string';
            if (prop._def.typeName === 'ZodNumber') type = 'number';
            if (prop._def.typeName === 'ZodBoolean') type = 'boolean';
            if (prop._def.typeName === 'ZodArray') type = 'array';
            if (prop._def.typeName === 'ZodObject') type = 'object';

            properties[propName] = {
                type,
                description: prop._def.description || `${propName} 매개변수`
            };

            // enum 값이 있는 경우 추가
            if (prop._def.typeName === 'ZodEnum') {
                properties[propName].enum = prop._def.values;
            }

            // 필수 속성인 경우 required 배열에 추가
            if (!prop._def.isOptional) {
                required.push(propName);
            }
        }

        return {
            name: tool.name,
            description: tool.description,
            parameters: {
                type: "object" as const,
                properties,
                required: required.length > 0 ? required : undefined
            }
        };
    });

    // 함수 도구 제공자 객체 반환 (ToolProvider 인터페이스 구현)
    return {
        // 함수 스키마 목록
        functions,

        // ToolProvider 인터페이스 구현: callTool
        async callTool(toolName: string, parameters: Record<string, unknown>): Promise<unknown> {
            const tool = options.tools[toolName];
            if (!tool) {
                throw new Error(`도구 '${toolName}'를 찾을 수 없습니다.`);
            }

            try {
                // 도구 핸들러 호출
                return await tool.handler(parameters);
            } catch (error) {
                console.error(`도구 '${toolName}' 호출 중 오류:`, error);
                throw new Error(`도구 호출 실패: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    };
} 