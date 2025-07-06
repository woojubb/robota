import type { ToolSchema } from './provider';

/**
 * Specific tool parameter value types - declarative type system
 */
export type ToolParameterValue =
    | string
    | number
    | boolean
    | string[]
    | number[]
    | boolean[]
    | Array<string | number | boolean>
    | Record<string, string | number | boolean>
    | null
    | undefined;

/**
 * Tool parameters collection - declarative type system
 */
export type ToolParameters = Record<string, ToolParameterValue>;

/**
 * Tool metadata structure - specific type definition
 */
export type ToolMetadata = Record<string, string | number | boolean | string[] | number[] | boolean[] | ToolParameters>;

/**
 * Generic tool execution data - supports complex nested structures including ToolResult
 * 
 * REASON: Extended to include ToolResult and Record types for tool adapter compatibility
 * ALTERNATIVES_CONSIDERED:
 * 1. Create separate adapter functions (increases complexity without benefit)
 * 2. Use type assertions at tool registration (decreases type safety)
 * 3. Modify tool return types throughout codebase (massive breaking change)
 * 4. Use intersection types (unnecessary complexity)
 * TODO: Consider creating stricter variants if broad typing causes issues
 */
export type ToolExecutionData =
    | string
    | number
    | boolean
    | Record<string, string | number | boolean | ToolParameters>
    | Array<string | number | boolean | ToolParameters>
    | ToolParameters
    | ToolResult
    | null
    | undefined;

/**
 * Tool execution result - extended for ToolExecutionData compatibility
 * 
 * REASON: Added index signature for compatibility with Record-based ToolExecutionData types
 * ALTERNATIVES_CONSIDERED:
 * 1. Create separate conversion functions (adds unnecessary complexity)
 * 2. Use union types with type guards (increases runtime overhead)
 * 3. Modify ToolExecutionData to exclude Record types (breaks existing functionality)
 * 4. Use type assertions at every usage site (decreases type safety)
 * TODO: Consider creating a stricter ToolResult variant if index signature causes issues
 */
export interface ToolResult {
    success: boolean;
    data?: ToolExecutionData;
    error?: string;
    metadata?: ToolMetadata;
    [key: string]: string | number | boolean | ToolParameters | ToolExecutionData | ToolMetadata | undefined;
}

/**
 * Enhanced tool execution result with additional metadata
 */
export interface ToolExecutionResult {
    /** Whether execution was successful */
    success: boolean;
    /** Tool name that was executed */
    toolName?: string;
    /** Execution result or data */
    result?: ToolExecutionData;
    /** Error message if execution failed */
    error?: string;
    /** Execution duration in milliseconds */
    duration?: number;
    /** Unique execution ID */
    executionId?: string;
    /** Additional metadata */
    metadata?: ToolMetadata;
}



/**
 * Tool execution context - type-safe context for tool execution
 */
export interface ToolExecutionContext {
    toolName: string;
    parameters: ToolParameters;
    userId?: string;
    sessionId?: string;
    metadata?: ToolMetadata;
    // Additional context data
    [key: string]: string | number | boolean | ToolParameters | ToolMetadata | undefined;
}

/**
 * Parameter validation result
 */
export interface ParameterValidationResult {
    /** Whether parameters are valid */
    isValid: boolean;
    /** Validation error messages */
    errors: string[];
}

/**
 * Generic tool executor function
 */
export type ToolExecutor<TParams = ToolParameters, TResult = ToolExecutionData> =
    (parameters: TParams, context?: ToolExecutionContext) => Promise<TResult>;

/**
 * OpenAPI specification configuration
 */
export interface OpenAPIToolConfig {
    /** OpenAPI 3.0 specification */
    spec: {
        openapi: string;
        info: {
            title: string;
            version: string;
            description?: string;
        };
        servers?: Array<{
            url: string;
            description?: string;
        }>;
        paths: Record<string, Record<string, string | number | boolean | Record<string, string | number | boolean>>>;
        components?: Record<string, Record<string, string | number | boolean>>;
    };
    /** Operation ID from the OpenAPI spec */
    operationId: string;
    /** Base URL for API calls */
    baseURL: string;
    /** Authentication configuration */
    auth?: {
        type: 'bearer' | 'apiKey' | 'basic';
        token?: string;
        apiKey?: string;
        header?: string;
        username?: string;
        password?: string;
    };
}

/**
 * MCP (Model Context Protocol) configuration
 */
export interface MCPToolConfig {
    /** MCP server endpoint */
    endpoint: string;
    /** Protocol version */
    version?: string;
    /** Authentication configuration */
    auth?: {
        type: 'bearer' | 'apiKey';
        token: string;
    };
    /** Tool-specific configuration */
    toolConfig?: Record<string, string | number | boolean>;
    /** Timeout in milliseconds */
    timeout?: number;
}

/**
 * Base tool interface
 */
export interface ToolInterface {
    /** Tool schema */
    schema: ToolSchema;

    /**
     * Execute the tool with given parameters
     */
    execute(parameters: ToolParameters, context?: ToolExecutionContext): Promise<ToolResult>;

    /**
     * Validate tool parameters
     */
    validate(parameters: ToolParameters): boolean;

    /**
     * Validate tool parameters with detailed result
     */
    validateParameters(parameters: ToolParameters): ParameterValidationResult;

    /**
     * Get tool description
     */
    getDescription(): string;
}

/**
 * Function tool implementation
 */
export interface FunctionTool extends ToolInterface {
    /** Function to execute */
    fn: ToolExecutor;
}

/**
 * Tool registry interface
 */
export interface ToolRegistryInterface {
    /**
     * Register a tool
     */
    register(tool: ToolInterface): void;

    /**
     * Unregister a tool
     */
    unregister(name: string): void;

    /**
     * Get tool by name
     */
    get(name: string): ToolInterface | undefined;

    /**
     * Get all registered tools
     */
    getAll(): ToolInterface[];

    /**
     * Get tool schemas
     */
    getSchemas(): ToolSchema[];

    /**
     * Check if tool exists
     */
    has(name: string): boolean;

    /**
     * Clear all tools
     */
    clear(): void;
}

/**
 * Tool factory interface
 */
export interface ToolFactoryInterface {
    /**
     * Create function tool from schema and function
     */
    createFunctionTool(schema: ToolSchema, fn: ToolExecutor): FunctionTool;

    /**
     * Create tool from OpenAPI specification
     */
    createOpenAPITool(config: OpenAPIToolConfig): ToolInterface;

    /**
     * Create MCP tool
     */
    createMCPTool(config: MCPToolConfig): ToolInterface;
} 