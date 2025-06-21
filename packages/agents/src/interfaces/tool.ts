import type { ToolSchema } from './provider';

/**
 * Tool execution result
 */
export interface ToolResult {
    success: boolean;
    data?: any;
    error?: string;
    metadata?: Record<string, any>;
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
    result?: any;
    /** Error message if execution failed */
    error?: string;
    /** Execution duration in milliseconds */
    duration?: number;
    /** Unique execution ID */
    executionId?: string;
    /** Additional metadata */
    metadata?: Record<string, any>;
}

/**
 * Tool execution context
 */
export interface ToolExecutionContext {
    toolName: string;
    parameters: Record<string, any>;
    userId?: string;
    sessionId?: string;
    metadata?: Record<string, any>;
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
 * Base tool interface
 */
export interface ToolInterface {
    /** Tool schema */
    schema: ToolSchema;

    /**
     * Execute the tool with given parameters
     */
    execute(parameters: Record<string, any>, context?: ToolExecutionContext): Promise<ToolResult>;

    /**
     * Validate tool parameters
     */
    validate(parameters: Record<string, any>): boolean;

    /**
     * Validate tool parameters with detailed result
     */
    validateParameters(parameters: Record<string, any>): ParameterValidationResult;

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
    fn: (...args: any[]) => Promise<any>;
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
    createFunctionTool(schema: ToolSchema, fn: (...args: any[]) => Promise<any>): FunctionTool;

    /**
     * Create tool from OpenAPI specification
     */
    createOpenAPITool(spec: any): ToolInterface;

    /**
     * Create MCP tool
     */
    createMCPTool(config: any): ToolInterface;
} 