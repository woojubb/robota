/**
 * Function tool provider module
 * 
 * @module function-tool-provider
 * @description
 * Provides tool provider implementation based on Zod schemas.
 */

import { z } from 'zod';
import type { ZodFunctionTool } from './zod-schema';
import { BaseToolProvider, type ToolProvider } from './tool-provider';
import type { FunctionSchema } from './types';
import { globalFunctionSchemaCache, type FunctionSchemaCacheManager } from './performance/cache-manager';

/**
 * Zod schema-based function tool provider options
 */
export interface ZodFunctionToolProviderOptions {
    /** Tool definition object */
    tools: Record<string, ZodFunctionTool<z.ZodObject<z.ZodRawShape>>>;
    /** Logger function (optional) */
    logger?: (message: string, context?: Record<string, any>) => void;
    /** Whether to use cache (default: true) */
    enableCache?: boolean;
    /** Custom cache manager (optional) */
    cacheManager?: FunctionSchemaCacheManager;
}

/**
 * Zod schema-based function tool provider class
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

        // Generate cache key
        this.cacheKey = this.enableCache ?
            this.cacheManager.generateKey(this.tools) : '';
    }

    /**
     * Function schema list (lazy loading + caching)
     */
    get functions(): FunctionSchema[] {
        if (this._functions) {
            return this._functions;
        }

        // Check cache
        if (this.enableCache) {
            const cached = this.cacheManager.get(this.cacheKey);
            if (cached) {
                this._functions = cached;
                this.logDebug('Loaded function schemas from cache.', {
                    toolCount: cached.length,
                    cacheKey: this.cacheKey
                });
                return this._functions;
            }
        }

        // Perform conversion if not in cache
        this._functions = this.convertToolsToFunctions();

        // Save to cache
        if (this.enableCache) {
            this.cacheManager.set(this.cacheKey, this._functions);
            this.logDebug('Saved function schemas to cache.', {
                toolCount: this._functions.length,
                cacheKey: this.cacheKey
            });
        }

        return this._functions;
    }

    /**
     * Convert tool definitions to JSON schema
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

            // Extract properties from Zod schema
            const shape = tool.parameters.shape || {};
            for (const propName in shape) {
                const prop = shape[propName];

                // Extract property type and description
                let type = 'string';
                if (prop._def.typeName === 'ZodNumber') type = 'number';
                if (prop._def.typeName === 'ZodBoolean') type = 'boolean';
                if (prop._def.typeName === 'ZodArray') type = 'array';
                if (prop._def.typeName === 'ZodObject') type = 'object';

                properties[propName] = {
                    type,
                    description: prop._def.description || `${propName} parameter`
                };

                // Add enum values if present
                if (prop._def.typeName === 'ZodEnum') {
                    properties[propName].enum = prop._def.values;
                }

                // Add to required array if not optional
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
            this.logDebug('Function schema conversion completed', {
                toolCount: functions.length,
                processingTime: `${(endTime - startTime).toFixed(2)}ms`
            });
        }

        return functions;
    }

    /**
     * Tool call implementation
     */
    async callTool(toolName: string, parameters: Record<string, unknown>): Promise<unknown> {
        return this.executeToolSafely(toolName, parameters, async () => {
            const tool = this.tools[toolName];

            // Additional validation: check directly from tools object
            if (!tool) {
                throw new Error(`Tool definition not found.`);
            }

            // Call tool handler
            return await tool.handler(parameters);
        });
    }

    /**
     * Check if specific tool exists (override)
     */
    hasTool(toolName: string): boolean {
        return toolName in this.tools;
    }

    /**
     * Get cache statistics
     */
    getCacheStats() {
        if (!this.enableCache) {
            return null;
        }
        return this.cacheManager.getStats();
    }

    /**
     * Clear cache
     */
    clearCache(): void {
        if (this.enableCache) {
            this.cacheManager.delete(this.cacheKey);
            this._functions = null;
            this.logDebug('Deleted function schema cache.', { cacheKey: this.cacheKey });
        }
    }

    /**
     * Output debug log
     */
    private logDebug(message: string, context?: Record<string, any>): void {
        this.logError(`[ZodFunctionToolProvider] ${message}`, context);
    }
}

/**
 * Creates a Zod schema-based function tool provider.
 * 
 * @param options - Function tool provider options
 * @returns Tool provider instance (implements ToolProvider interface)
 * 
 * @see {@link ../../apps/examples/02-functions | Function Tool Examples}
 */
export function createZodFunctionToolProvider(options: ZodFunctionToolProviderOptions): ToolProvider {
    return new ZodFunctionToolProvider(options);
} 