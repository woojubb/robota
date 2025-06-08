import { BaseToolProvider, type ToolProvider } from './tool-provider';
import type { FunctionSchema } from './types';

/**
 * OpenAPI 도구 제공자 옵션
 */
export interface OpenAPIToolProviderOptions {
    /** OpenAPI 스펙 객체 또는 URL */
    openApiSpec: any;
    /** 기본 URL 설정 */
    baseUrl?: string;
    /** 로거 함수 (선택사항) */
    logger?: (message: string, context?: Record<string, any>) => void;
}

/**
 * OpenAPI 기반 도구 제공자 클래스
 */
export class OpenAPIToolProvider extends BaseToolProvider {
    private openApiSpec: any;
    private readonly baseUrl?: string;
    public functions?: FunctionSchema[];

    constructor(options: OpenAPIToolProviderOptions) {
        super({ logger: options.logger });
        this.openApiSpec = options.openApiSpec;
        this.baseUrl = options.baseUrl;
    }

    /**
     * OpenAPI 스펙을 함수 목록으로 변환
     */
    private convertOpenAPIToFunctions(spec: any): FunctionSchema[] {
        const functions: FunctionSchema[] = [];

        // OpenAPI paths와 methods를 함수로 변환
        for (const path in spec.paths) {
            for (const method in spec.paths[path]) {
                const operation = spec.paths[path][method];
                const functionName = operation.operationId || `${method}${path.replace(/\//g, '_')}`;

                // 파라미터 생성
                const parameters: Record<string, any> = {};
                const required: string[] = [];

                // path, query, body 파라미터 처리
                if (operation.parameters) {
                    for (const param of operation.parameters) {
                        parameters[param.name] = {
                            type: param.schema?.type || 'string',
                            description: param.description || `${param.name} parameter`
                        };

                        if (param.required) {
                            required.push(param.name);
                        }
                    }
                }

                // request body 처리
                if (operation.requestBody?.content?.['application/json']?.schema) {
                    const schema = operation.requestBody.content['application/json'].schema;
                    if (schema.properties) {
                        for (const propName in schema.properties) {
                            parameters[propName] = {
                                type: schema.properties[propName].type || 'string',
                                description: schema.properties[propName].description || `${propName} property`
                            };
                        }

                        if (schema.required) {
                            required.push(...schema.required);
                        }
                    }
                }

                functions.push({
                    name: functionName,
                    description: operation.summary || operation.description || `${method.toUpperCase()} ${path}`,
                    parameters: {
                        type: 'object',
                        properties: parameters,
                        required: required.length > 0 ? required : undefined
                    }
                });
            }
        }

        return functions;
    }

    /**
     * OpenAPI 스펙을 초기화합니다 (지연 로딩)
     */
    private async initializeSpec(): Promise<void> {
        if (this.functions) return; // 이미 초기화됨

        try {
            // OpenAPI 스펙이 URL인 경우 가져오기
            if (typeof this.openApiSpec === 'string') {
                const response = await fetch(this.openApiSpec);
                if (!response.ok) {
                    throw new Error(`OpenAPI 스펙을 가져올 수 없습니다: ${response.status} ${response.statusText}`);
                }
                this.openApiSpec = await response.json();
            }

            // 함수 목록 생성
            this.functions = this.convertOpenAPIToFunctions(this.openApiSpec);
        } catch (error) {
            throw new Error(`OpenAPI 스펙 초기화 실패: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 도구 호출 구현
     */
    async callTool(toolName: string, parameters: Record<string, any>): Promise<any> {
        // 지연 초기화
        await this.initializeSpec();

        return this.executeToolSafely(toolName, parameters, async () => {
            // API 호출 로직 구현
            const baseUrl = this.baseUrl || '';
            const url = `${baseUrl}/${toolName}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(parameters)
            });

            if (!response.ok) {
                throw new Error(`API 호출 실패: ${response.status} ${response.statusText}`);
            }

            return await response.json();
        });
    }

    /**
     * 사용 가능한 도구 목록 반환 (오버라이드)
     */
    getAvailableTools(): string[] {
        if (!this.functions) {
            // 아직 초기화되지 않은 경우 빈 배열 반환
            return [];
        }
        return super.getAvailableTools();
    }

    /**
     * 특정 도구가 존재하는지 확인 (오버라이드)
     */
    hasTool(toolName: string): boolean {
        if (!this.functions) {
            // 아직 초기화되지 않은 경우 false 반환
            return false;
        }
        return super.hasTool(toolName);
    }
}

/**
 * OpenAPI 스펙을 기반으로 도구 제공자를 생성합니다.
 * 
 * @param openApiSpec OpenAPI 스펙 객체 또는 URL
 * @param options 기본 URL 설정
 * @returns OpenAPI 기반 도구 제공자
 */
export function createOpenAPIToolProvider(openApiSpec: any, options?: { baseUrl?: string }): ToolProvider {
    return new OpenAPIToolProvider({
        openApiSpec,
        baseUrl: options?.baseUrl,
    });
} 