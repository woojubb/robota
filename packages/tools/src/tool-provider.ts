import type { FunctionSchema } from './types';

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
} 