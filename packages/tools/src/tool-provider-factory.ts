/**
 * Tool Provider Factory
 * 
 * @module tool-provider-factory
 * @description
 * 다양한 종류의 tool provider들을 생성하고 관리하는 팩토리 클래스와 유틸리티 함수들을 제공합니다.
 */

import { z } from 'zod';
import type { ToolProvider } from './tool-provider';
import { ZodFunctionToolProvider, type ZodFunctionToolProviderOptions } from './function-tool-provider';
import { OpenAPIToolProvider, type OpenAPIToolProviderOptions } from './openapi-tool-provider';
import { MCPToolProvider, type MCPToolProviderOptions, type MCPClient } from './mcp-tool-provider';
import type { ZodFunctionTool } from './zod-schema';

/**
 * Tool Provider 타입 정의
 */
export type ToolProviderType = 'zod-function' | 'openapi' | 'mcp';

/**
 * Tool Provider 설정 옵션들
 */
export interface ToolProviderConfigs {
    'zod-function': ZodFunctionToolProviderOptions;
    'openapi': OpenAPIToolProviderOptions;
    'mcp': MCPToolProviderOptions;
}

/**
 * Tool Provider Factory 클래스
 * 
 * 다양한 타입의 tool provider들을 생성하고 관리합니다.
 */
export class ToolProviderFactory {
    private providers: Map<string, ToolProvider> = new Map();
    private logger?: (message: string, context?: Record<string, any>) => void;

    constructor(options?: { logger?: (message: string, context?: Record<string, any>) => void }) {
        this.logger = options?.logger;
    }

    /**
     * Zod Function Tool Provider 생성
     */
    createZodFunctionProvider(
        name: string,
        tools: Record<string, ZodFunctionTool<z.ZodObject<z.ZodRawShape>>>
    ): ToolProvider {
        const provider = new ZodFunctionToolProvider({
            tools,
            logger: this.logger
        });

        this.providers.set(name, provider);
        return provider;
    }

    /**
     * OpenAPI Tool Provider 생성
     */
    createOpenAPIProvider(
        name: string,
        openApiSpec: any,
        options?: { baseUrl?: string }
    ): ToolProvider {
        const provider = new OpenAPIToolProvider({
            openApiSpec,
            baseUrl: options?.baseUrl,
            logger: this.logger
        });

        this.providers.set(name, provider);
        return provider;
    }

    /**
     * MCP Tool Provider 생성
     */
    createMCPProvider(name: string, mcpClient: MCPClient): ToolProvider {
        const provider = new MCPToolProvider({
            mcpClient,
            logger: this.logger
        });

        this.providers.set(name, provider);
        return provider;
    }

    /**
     * 범용 Tool Provider 생성 메서드
     */
    createProvider<T extends ToolProviderType>(
        type: T,
        name: string,
        config: ToolProviderConfigs[T]
    ): ToolProvider {
        let provider: ToolProvider;

        switch (type) {
            case 'zod-function':
                provider = new ZodFunctionToolProvider(config as ZodFunctionToolProviderOptions);
                break;
            case 'openapi':
                provider = new OpenAPIToolProvider(config as OpenAPIToolProviderOptions);
                break;
            case 'mcp':
                provider = new MCPToolProvider(config as MCPToolProviderOptions);
                break;
            default:
                throw new Error(`지원하지 않는 tool provider 타입: ${type}`);
        }

        this.providers.set(name, provider);
        return provider;
    }

    /**
     * 등록된 Provider 가져오기
     */
    getProvider(name: string): ToolProvider | undefined {
        return this.providers.get(name);
    }

    /**
     * 모든 등록된 Provider 목록 가져오기
     */
    getAllProviders(): Record<string, ToolProvider> {
        return Object.fromEntries(this.providers.entries());
    }

    /**
     * Provider 제거
     */
    removeProvider(name: string): boolean {
        return this.providers.delete(name);
    }

    /**
     * 모든 Provider의 사용 가능한 도구 목록 통합 조회
     */
    getAllAvailableTools(): Record<string, string[]> {
        const result: Record<string, string[]> = {};

        for (const [name, provider] of this.providers.entries()) {
            result[name] = provider.getAvailableTools?.() || [];
        }

        return result;
    }

    /**
     * 특정 도구를 제공하는 Provider 찾기
     */
    findProviderForTool(toolName: string): { providerName: string; provider: ToolProvider } | undefined {
        for (const [name, provider] of this.providers.entries()) {
            if (provider.hasTool?.(toolName)) {
                return { providerName: name, provider };
            }
        }
        return undefined;
    }

    /**
     * 도구 호출 (자동으로 적절한 Provider 찾기)
     */
    async callTool(toolName: string, parameters: Record<string, any>): Promise<any> {
        const providerInfo = this.findProviderForTool(toolName);

        if (!providerInfo) {
            throw new Error(`도구 '${toolName}'을 제공하는 provider를 찾을 수 없습니다.`);
        }

        return await providerInfo.provider.callTool(toolName, parameters);
    }
}

/**
 * 전역 Tool Provider Factory 인스턴스 (싱글톤)
 */
let globalFactory: ToolProviderFactory | undefined;

/**
 * 전역 Tool Provider Factory 인스턴스 가져오기
 */
export function getGlobalToolProviderFactory(): ToolProviderFactory {
    if (!globalFactory) {
        globalFactory = new ToolProviderFactory();
    }
    return globalFactory;
}

/**
 * 팩토리를 통한 편의 함수들
 */

/**
 * Zod Function Tool Provider 생성 편의 함수 (팩토리 버전)
 */
export function createZodFunctionProvider(
    tools: Record<string, ZodFunctionTool<z.ZodObject<z.ZodRawShape>>>,
    options?: { logger?: (message: string, context?: Record<string, any>) => void }
): ToolProvider {
    return new ZodFunctionToolProvider({
        tools,
        logger: options?.logger
    });
}

/**
 * OpenAPI Tool Provider 생성 편의 함수 (팩토리 버전)
 */
export function createOpenAPIProvider(
    openApiSpec: any,
    options?: { baseUrl?: string; logger?: (message: string, context?: Record<string, any>) => void }
): ToolProvider {
    return new OpenAPIToolProvider({
        openApiSpec,
        baseUrl: options?.baseUrl,
        logger: options?.logger
    });
}

/**
 * MCP Tool Provider 생성 편의 함수 (팩토리 버전)
 */
export function createMCPProvider(
    mcpClient: MCPClient,
    options?: { logger?: (message: string, context?: Record<string, any>) => void }
): ToolProvider {
    return new MCPToolProvider({
        mcpClient,
        logger: options?.logger
    });
} 