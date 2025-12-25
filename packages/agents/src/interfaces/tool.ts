import type { IToolSchema } from './provider';
import type { IEventService, IOwnerPathSegment } from './event-service';
import type { TContextData, TLoggerData, TToolParameterValue, TToolParameters, TToolResultData, TUniversalValue } from './types';

// Re-export canonical tool parameter types from the shared "types" axis.
export type { TToolParameterValue, TToolParameters } from './types';

export type TToolContextExtensionValue =
    | TUniversalValue
    | Date
    | Error
    | TLoggerData
    | TContextData
    | TToolParameters
    | TToolResultData
    | TToolMetadata;

/**
 * Tool metadata structure - specific type definition
 */
export type TToolMetadata = Record<string, string | number | boolean | string[] | number[] | boolean[] | TToolParameters>;

/**
 * Tool execution data - domain payload for tool results.
 *
 * IMPORTANT:
 * - This must support structured tool outputs without resorting to `any`.
 * - Prefer `ToolResultData` (derived from the canonical `UniversalValue` axis).
 */
export type TToolExecutionData = TToolResultData;

/**
 * Tool execution result - extended for ToolExecutionData compatibility
 */
export interface IToolResult {
    success: boolean;
    data?: TToolExecutionData;
    error?: string;
    metadata?: TToolMetadata;
    [key: string]: TToolContextExtensionValue | undefined;
}

/**
 * Enhanced tool execution result with additional metadata
 */
export interface IToolExecutionResult {
    /** Whether execution was successful */
    success: boolean;
    /** Tool name that was executed */
    toolName?: string;
    /** Execution result or data */
    result?: TToolExecutionData;
    /** Error message if execution failed */
    error?: string;
    /** Execution duration in milliseconds */
    duration?: number;
    /** Unique execution ID */
    executionId?: string;
    /** Additional metadata */
    metadata?: TToolMetadata;
}



/**
 * Tool execution context - type-safe context for tool execution
 * Enhanced with hierarchical execution tracking support
 */
// Align Tool ownerPath segments with the canonical ownerPath segment type.
export type TToolOwnerPathSegment = IOwnerPathSegment;

export interface IToolExecutionContext {
    toolName: string;
    parameters: TToolParameters;
    executionId?: string; // Tool execution ID (typically tool call ID)
    userId?: string;
    sessionId?: string;
    metadata?: TToolMetadata;

    // 🆕 Hierarchical execution tracking fields (all optional for backward compatibility)

    /** Parent execution ID for hierarchical tool execution tracking */
    parentExecutionId?: string;

    /** Root execution ID (Team/Agent level) for complete execution tree tracking */
    rootExecutionId?: string;

    /** Execution depth level (0: Team, 1: Agent, 2: Tool, etc.) */
    executionLevel?: number;

    /** Execution path array showing the complete execution hierarchy */
    executionPath?: string[];

    /** Real-time execution data for accurate tracking (no simulation) */
    realTimeData?: {
        /** Actual execution start time */
        startTime: Date;
        /** Actual input parameters passed to the tool */
        actualParameters: TToolParameters;
        /** Tool-provided estimated duration (optional) */
        estimatedDuration?: number;
    };

    /**
     * Additional tool execution context extensions.
     *
     * IMPORTANT:
     * - Avoid ad-hoc top-level fields to keep the contract stable.
     * - Use this map for forward-compatible extra data with constrained value types.
     */
    extensions?: Record<string, TToolContextExtensionValue>;

    /** Owner context propagated from EventService */
    ownerType?: string;
    ownerId?: string;
    ownerPath?: TToolOwnerPathSegment[];
    sourceId?: string;

    /**
     * Tool-call scoped EventService instance.
     * Caller (ExecutionService/ToolExecutionService) is responsible for providing
     * an ownerPath-bound EventService for this tool call.
     */
    eventService?: IEventService;

    /**
     * Unbound base EventService instance.
     *
     * Required when a tool needs to create another owner-bound EventService
     * for a different owner (e.g., creating an agent from a tool call).
     *
     * NOTE: Do not wrap an already owner-bound EventService to bind a different owner.
     * Owner-bound instances must not be layered across different owners.
     */
    baseEventService?: IEventService;
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
export type ToolExecutor<TParams = TToolParameters, TResult = TToolExecutionData> =
    (parameters: TParams, context?: IToolExecutionContext) => Promise<TResult>;

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
    schema: IToolSchema;

    /**
     * Execute the tool with given parameters
     */
    execute(parameters: TToolParameters, context?: IToolExecutionContext): Promise<IToolResult>;

    /**
     * Validate tool parameters
     */
    validate(parameters: TToolParameters): boolean;

    /**
     * Validate tool parameters with detailed result
     */
    validateParameters(parameters: TToolParameters): ParameterValidationResult;

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
    getSchemas(): IToolSchema[];

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
    createFunctionTool(schema: IToolSchema, fn: ToolExecutor): FunctionTool;

    /**
     * Create tool from OpenAPI specification
     */
    createOpenAPITool(config: OpenAPIToolConfig): ToolInterface;

    /**
     * Create MCP tool
     */
    createMCPTool(config: MCPToolConfig): ToolInterface;
} 