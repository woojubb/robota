import { ToolProvider } from './tool-provider';
import type { FunctionSchema } from './types';

/**
 * OpenAPI 명세를 기반으로 도구 제공자 생성
 * 
 * @param openApiSpec OpenAPI 명세 객체 또는 URL
 * @param options 기본 URL 설정
 * @returns OpenAPI 기반 도구 제공자
 */
export function createOpenAPIToolProvider(openApiSpec: any, options?: { baseUrl?: string }): ToolProvider {
    // OpenAPI 명세를 함수로 변환하는 로직
    const convertOpenAPIToFunctions = (spec: any) => {
        const functions: FunctionSchema[] = [];

        // OpenAPI 경로 및 메서드를 함수로 변환
        for (const path in spec.paths) {
            for (const method in spec.paths[path]) {
                const operation = spec.paths[path][method];
                const functionName = operation.operationId || `${method}${path.replace(/\//g, '_')}`;

                // 파라미터 생성
                const parameters: Record<string, any> = {};
                const required: string[] = [];

                // 경로, 쿼리, 바디 파라미터 처리
                if (operation.parameters) {
                    for (const param of operation.parameters) {
                        parameters[param.name] = {
                            type: param.schema?.type || 'string',
                            description: param.description || `${param.name} 파라미터`
                        };

                        if (param.required) {
                            required.push(param.name);
                        }
                    }
                }

                // 요청 바디 처리
                if (operation.requestBody?.content?.['application/json']?.schema) {
                    const schema = operation.requestBody.content['application/json'].schema;
                    if (schema.properties) {
                        for (const propName in schema.properties) {
                            parameters[propName] = {
                                type: schema.properties[propName].type || 'string',
                                description: schema.properties[propName].description || `${propName} 속성`
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
    };

    // 함수 목록 (게으른 초기화)
    let apiFunctions: FunctionSchema[] | null = null;
    // OpenAPI 스펙 (게으른 초기화)
    let apiSpec: any = null;

    // 도구 제공자 객체 생성
    const provider: ToolProvider = {
        // 도구 호출 구현
        async callTool(toolName, parameters) {
            try {
                // OpenAPI 명세 초기화 (필요시)
                if (!apiSpec) {
                    apiSpec = typeof openApiSpec === 'string'
                        ? await fetch(openApiSpec).then(res => res.json())
                        : openApiSpec;

                    apiFunctions = convertOpenAPIToFunctions(apiSpec);
                    provider.functions = apiFunctions;
                }

                // 도구 이름에 해당하는 API 엔드포인트 찾기
                const toolFunction = apiFunctions?.find(fn => fn.name === toolName);
                if (!toolFunction) {
                    throw new Error(`도구 '${toolName}'를 찾을 수 없습니다.`);
                }

                // 여기서 실제 API 호출 로직 구현
                // 예시: fetch를 사용한 API 호출
                const baseUrl = options?.baseUrl || '';
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
            } catch (error) {
                console.error(`도구 '${toolName}' 호출 중 오류:`, error);
                throw new Error(`도구 호출 실패: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    };

    return provider;
} 