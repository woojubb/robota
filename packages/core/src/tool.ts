/**
 * 도구 모듈
 * 
 * @module Tool
 * @description
 * AI 에이전트가 외부 시스템과 상호작용하기 위한 도구를 제공합니다.
 * 도구는 실행 로직과 매개변수 검증을 포함하며, 전처리와 후처리 훅을 지원합니다.
 */

import { z } from 'zod';
import { createFunction } from './function';
import type { FunctionDefinition, FunctionSchema } from './types';

// 도구 결과 인터페이스
export interface ToolResult<TResult = any> {
    status: 'success' | 'error';
    data?: TResult;
    error?: string;
}

// 도구 옵션 인터페이스
export interface AdvancedToolOptions<TParams = any, TResult = any> {
    name: string;
    description: string;
    category?: string;
    version?: string;
    parameters: z.ZodObject<any> | FunctionSchema['parameters'];
    validateParams?: boolean;
    execute: (params: TParams) => Promise<ToolResult<TResult>> | ToolResult<TResult>;
    beforeExecute?: (params: TParams) => Promise<TParams> | TParams;
    afterExecute?: (result: ToolResult<TResult>) => Promise<ToolResult<TResult>> | ToolResult<TResult>;
}

/**
 * 도구 인터페이스
 */
export interface ToolInterface {
    /**
     * 도구 이름
     */
    name: string;

    /**
     * 도구 설명
     */
    description?: string;

    /**
     * 도구 스키마
     */
    schema: any;

    /**
     * 도구 실행 함수
     */
    execute: (args: any) => Promise<any>;

    /**
     * 함수 정의로 변환
     */
    toFunctionDefinition(): FunctionDefinition;
}

/**
 * 간단한 도구 옵션
 */
export interface SimpleToolOptions {
    name: string;
    description?: string;
    schema: z.ZodObject<any>;
    execute: (args: any) => Promise<any>;
}

/**
 * 도구 클래스
 * 
 * @class Tool
 * @implements {ToolInterface}
 * @description
 * AI 에이전트가 사용할 수 있는 도구를 구현합니다.
 * 도구는 함수와 유사하지만 더 많은 기능을 제공합니다:
 * - 매개변수 검증 (zod를 통한)
 * - 실행 전후 훅
 * - 오류 처리 및 결과 포맷팅
 * - 카테고리 및 버전 정보
 * 
 * @template TParams - 도구 매개변수 타입
 * @template TResult - 도구 결과 타입
 * 
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { Tool } from '@robota-sdk/core';
 * 
 * const weatherTool = new Tool({
 *   name: 'getWeather',
 *   description: '특정 위치의 날씨 정보를 조회합니다.',
 *   category: 'data',
 *   version: '1.0.0',
 *   parameters: z.object({
 *     location: z.string().describe('날씨를 조회할 위치 (도시명)'),
 *     unit: z.enum(['celsius', 'fahrenheit']).optional().describe('온도 단위')
 *   }),
 *   execute: async (params) => {
 *     // 날씨 API 호출 로직
 *     const data = { temperature: 25, condition: '맑음' };
 *     return {
 *       status: 'success',
 *       data
 *     };
 *   }
 * });
 * ```
 */
export class Tool<TParams = any, TResult = any> implements ToolInterface {
    /**
     * 도구 이름
     * 
     * @public
     * @readonly
     * @description
     * 도구를 식별하는 고유 이름입니다.
     */
    public readonly name: string;

    /**
     * 도구 설명
     * 
     * @public
     * @readonly
     * @description
     * 도구의 기능을 설명하는 문자열입니다.
     * AI가 이 설명을 통해 도구의 용도를 이해합니다.
     */
    public readonly description: string;

    /**
     * 도구 카테고리
     * 
     * @public
     * @readonly
     * @description
     * 도구를 분류하는 카테고리입니다.
     * 예: 'data', 'file', 'api', 'utility' 등
     */
    public readonly category?: string;

    /**
     * 도구 버전
     * 
     * @public
     * @readonly
     * @description
     * 도구의 버전 정보입니다.
     * 시맨틱 버전(Semantic Versioning) 형식을 권장합니다.
     */
    public readonly version?: string;

    /**
     * 도구 스키마
     * 
     * @public
     * @readonly
     * @description
     * 도구를 함수로 변환한 스키마입니다.
     * AI 모델에 전달될 때 이 스키마가 사용됩니다.
     */
    public readonly schema: FunctionSchema;

    /**
     * 매개변수 검증 여부
     * 
     * @private
     * @description
     * 도구 실행 시 매개변수 검증 여부를 결정합니다.
     * 기본값은 true입니다.
     */
    private readonly validateParams: boolean;

    /**
     * 매개변수 스키마
     * 
     * @private
     * @description
     * 매개변수 검증에 사용되는 zod 스키마 또는 JSON 스키마입니다.
     */
    private readonly parameters: z.ZodObject<any> | FunctionSchema['parameters'];

    /**
     * 도구 실행 함수
     * 
     * @private
     * @description
     * 도구의 핵심 로직을 구현한 함수입니다.
     */
    private readonly _execute: (params: TParams) => Promise<ToolResult<TResult>> | ToolResult<TResult>;

    /**
     * 실행 전 훅
     * 
     * @private
     * @description
     * 도구 실행 전에 호출되는 함수입니다.
     * 매개변수를 전처리하는 데 사용됩니다.
     */
    private readonly beforeExecute?: (params: TParams) => Promise<TParams> | TParams;

    /**
     * 실행 후 훅
     * 
     * @private
     * @description
     * 도구 실행 후에 호출되는 함수입니다.
     * 결과를 후처리하는 데 사용됩니다.
     */
    private readonly afterExecute?: (result: ToolResult<TResult>) => Promise<ToolResult<TResult>> | ToolResult<TResult>;

    /**
     * 생성자
     * 
     * @constructor
     * @description
     * 도구 인스턴스를 초기화합니다.
     * 
     * @param {AdvancedToolOptions<TParams, TResult>} options - 도구 옵션
     */
    constructor(options: AdvancedToolOptions<TParams, TResult>) {
        this.name = options.name;
        this.description = options.description;
        this.category = options.category;
        this.version = options.version;
        this.validateParams = options.validateParams !== false; // 기본값은 true
        this.parameters = options.parameters;
        this._execute = options.execute;
        this.beforeExecute = options.beforeExecute;
        this.afterExecute = options.afterExecute;

        // 함수 스키마 생성
        this.schema = this.toFunctionSchema();
    }

    /**
     * 도구 실행
     * 
     * @method execute
     * @description
     * 도구를 실행하고 결과를 반환합니다.
     * 다음 단계를 수행합니다:
     * 1. 매개변수 전처리 (beforeExecute 훅)
     * 2. 매개변수 검증 (zod를 통한)
     * 3. 도구 핵심 로직 실행
     * 4. 결과 후처리 (afterExecute 훅)
     * 5. 오류 처리 및 결과 반환
     * 
     * @param {TParams} params - 도구 매개변수
     * @returns {Promise<ToolResult<TResult>>} 도구 실행 결과
     * 
     * @example
     * ```typescript
     * const result = await weatherTool.execute({ location: '서울' });
     * console.log(result);
     * // {
     * //   status: 'success',
     * //   data: { temperature: 25, condition: '맑음' }
     * // }
     * ```
     */
    async execute(params: TParams): Promise<ToolResult<TResult>> {
        try {
            // 매개변수 전처리
            let processedParams = params;
            if (this.beforeExecute) {
                processedParams = await this.beforeExecute(params);
            }

            // 매개변수 검증
            if (this.validateParams && this.parameters instanceof z.ZodObject) {
                try {
                    processedParams = this.parameters.parse(processedParams) as TParams;
                } catch (error) {
                    if (error instanceof z.ZodError) {
                        const errorMessage = error.errors.map(e =>
                            `${e.path.join('.')}: ${e.message}`
                        ).join(', ');

                        return {
                            status: 'error',
                            error: `Parameter validation failed: ${errorMessage}`,
                            data: null as any
                        };
                    }
                    throw error;
                }
            }

            // 도구 실행
            const result = await this._execute(processedParams);

            // 결과 후처리
            if (this.afterExecute) {
                return await this.afterExecute(result);
            }

            return result;
        } catch (error) {
            // 오류 처리
            const errorMessage = error instanceof Error ? error.message : String(error);

            return {
                status: 'error',
                error: errorMessage,
                data: null as any
            };
        }
    }

    /**
     * 함수 스키마 생성
     * 
     * @method toFunctionSchema
     * @description
     * 도구를 AI 모델이 이해할 수 있는 함수 스키마로 변환합니다.
     * 
     * @returns {FunctionSchema} 함수 스키마
     */
    toFunctionSchema(): FunctionSchema {
        return {
            name: this.name,
            description: this.description,
            parameters: this.parameters instanceof z.ZodObject
                ? this.zodToJsonSchema(this.parameters)
                : this.parameters
        };
    }

    /**
     * 함수 정의로 변환
     * 
     * @method toFunctionDefinition
     * @description
     * 도구를 FunctionDefinition 객체로 변환합니다.
     * 
     * @returns {FunctionDefinition} 함수 정의 객체
     */
    toFunctionDefinition(): FunctionDefinition {
        return {
            name: this.name,
            description: this.description,
            parameters: this.parameters instanceof z.ZodObject
                ? this.zodToJsonSchema(this.parameters)
                : this.parameters
        };
    }

    /**
     * zod 스키마를 JSON 스키마로 변환
     * 
     * @private
     * @method zodToJsonSchema
     * @description
     * zod 스키마 객체를 JSON 스키마 형식으로 변환합니다.
     * 
     * @param {z.ZodObject<any>} schema - zod 스키마 객체
     * @returns {FunctionSchema['parameters']} JSON 스키마
     */
    private zodToJsonSchema(schema: z.ZodObject<any>): FunctionSchema['parameters'] {
        // 이미 구현된 zodToJsonSchema 함수를 재사용
        const jsonSchema: FunctionSchema['parameters'] = {
            type: 'object',
            properties: {}
        };

        const shape = schema.shape;

        // Zod 스키마를 JSON 스키마 형식으로 변환
        for (const [key, zodType] of Object.entries(shape)) {
            jsonSchema.properties[key] = {
                type: this.getSchemaType(zodType as z.ZodTypeAny),
                description: this.getZodDescription(zodType as z.ZodTypeAny) || undefined
            };

            // 열거형 값이 있는 경우 추가
            if ((zodType as any)._def.values) {
                jsonSchema.properties[key].enum = (zodType as any)._def.values;
            }
        }

        // 필수 필드 추가
        jsonSchema.required = Object.entries(shape)
            .filter(([_, zodType]) => !this.isOptionalType(zodType as z.ZodTypeAny))
            .map(([key]) => key);

        if (jsonSchema.required?.length === 0) {
            delete jsonSchema.required;
        }

        return jsonSchema;
    }

    /**
     * 문자열 표현 생성
     * 
     * @method toString
     * @description
     * 도구의 문자열 표현을 반환합니다.
     * 
     * @returns {string} 도구의 문자열 표현
     */
    toString(): string {
        return `Tool(name=${this.name}, category=${this.category || 'none'}, version=${this.version || 'none'})`;
    }

    /**
     * zod 타입에서 설명 추출
     * @param zodType zod 타입
     * @returns 설명 문자열
     */
    private getZodDescription(zodType: z.ZodTypeAny): string | undefined {
        // zod 타입의 메타데이터에서 설명을 추출
        const description = (zodType as any)._def.description;
        if (description) return description;

        // 내부 타입이 있는 경우 재귀적으로 설명 추출
        if (zodType instanceof z.ZodOptional || zodType instanceof z.ZodNullable) {
            return this.getZodDescription((zodType as any)._def.innerType);
        }

        return undefined;
    }

    /**
     * Zod 스키마 타입을 JSON 스키마 타입으로 변환
     */
    private getSchemaType(schema: z.ZodTypeAny): string {
        if (schema instanceof z.ZodString) {
            return 'string';
        } else if (schema instanceof z.ZodNumber) {
            return 'number';
        } else if (schema instanceof z.ZodBoolean) {
            return 'boolean';
        } else if (schema instanceof z.ZodArray) {
            return 'array';
        } else if (schema instanceof z.ZodObject) {
            return 'object';
        } else if (schema instanceof z.ZodEnum) {
            return 'string';
        } else if (schema instanceof z.ZodOptional) {
            return this.getSchemaType((schema as any)._def.innerType);
        } else {
            return 'string';
        }
    }

    /**
     * zod 타입이 옵셔널인지 확인
     * @param zodType zod 타입
     * @returns 옵셔널 여부
     */
    private isOptionalType(zodType: z.ZodTypeAny): boolean {
        return zodType instanceof z.ZodOptional ||
            (zodType instanceof z.ZodDefault);
    }

    /**
     * 도구 생성 헬퍼 메소드
     * 
     * @static
     * @method create
     * @description
     * 도구 인스턴스를 빠르게 생성하는 헬퍼 메소드입니다.
     * 
     * @param {AdvancedToolOptions<TParams, TResult>} options - 도구 옵션
     * @returns {Tool<TParams, TResult>} 도구 인스턴스
     */
    static create<TParams = any, TResult = any>(
        options: AdvancedToolOptions<TParams, TResult>
    ): Tool<TParams, TResult> {
        return new Tool<TParams, TResult>(options);
    }
}

/**
 * 간단한 도구 클래스
 */
export class SimpleTool implements ToolInterface {
    name: string;
    description?: string;
    schema: z.ZodObject<any>;

    private _execute: (args: any) => Promise<any>;

    constructor(options: SimpleToolOptions) {
        this.name = options.name;
        this.description = options.description;
        this.schema = options.schema;
        this._execute = options.execute;
    }

    /**
     * 도구 실행 함수
     */
    async execute(args: any): Promise<any> {
        // 스키마 검증
        const validatedArgs = this.schema.parse(args);
        return await this._execute(validatedArgs);
    }

    /**
     * 함수 정의로 변환
     */
    toFunctionDefinition(): FunctionDefinition {
        const shape = this.schema.shape;
        const properties: Record<string, any> = {};

        // Zod 스키마를 JSON 스키마 형식으로 변환
        for (const [key, schema] of Object.entries(shape)) {
            properties[key] = {
                type: this.getSchemaType(schema as z.ZodTypeAny),
                description: (schema as any)._def.description || undefined
            };

            // 열거형 값이 있는 경우 추가
            if ((schema as any)._def.values) {
                properties[key].enum = (schema as any)._def.values;
            }
        }

        return {
            name: this.name,
            description: this.description,
            parameters: {
                type: 'object',
                properties
            }
        };
    }

    /**
     * Zod 스키마 타입을 JSON 스키마 타입으로 변환
     */
    private getSchemaType(schema: z.ZodTypeAny): string {
        if (schema instanceof z.ZodString) {
            return 'string';
        } else if (schema instanceof z.ZodNumber) {
            return 'number';
        } else if (schema instanceof z.ZodBoolean) {
            return 'boolean';
        } else if (schema instanceof z.ZodArray) {
            return 'array';
        } else if (schema instanceof z.ZodObject) {
            return 'object';
        } else if (schema instanceof z.ZodEnum) {
            return 'string';
        } else {
            return 'string';
        }
    }
}

/**
 * 도구 레지스트리
 */
export class ToolRegistry {
    private tools: Map<string, ToolInterface> = new Map();

    /**
     * 도구 등록
     */
    register(tool: ToolInterface): void {
        this.tools.set(tool.name, tool);
    }

    /**
     * 도구 이름으로 도구 가져오기
     */
    getTool(name: string): ToolInterface | undefined {
        return this.tools.get(name);
    }

    /**
     * 모든 도구의 함수 정의 가져오기
     */
    getFunctionDefinitions(): FunctionDefinition[] {
        return Array.from(this.tools.values()).map(tool => tool.toFunctionDefinition());
    }

    /**
     * 도구 실행
     */
    async execute(name: string, args: Record<string, any>): Promise<any> {
        const tool = this.tools.get(name);

        if (!tool) {
            throw new Error(`도구 '${name}'가 등록되지 않았습니다`);
        }

        return await tool.execute(args);
    }
} 