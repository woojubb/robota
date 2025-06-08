import type { FunctionSchema } from './types';
import { globalPerformanceMonitor } from './performance/performance-monitor';

/**
 * Tool Provider interface
 * 
 * Unified interface for various tool providers (MCP, OpenAPI, ZodFunction, etc.)
 * Tool providers enable AI models to call tools.
 */
export interface ToolProvider {
    /**
     * Call a tool. All tool providers must implement this interface.
     * 
     * @param toolName Name of the tool to call
     * @param parameters Parameters to pass to the tool
     * @returns Tool call result
     */
    callTool(toolName: string, parameters: Record<string, any>): Promise<any>;

    /**
     * List of all function schemas provided by the tool provider
     * Used when passing tool list to AI models.
     */
    functions?: FunctionSchema[];

    /**
     * Get available tool names
     * 
     * @returns Array of available tool names
     */
    getAvailableTools?(): string[];

    /**
     * Check if a tool exists
     * 
     * @param toolName Name of the tool to check
     * @returns True if tool exists, false otherwise
     */
    hasTool?(toolName: string): boolean;
}

/**
 * Tool Provider error types
 */
export class ToolProviderError extends Error {
    public readonly code: string;
    public readonly context?: Record<string, any>;

    constructor(message: string, code: string = 'TOOL_PROVIDER_ERROR', context?: Record<string, any>) {
        super(message);
        this.name = 'ToolProviderError';
        this.code = code;
        this.context = context;
    }
}

export class ToolNotFoundError extends ToolProviderError {
    constructor(toolName: string, availableTools?: string[]) {
        super(
            `Tool '${toolName}' not found.${availableTools ? ` Available tools: ${availableTools.join(', ')}` : ''}`,
            'TOOL_NOT_FOUND',
            { toolName, availableTools }
        );
    }
}

export class ToolExecutionError extends ToolProviderError {
    constructor(toolName: string, originalError: unknown) {
        const errorMessage = originalError instanceof Error ? originalError.message : String(originalError);
        super(
            `Tool '${toolName}' call failed: ${errorMessage}`,
            'TOOL_EXECUTION_ERROR',
            { toolName, originalError: errorMessage }
        );
    }
}

/**
 * Base Tool Provider abstract class
 * 
 * Provides common functionality for all tool providers.
 */
export abstract class BaseToolProvider implements ToolProvider {
    protected logger?: (message: string, context?: Record<string, any>) => void;

    constructor(options?: { logger?: (message: string, context?: Record<string, any>) => void }) {
        this.logger = options?.logger;
    }

    /**
     * Abstract method to be implemented by concrete providers
     */
    abstract callTool(toolName: string, parameters: Record<string, any>): Promise<any>;

    /**
     * Abstract property to be implemented by concrete providers
     */
    abstract functions?: FunctionSchema[];

    /**
     * Get available tool names from functions list
     */
    getAvailableTools(): string[] {
        return this.functions?.map(f => f.name) || [];
    }

    /**
     * Check if a tool exists
     */
    hasTool(toolName: string): boolean {
        return this.getAvailableTools().includes(toolName);
    }

    /**
     * Validate tool existence before calling
     */
    protected validateToolExists(toolName: string): void {
        if (!this.hasTool(toolName)) {
            throw new ToolNotFoundError(toolName, this.getAvailableTools());
        }
    }

    /**
     * Log error with context
     */
    protected logError(message: string, context?: Record<string, any>): void {
        if (this.logger) {
            this.logger(message, context);
        } else {
            console.error(message, context);
        }
    }

    /**
     * Handle tool execution with common error handling and performance monitoring
     */
    protected async executeToolSafely<T>(
        toolName: string,
        parameters: Record<string, any>,
        executor: () => Promise<T>
    ): Promise<T> {
        // Start performance monitoring
        const callId = globalPerformanceMonitor.startToolCall(toolName, parameters);

        try {
            this.validateToolExists(toolName);
            this.logError(`Tool '${toolName}' execution started`, { toolName, parameters });

            const result = await executor();

            this.logError(`Tool '${toolName}' execution succeeded`, { toolName, result });

            // Record success
            globalPerformanceMonitor.endToolCall(callId, true, result);

            return result;
        } catch (error) {
            this.logError(`Error occurred while calling tool '${toolName}'`, { toolName, parameters, error });

            const errorMessage = error instanceof Error ? error.message : String(error);

            // Record failure
            globalPerformanceMonitor.endToolCall(callId, false, undefined, errorMessage);

            if (error instanceof ToolProviderError) {
                throw error;
            }

            throw new ToolExecutionError(toolName, error);
        }
    }
} 