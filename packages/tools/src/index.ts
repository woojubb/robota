/**
 * @module @robota-sdk/tools
 * 
 * Tool library for Robota AI agents
 */

// Export types from types.ts
export type { FunctionSchema, FunctionDefinition, FunctionCallResult, FunctionCall } from './types';

// Export function utilities
export {
    createFunction,
    functionFromCallback,
    createFunctionSchema,
    createValidatedFunction,
    FunctionRegistry,
    type FunctionHandler,
    type ToolFunction,
    type FunctionOptions,
    type FunctionResult
} from './function';

// Export schema conversion utilities
export {
    zodToJsonSchema,
    convertZodTypeToJsonSchema,
    isOptionalType,
    isNullableType
} from './schema/zod-to-json';

/**
 * Tool execution result type
 */
export interface ToolResult<T = any> {
    /**
     * Whether tool execution was successful
     */
    success: boolean;

    /**
     * Tool execution result data
     */
    data?: T;

    /**
     * Error that occurred during tool execution
     */
    error?: string;

    /**
     * Additional metadata
     */
    metadata?: Record<string, any>;
}

/**
 * Tool parameter type
 */
export interface ToolParameter {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    description?: string;
    required?: boolean;
    defaultValue?: any;
}

/**
 * Tool interface
 */
export interface Tool<TInput = any, TOutput = any> {
    /**
     * Tool name
     */
    name: string;

    /**
     * Tool description
     */
    description?: string;

    /**
     * Tool parameter definitions
     */
    parameters?: ToolParameter[];

    /**
     * Tool execution function
     * 
     * @param input - Tool input parameters
     * @returns Execution result
     */
    execute: (input: TInput) => Promise<ToolResult<TOutput>>;
}

/**
 * Tool creation options
 */
export interface CreateToolOptions<TInput = any, TOutput = any> {
    /**
     * Tool name
     */
    name: string;

    /**
     * Tool description
     */
    description?: string;

    /**
     * Tool parameter definitions
     */
    parameters?: ToolParameter[];

    /**
     * Tool execution function
     */
    execute: (input: TInput) => Promise<TOutput | ToolResult<TOutput>>;
}

/**
 * Tool creation function
 * 
 * @param options - Tool creation options
 * @returns Created tool
 * 
 * @see {@link @examples/02-functions | Function Tool Examples}
 */
export function createTool<TInput = any, TOutput = any>(
    options: CreateToolOptions<TInput, TOutput>
): Tool<TInput, TOutput> {
    return {
        name: options.name,
        description: options.description,
        parameters: options.parameters,
        execute: async (input: TInput) => {
            try {
                const result = await options.execute(input);

                // Return as is if already in ToolResult format
                if (result && typeof result === 'object' && 'success' in result) {
                    return result as ToolResult<TOutput>;
                }

                // Wrap general result in ToolResult
                return {
                    success: true,
                    data: result
                };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                };
            }
        }
    };
}

/**
 * Tool registry class
 * 
 * Class for registering and managing multiple tools
 */
export class ToolRegistry {
    private tools: Map<string, Tool> = new Map();

    /**
     * Register a tool
     * 
     * @param tool - Tool to register
     */
    register(tool: Tool): ToolRegistry {
        this.tools.set(tool.name, tool);
        return this;
    }

    /**
     * Register multiple tools
     * 
     * @param tools - Array of tools to register
     */
    registerMany(tools: Tool[]): ToolRegistry {
        for (const tool of tools) {
            this.register(tool);
        }
        return this;
    }

    /**
     * Get a tool
     * 
     * @param name - Name of the tool to get
     * @returns Tool or undefined
     */
    getTool(name: string): Tool | undefined {
        return this.tools.get(name);
    }

    /**
     * Get all tools
     * 
     * @returns Array of all registered tools
     */
    getAllTools(): Tool[] {
        return Array.from(this.tools.values());
    }

    /**
     * Execute a tool
     * 
     * @param name - Name of the tool to execute
     * @param input - Tool input parameters
     * @returns Tool execution result
     */
    async executeTool<TInput = any, TOutput = any>(
        name: string,
        input: TInput
    ): Promise<ToolResult<TOutput>> {
        const tool = this.getTool(name) as Tool<TInput, TOutput>;

        if (!tool) {
            return {
                success: false,
                error: `Tool '${name}' not found`
            };
        }

        try {
            return await tool.execute(input);
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
}

// Zod related features export
export {
    zodFunctionToSchema,
    type ZodFunctionTool
} from './zod-schema';

export {
    createZodFunctionToolProvider,
    type ZodFunctionToolProviderOptions
} from './function-tool-provider';

// ToolProvider interface and base classes export
export {
    ToolProvider,
    BaseToolProvider,
    ToolProviderError,
    ToolNotFoundError,
    ToolExecutionError
} from './tool-provider';

// MCP related features export
export {
    createMcpToolProvider,
    type MCPClient,
    MCPToolProvider,
    type MCPToolProviderOptions
} from './mcp-tool-provider';

// OpenAPI related features export
export {
    createOpenAPIToolProvider,
    OpenAPIToolProvider,
    type OpenAPIToolProviderOptions
} from './openapi-tool-provider';

// Tool Provider Factory export
export {
    ToolProviderFactory,
    getGlobalToolProviderFactory,
    createZodFunctionProvider,
    createOpenAPIProvider,
    createMCPProvider,
    type ToolProviderType,
    type ToolProviderConfigs
} from './tool-provider-factory';

// Modern tool system export
export * from './tool';

// Performance optimization exports
export {
    CacheManager,
    FunctionSchemaCacheManager,
    globalFunctionSchemaCache,
    globalToolCache,
    CacheCleanupScheduler,
    globalCacheCleanupScheduler,
    type CacheItem,
    type CacheStats
} from './performance/cache-manager';

export {
    LazyLoader,
    ToolLazyLoader,
    globalToolLazyLoader,
    type LazyLoadable,
    type LazyLoadStats
} from './performance/lazy-loader';

export {
    ResourceManager,
    ToolProviderResourceManager,
    globalResourceManager,
    type ResourceInfo,
    type MemoryInfo,
    type ResourceStats,
    type ResourceType
} from './performance/resource-manager';

export {
    PerformanceMonitor,
    globalPerformanceMonitor,
    type PerformanceMetrics,
    type MemoryUsageMetrics,
    type ToolCallRecord,
    type PerformanceEventListener
} from './performance/performance-monitor'; 