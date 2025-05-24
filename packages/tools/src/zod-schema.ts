/**
 * Zod 스키마 유틸리티 모듈
 * 
 * @module zod-schema
 * @description
 * Zod 스키마를 JSON 스키마로 변환하는 유틸리티 함수들을 제공합니다.
 * Robota의 함수 도구 정의를 위한 타입 정의 및 변환 기능을 지원합니다.
 */

import { z } from 'zod';

/**
 * Zod 객체 스키마를 JSON 스키마로 변환합니다.
 * 
 * @param schema - 변환할 Zod 객체 스키마
 * @returns JSON 스키마 객체
 * 
 * @example
 * ```typescript
 * const userSchema = z.object({
 *   name: z.string().describe('사용자 이름'),
 *   age: z.number().min(0).describe('사용자 나이'),
 *   email: z.string().email().optional().describe('이메일 주소')
 * });
 * 
 * const jsonSchema = zodToJsonSchema(userSchema);
 * // {
 * //   type: 'object',
 * //   properties: {
 * //     name: { type: 'string', description: '사용자 이름' },
 * //     age: { type: 'number', description: '사용자 나이' },
 * //     email: { type: 'string', description: '이메일 주소' }
 * //   },
 * //   required: ['name', 'age']
 * // }
 * ```
 */
export function zodToJsonSchema(schema: z.ZodObject<z.ZodRawShape>): {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
} {
    // z.object에서 속성 추출
    const shape = schema._def.shape();

    // JSON 스키마 속성 구성
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    // 각 속성에 대해 처리
    Object.entries(shape).forEach(([key, zodType]) => {
        // zodType은 z.ZodType 인스턴스
        const typeObj = zodType as z.ZodTypeAny;

        // 기본 속성 정보
        let property: Record<string, unknown> = {};

        // 타입 처리
        if (typeObj instanceof z.ZodNumber) {
            property.type = "number";
        } else if (typeObj instanceof z.ZodString) {
            property.type = "string";
        } else if (typeObj instanceof z.ZodBoolean) {
            property.type = "boolean";
        } else if (typeObj instanceof z.ZodEnum) {
            property.type = "string";
            property.enum = typeObj._def.values;
        } else if (typeObj instanceof z.ZodArray) {
            property.type = "array";
            // 배열 아이템 타입 처리
            if (typeObj._def.type instanceof z.ZodObject) {
                property.items = zodToJsonSchema(typeObj._def.type as z.ZodObject<z.ZodRawShape>);
            }
        } else if (typeObj instanceof z.ZodObject) {
            // 중첩 객체 처리
            property = zodToJsonSchema(typeObj);
        }

        // 설명 추가 (있는 경우)
        const description = typeObj._def.description;
        if (description) {
            property.description = description;
        }

        // optional 여부 확인
        const isOptional = typeObj instanceof z.ZodOptional;
        if (!isOptional) {
            required.push(key);
        }

        properties[key] = property;
    });

    // 최종 JSON 스키마 객체
    return {
        type: "object",
        properties,
        required: required.length > 0 ? required : undefined
    };
}

/**
 * Zod 스키마 기반 함수 도구 정의 인터페이스
 */
export interface ZodFunctionTool<T extends z.ZodObject<z.ZodRawShape>> {
    /** 도구 이름 */
    name: string;
    /** 도구 설명 */
    description: string;
    /** 도구 매개변수 스키마 */
    parameters: T;
    /** 도구 핸들러 함수 */
    handler: (params: z.infer<T>) => Promise<unknown>;
}

/**
 * Zod 함수 도구를 Robota 호환 함수 스키마로 변환합니다.
 * 
 * @param tool - Zod 기반 함수 도구 정의
 * @returns Robota 호환 함수 스키마
 */
export function zodFunctionToSchema<T extends z.ZodObject<z.ZodRawShape>>(tool: ZodFunctionTool<T>) {
    return {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.parameters)
    };
} 