import type { ToolProvider, FunctionSchema } from '@robota-sdk/tools';
import type { Logger } from '../interfaces/logger';

/**
 * Tool provider management class
 * Handles registration, invocation, and retrieval of Tool Providers.
 */
export class ToolProviderManager {
    private toolProviders: ToolProvider[] = [];
    private allowedFunctions?: string[];
    private logger: Logger;

    constructor(logger: Logger, allowedFunctions?: string[]) {
        this.logger = logger;
        this.allowedFunctions = allowedFunctions;
    }

    /**
     * Add a Tool Provider
     * 
     * @param toolProvider - Tool provider instance
     */
    addProvider(toolProvider: ToolProvider): void {
        this.toolProviders.push(toolProvider);
    }

    /**
     * Add multiple Tool Providers
     * 
     * @param toolProviders - Array of tool providers
     */
    addProviders(toolProviders: ToolProvider[]): void {
        this.toolProviders.push(...toolProviders);
    }

    /**
     * Set allowed function list
     * 
     * @param allowedFunctions - Array of allowed function names
     */
    setAllowedFunctions(allowedFunctions?: string[]): void {
        this.allowedFunctions = allowedFunctions;
    }

    /**
     * Call a tool
     * 
     * @param toolName - Name of the tool to call
     * @param parameters - Parameters to pass to the tool
     * @returns Tool call result
     */
    async callTool(toolName: string, parameters: Record<string, any>): Promise<any> {
        if (this.toolProviders.length === 0) {
            throw new Error('Tool providers are not configured.');
        }

        // Validate parameters before tool call
        if (this.allowedFunctions && !this.allowedFunctions.includes(toolName)) {
            throw new Error(`Tool '${toolName}' is not allowed.`);
        }

        // Find and call the tool from all toolProviders
        for (const toolProvider of this.toolProviders) {
            if (toolProvider.functions?.some(fn => fn.name === toolName)) {
                try {
                    const result = await toolProvider.callTool(toolName, parameters);
                    return result;
                } catch (error) {
                    this.logger.error(`Error calling tool '${toolName}':`, error);
                    throw new Error(`Tool call failed: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }

        throw new Error(`Tool '${toolName}' not found.`);
    }

    /**
     * Get list of available tools
     * 
     * @returns List of tool schemas
     */
    getAvailableTools(): FunctionSchema[] {
        return this.toolProviders.reduce((tools: FunctionSchema[], toolProvider) => {
            if (toolProvider.functions) {
                tools.push(...toolProvider.functions);
            }
            return tools;
        }, []);
    }

    /**
     * Get the number of registered Tool Providers
     */
    getProviderCount(): number {
        return this.toolProviders.length;
    }

    /**
     * Check if Tool Providers are registered
     */
    hasProviders(): boolean {
        return this.toolProviders.length > 0;
    }

    /**
     * Check if a specific tool is available
     * 
     * @param toolName - Name of the tool to check
     */
    hasTool(toolName: string): boolean {
        return this.toolProviders.some(toolProvider =>
            toolProvider.functions?.some(fn => fn.name === toolName)
        );
    }

    /**
     * Clean up resources for all tool providers
     */
    async close(): Promise<void> {
        for (const toolProvider of this.toolProviders) {
            const provider = toolProvider as any;
            if (provider.close && typeof provider.close === 'function') {
                try {
                    await provider.close();
                } catch (error) {
                    this.logger.error('Error closing tool provider:', error);
                }
            }
        }
    }
} 