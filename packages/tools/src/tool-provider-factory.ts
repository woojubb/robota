/**
 * Tool Provider Factory
 * 
 * @module tool-provider-factory
 * @description
 * Provides factory class and utility functions for creating and managing various types of tool providers.
 */

import { z } from 'zod';
import type { ToolProvider } from './tool-provider';
import { ZodFunctionToolProvider, type ZodFunctionToolProviderOptions } from './function-tool-provider';
import { OpenAPIToolProvider, type OpenAPIToolProviderOptions } from './openapi-tool-provider';
import { MCPToolProvider, type MCPToolProviderOptions, type MCPClient } from './mcp-tool-provider';
import type { ZodFunctionTool } from './zod-schema';

/**
 * Tool Provider type definition
 */
export type ToolProviderType = 'zod-function' | 'openapi' | 'mcp';

/**
 * Tool Provider configuration options
 */
export interface ToolProviderConfigs {
    'zod-function': ZodFunctionToolProviderOptions;
    'openapi': OpenAPIToolProviderOptions;
    'mcp': MCPToolProviderOptions;
}

/**
 * Tool Provider Factory class
 * 
 * Creates and manages various types of tool providers.
 */
export class ToolProviderFactory {
    private providers: Map<string, ToolProvider> = new Map();
    private logger?: (message: string, context?: Record<string, any>) => void;

    constructor(options?: { logger?: (message: string, context?: Record<string, any>) => void }) {
        this.logger = options?.logger;
    }

    /**
     * Create Zod Function Tool Provider
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
     * Create OpenAPI Tool Provider
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
     * Create MCP Tool Provider
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
     * Generic Tool Provider creation method
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
                throw new Error(`Unsupported tool provider type: ${type}`);
        }

        this.providers.set(name, provider);
        return provider;
    }

    /**
     * Get registered Provider
     */
    getProvider(name: string): ToolProvider | undefined {
        return this.providers.get(name);
    }

    /**
     * Get all registered Provider list
     */
    getAllProviders(): Record<string, ToolProvider> {
        return Object.fromEntries(this.providers.entries());
    }

    /**
     * Remove Provider
     */
    removeProvider(name: string): boolean {
        return this.providers.delete(name);
    }

    /**
     * Get integrated list of available tools from all Providers
     */
    getAllAvailableTools(): Record<string, string[]> {
        const result: Record<string, string[]> = {};

        for (const [name, provider] of this.providers.entries()) {
            result[name] = provider.getAvailableTools?.() || [];
        }

        return result;
    }

    /**
     * Find Provider that provides specific tool
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
     * Tool call (automatically find appropriate Provider)
     */
    async callTool(toolName: string, parameters: Record<string, any>): Promise<any> {
        const providerInfo = this.findProviderForTool(toolName);

        if (!providerInfo) {
            throw new Error(`Cannot find provider that provides tool '${toolName}'.`);
        }

        return await providerInfo.provider.callTool(toolName, parameters);
    }
}

/**
 * Global Tool Provider Factory instance (singleton)
 */
let globalFactory: ToolProviderFactory | undefined;

/**
 * Get global Tool Provider Factory instance
 */
export function getGlobalToolProviderFactory(): ToolProviderFactory {
    if (!globalFactory) {
        globalFactory = new ToolProviderFactory();
    }
    return globalFactory;
}

/**
 * Convenience functions through factory
 */

/**
 * Zod Function Tool Provider creation convenience function (factory version)
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
 * OpenAPI Tool Provider creation convenience function (factory version)
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
 * MCP Tool Provider creation convenience function (factory version)
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