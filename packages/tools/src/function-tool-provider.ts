/**
 * 함수 도구 제공자 모듈
 * 
 * @module function-tool-provider
 * @description
 * Zod 스키마를 기반으로 함수 도구를 제공하는 도구 제공자 구현을 제공합니다.
 */

import { z } from 'zod';
import type { ZodFunctionTool } from './zod-schema';
import { BaseToolProvider, type ToolProvider } from './tool-provider';
import type { FunctionSchema } from './types';
import { globalFunctionSchemaCache, type FunctionSchemaCacheManager } from './performance/cache-manager';

/**
 * Zod 스키마 기반 함수 도구 제공자 옵션
 */
export interface ZodFunctionToolProviderOptions {
    /** 도구 정의 객체 */
    tools: Record<string, ZodFunctionTool<z.ZodObject<z.ZodRawShape>>>;
    /** 로거 함수 (선택사항) */
    logger?: (message: string, context?: Record<string, any>) => void;
    /** 캐시 사용 여부 (기본값: true) */
    enableCache?: boolean;
    /** 커스텀 캐시 매니저 (선택사항) */
    cacheManager?: FunctionSchemaCacheManager;
}

/**
 * Zod 스키마 기반 함수 도구 제공자 클래스
 */
export class ZodFunctionToolProvider extends BaseToolProvider {
    private readonly tools: Record<string, ZodFunctionTool<z.ZodObject<z.ZodRawShape>>>;
    private _functions: FunctionSchema[] | null = null;
    private readonly enableCache: boolean;
    private readonly cacheManager: FunctionSchemaCacheManager;
    private readonly cacheKey: string;

    constructor(options: ZodFunctionToolProviderOptions) {
        super({ logger: options.logger });
        this.tools = options.tools;
        this.enableCache = options.enableCache !== false;
        this.cacheManager = options.cacheManager || globalFunctionSchemaCache;

        // 캐시 키 생성
        this.cacheKey = this.enableCache ?
            this.cacheManager.generateKey(this.tools) : '';
    }

    /**
     * 함수 스키마 목록 (지연 로딩 + 캐싱)
     */
    get functions(): FunctionSchema[] {
        if (this._functions) {
            return this._functions;
        }

        // 캐시에서 확인
        if (this.enableCache) {
            const cached = this.cacheManager.get(this.cacheKey);
            if (cached) {
                this._functions = cached;
                this.logDebug('함수 스키마를 캐시에서 로드했습니다.', {
                    toolCount: cached.length,
                    cacheKey: this.cacheKey
                });
                return this._functions;
            }
        }

        // 캐시에 없으면 변환 수행
        this._functions = this.convertToolsToFunctions();

        // 캐시에 저장
        if (this.enableCache) {
            this.cacheManager.set(this.cacheKey, this._functions);
            this.logDebug('함수 스키마를 캐시에 저장했습니다.', {
                toolCount: this._functions.length,
                cacheKey: this.cacheKey
            });
        }

        return this._functions;
    }

    /**
     * 도구 정의를 JSON 스키마로 변환
     */
    private convertToolsToFunctions(): FunctionSchema[] {
        const startTime = this.enableCache ? performance.now() : 0;

        const functions = Object.values(this.tools).map(tool => {
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

        if (this.enableCache) {
            const endTime = performance.now();
            this.logDebug('함수 스키마 변환 완료', {
                toolCount: functions.length,
                processingTime: `${(endTime - startTime).toFixed(2)}ms`
            });
        }

        return functions;
    }

    /**
     * 도구 호출 구현
     */
    async callTool(toolName: string, parameters: Record<string, unknown>): Promise<unknown> {
        return this.executeToolSafely(toolName, parameters, async () => {
            const tool = this.tools[toolName];

            // 추가 검증: tools 객체에서 직접 확인
            if (!tool) {
                throw new Error(`도구 정의를 찾을 수 없습니다.`);
            }

            // 도구 핸들러 호출
            return await tool.handler(parameters);
        });
    }

    /**
     * 특정 도구가 존재하는지 확인 (오버라이드)
     */
    hasTool(toolName: string): boolean {
        return toolName in this.tools;
    }

    /**
     * 캐시 통계 조회
     */
    getCacheStats() {
        if (!this.enableCache) {
            return null;
        }
        return this.cacheManager.getStats();
    }

    /**
     * 캐시 지우기
     */
    clearCache(): void {
        if (this.enableCache) {
            this.cacheManager.delete(this.cacheKey);
            this._functions = null;
            this.logDebug('함수 스키마 캐시를 삭제했습니다.', { cacheKey: this.cacheKey });
        }
    }

    /**
     * 디버그 로그 출력
     */
    private logDebug(message: string, context?: Record<string, any>): void {
        this.logError(`[ZodFunctionToolProvider] ${message}`, context);
    }
}

/**
 * Zod 스키마 기반 함수 도구 제공자를 생성합니다.
 * 
 * @param options - 함수 도구 제공자 옵션
 * @returns 도구 제공자 인스턴스 (ToolProvider 인터페이스 구현)
 * 
 * @see {@link ../../apps/examples/02-functions | Function Tool Examples}
 */
export function createZodFunctionToolProvider(options: ZodFunctionToolProviderOptions): ToolProvider {
    return new ZodFunctionToolProvider(options);
} 