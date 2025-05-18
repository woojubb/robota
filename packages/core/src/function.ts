/**
 * 함수 생성 및 호출 유틸리티
 * 
 * @module Function
 * @description
 * AI가 호출할 수 있는 함수를 생성하고 관리하는 유틸리티입니다.
 * zod 라이브러리를 사용하여 함수 매개변수의 유효성 검사를 수행합니다.
 */

import { z } from 'zod';
import type { FunctionDefinition, FunctionCall, FunctionCallResult, FunctionSchema } from './types';

/**
 * 함수 결과 타입
 */
export type FunctionResult<TResult = any> = {
    result: TResult;
};

/**
 * 함수 옵션 인터페이스
 */
export interface FunctionOptions<TParams = any, TResult = any> {
    name: string;
    description?: string;
    parameters: z.ZodObject<any> | any;
    execute: (params: TParams) => Promise<TResult> | TResult;
}

/**
 * 함수 인터페이스
 */
export interface Function<TParams = any, TResult = any> {
    name: string;
    description?: string;
    schema: FunctionDefinition;
    execute: (params: TParams) => Promise<TResult>;
}

/**
 * zod 스키마를 JSON 스키마 형식으로 변환
 * @param schema zod 스키마
 * @returns JSON 스키마
 */
function zodToJsonSchema(schema: z.ZodObject<any>): any {
    const jsonSchema: any = {
        type: 'object',
        properties: {},
        required: []
    };

    // zod 스키마의 shape 객체를 JSON 스키마 속성으로 변환
    const shape = schema._def.shape();
    const entries = Object.entries(shape);

    for (const [key, value] of entries) {
        const fieldSchema = convertZodTypeToJsonSchema(value as z.ZodTypeAny, key);
        jsonSchema.properties[key] = fieldSchema;

        // 필수 필드 확인 (optional이 아니고 nullable이 아닌 경우)
        if (!isOptionalType(value as z.ZodTypeAny) && !isNullableType(value as z.ZodTypeAny)) {
            if (!jsonSchema.required) {
                jsonSchema.required = [];
            }
            jsonSchema.required.push(key);
        }
    }

    return jsonSchema;
}

/**
 * zod 타입을 JSON 스키마 타입으로 변환
 * @param zodType zod 타입
 * @param fieldName 필드 이름 (오류 메시지용)
 * @returns JSON 스키마 타입
 */
function convertZodTypeToJsonSchema(zodType: z.ZodTypeAny, fieldName: string): any {
    // 기본 JSON 스키마 객체
    const jsonSchema: any = {};

    // 설명 추출
    const description = getZodDescription(zodType);
    if (description) {
        jsonSchema.description = description;
    }

    // 타입에 따라 변환
    if (zodType instanceof z.ZodString) {
        jsonSchema.type = 'string';

        // 문자열 제약 조건
        if (zodType._def.checks) {
            for (const check of zodType._def.checks) {
                if (check.kind === 'min') {
                    jsonSchema.minLength = check.value;
                } else if (check.kind === 'max') {
                    jsonSchema.maxLength = check.value;
                } else if (check.kind === 'regex') {
                    jsonSchema.pattern = check.regex.source;
                } else if (check.kind === 'email') {
                    jsonSchema.format = 'email';
                } else if (check.kind === 'url') {
                    jsonSchema.format = 'uri';
                }
            }
        }
    } else if (zodType instanceof z.ZodNumber) {
        jsonSchema.type = 'number';

        // 숫자 제약 조건
        if (zodType._def.checks) {
            for (const check of zodType._def.checks) {
                if (check.kind === 'min') {
                    jsonSchema.minimum = check.value;
                } else if (check.kind === 'max') {
                    jsonSchema.maximum = check.value;
                } else if (check.kind === 'int') {
                    jsonSchema.type = 'integer';
                }
            }
        }
    } else if (zodType instanceof z.ZodBoolean) {
        jsonSchema.type = 'boolean';
    } else if (zodType instanceof z.ZodArray) {
        jsonSchema.type = 'array';
        jsonSchema.items = convertZodTypeToJsonSchema(zodType._def.type, `${fieldName}[]`);

        // 배열 제약 조건
        if (zodType._def.minLength !== null) {
            jsonSchema.minItems = zodType._def.minLength.value;
        }
        if (zodType._def.maxLength !== null) {
            jsonSchema.maxItems = zodType._def.maxLength.value;
        }
    } else if (zodType instanceof z.ZodEnum) {
        jsonSchema.type = 'string';
        jsonSchema.enum = zodType._def.values;
    } else if (zodType instanceof z.ZodObject) {
        jsonSchema.type = 'object';
        const nestedSchema = zodToJsonSchema(zodType);
        jsonSchema.properties = nestedSchema.properties;
        jsonSchema.required = nestedSchema.required;
    } else if (zodType instanceof z.ZodUnion) {
        jsonSchema.oneOf = zodType._def.options.map((option: z.ZodTypeAny) =>
            convertZodTypeToJsonSchema(option, fieldName)
        );
    } else if (zodType instanceof z.ZodOptional) {
        return convertZodTypeToJsonSchema(zodType._def.innerType, fieldName);
    } else if (zodType instanceof z.ZodNullable) {
        const innerSchema = convertZodTypeToJsonSchema(zodType._def.innerType, fieldName);
        jsonSchema.type = [innerSchema.type, 'null'];
        Object.assign(jsonSchema, innerSchema);
    } else if (zodType instanceof z.ZodDefault) {
        const innerSchema = convertZodTypeToJsonSchema(zodType._def.innerType, fieldName);
        Object.assign(jsonSchema, innerSchema);
        jsonSchema.default = zodType._def.defaultValue();
    } else {
        // 기타 타입은 문자열로 처리
        jsonSchema.type = 'string';
        console.warn(`Unsupported zod type for field ${fieldName}, using string as fallback`);
    }

    return jsonSchema;
}

/**
 * zod 타입에서 설명 추출
 * @param zodType zod 타입
 * @returns 설명 문자열
 */
function getZodDescription(zodType: z.ZodTypeAny): string | undefined {
    // zod 타입의 메타데이터에서 설명을 추출
    const description = zodType._def.description;
    if (description) return description;

    // 내부 타입이 있는 경우 재귀적으로 설명 추출
    if (zodType instanceof z.ZodOptional || zodType instanceof z.ZodNullable) {
        return getZodDescription(zodType._def.innerType);
    }

    return undefined;
}

/**
 * zod 타입이 옵셔널인지 확인
 * @param zodType zod 타입
 * @returns 옵셔널 여부
 */
function isOptionalType(zodType: z.ZodTypeAny): boolean {
    return zodType instanceof z.ZodOptional ||
        (zodType instanceof z.ZodDefault);
}

/**
 * zod 타입이 null을 허용하는지 확인
 * @param zodType zod 타입
 * @returns nullable 여부
 */
function isNullableType(zodType: z.ZodTypeAny): boolean {
    return zodType instanceof z.ZodNullable;
}

/**
 * 함수 생성
 * 
 * @function createFunction
 * @description
 * AI가 호출할 수 있는 함수를 생성합니다.
 * 함수 이름, 설명, 매개변수 스키마, 실행 로직을 정의할 수 있습니다.
 * 
 * @template TParams 함수 매개변수 타입
 * @template TResult 함수 반환 결과 타입
 * @param {FunctionOptions<TParams, TResult>} options - 함수 옵션
 * @param {string} options.name - 함수 이름
 * @param {string} [options.description] - 함수 설명
 * @param {z.ZodObject<any> | any} options.parameters - 매개변수 스키마
 * @param {(params: TParams) => Promise<TResult> | TResult} options.execute - 실행 로직
 * @returns {Function<TParams, TResult>} 생성된 함수 객체
 * 
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { createFunction } from '@robota-sdk/core';
 * 
 * const getWeather = createFunction({
 *   name: 'getWeather',
 *   description: '특정 위치의 날씨 정보를 조회합니다.',
 *   parameters: z.object({
 *     location: z.string().describe('날씨를 조회할 위치 (도시명)'),
 *     unit: z.enum(['celsius', 'fahrenheit']).optional().describe('온도 단위')
 *   }),
 *   execute: async (params) => {
 *     // 날씨 API 호출 로직
 *     return { temperature: 25, condition: '맑음' };
 *   }
 * });
 * ```
 */
export function createFunction<TParams = any, TResult = any>(
    options: FunctionOptions<TParams, TResult>
): Function<TParams, TResult> {
    const { name, description, parameters, execute } = options;

    // zod 스키마를 JSON 스키마로 변환
    const schema: FunctionDefinition = {
        name,
        description,
        parameters: parameters instanceof z.ZodObject
            ? zodToJsonSchema(parameters)
            : parameters
    };

    // 함수 실행 래퍼
    const wrappedExecute = async (params: TParams): Promise<TResult> => {
        try {
            // zod 스키마가 있는 경우 매개변수 유효성 검사
            if (parameters instanceof z.ZodObject) {
                parameters.parse(params);
            }

            // 함수 실행
            return await Promise.resolve(execute(params));
        } catch (error) {
            // zod 검증 오류 처리
            if (error instanceof z.ZodError) {
                const errorMessage = error.errors.map(e =>
                    `${e.path.join('.')}: ${e.message}`
                ).join(', ');

                throw new Error(`Parameter validation failed: ${errorMessage}`);
            }

            // 기타 오류는 그대로 전파
            throw error;
        }
    };

    // 함수 객체 생성
    return {
        name,
        description,
        schema,
        execute: wrappedExecute
    };
}

/**
 * 콜백 함수를 Function 객체로 변환
 * 
 * @function functionFromCallback
 * @description
 * 일반 JavaScript 함수를 AI가 호출할 수 있는 Function 객체로 변환합니다.
 * 
 * @param {string} name - 함수 이름
 * @param {Function} fn - 변환할 콜백 함수
 * @param {string} [description] - 함수 설명
 * @returns {Function} 생성된 함수 객체
 * 
 * @example
 * ```typescript
 * import { functionFromCallback } from '@robota-sdk/core';
 * 
 * const calculateSum = functionFromCallback(
 *   'calculateSum',
 *   (a: number, b: number) => a + b,
 *   '두 숫자의 합을 계산합니다.'
 * );
 * ```
 */
export function functionFromCallback(
    name: string,
    fn: (...args: any[]) => any,
    description?: string
): Function {
    // 함수 매개변수 정보 추출
    const fnStr = fn.toString();
    const argsMatch = fnStr.match(/\(([^)]*)\)/);
    const argNames = argsMatch ? argsMatch[1].split(',').map(arg => arg.trim()).filter(Boolean) : [];

    // 매개변수 스키마 생성
    const paramSchema = {
        type: 'object',
        properties: Object.fromEntries(argNames.map(name => [name, { type: 'string' }])),
        required: argNames
    };

    // 실행 함수 래핑
    const execute = async (params: Record<string, any>) => {
        const args = argNames.map(name => params[name]);
        return await Promise.resolve(fn(...args));
    };

    return {
        name,
        description,
        schema: { name, description, parameters: paramSchema },
        execute
    };
}

/**
 * 함수 스키마를 Zod 스키마로 변환하는 유틸리티 함수
 */
export function createFunctionSchema(definition: FunctionDefinition) {
    const propertySchemas: Record<string, z.ZodTypeAny> = {};

    if (definition.parameters && definition.parameters.properties) {
        for (const [key, prop] of Object.entries(definition.parameters.properties)) {
            switch (prop.type) {
                case 'string':
                    propertySchemas[key] = z.string();
                    break;
                case 'number':
                    propertySchemas[key] = z.number();
                    break;
                case 'boolean':
                    propertySchemas[key] = z.boolean();
                    break;
                case 'array':
                    propertySchemas[key] = z.array(z.any());
                    break;
                case 'object':
                    propertySchemas[key] = z.record(z.any());
                    break;
                default:
                    propertySchemas[key] = z.any();
            }
        }
    }

    return z.object(propertySchemas);
}

/**
 * 함수 호출 핸들러 타입
 */
export type FunctionHandler = (
    args: Record<string, any>,
    context?: any
) => Promise<any>;

/**
 * 함수 호출 레지스트리
 */
export class FunctionRegistry {
    private functions: Map<string, FunctionHandler> = new Map();
    private definitions: Map<string, FunctionDefinition> = new Map();

    /**
     * 함수를 등록합니다
     */
    register(definition: FunctionDefinition, handler: FunctionHandler): void {
        this.functions.set(definition.name, handler);
        this.definitions.set(definition.name, definition);
    }

    /**
     * 등록된 모든 함수 정의를 반환합니다
     */
    getAllDefinitions(): FunctionDefinition[] {
        return Array.from(this.definitions.values());
    }

    /**
     * 함수 이름으로 함수 정의를 가져옵니다
     */
    getDefinition(name: string): FunctionDefinition | undefined {
        return this.definitions.get(name);
    }

    /**
     * 함수 호출을 실행합니다
     */
    async execute(
        functionCall: FunctionCall,
        context?: any
    ): Promise<FunctionCallResult> {
        const { name, arguments: args } = functionCall;
        const handler = this.functions.get(name);

        if (!handler) {
            throw new Error(`함수 '${name}'가 등록되지 않았습니다`);
        }

        try {
            const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;
            const result = await handler(parsedArgs, context);

            return {
                name,
                result
            };
        } catch (error) {
            return {
                name,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
} 