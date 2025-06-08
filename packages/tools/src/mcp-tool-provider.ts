import { BaseToolProvider, type ToolProvider } from './tool-provider';
import type { FunctionSchema } from './types';

/**
 * MCP client interface
 * Compatible with Client from @modelcontextprotocol/sdk
 */
export interface MCPClient {
    // Essential methods of MCP client
    chat: (options: any) => Promise<any>;
    stream: (options: any) => AsyncIterable<any>;
    // Tool call method
    callTool: (toolName: string, parameters: Record<string, any>) => Promise<any>;
    // Tool listing method (optional)
    listTools?: () => Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: any }> }>;
    // Additional methods...
}

/**
 * MCP tool provider options
 */
export interface MCPToolProviderOptions {
    /** MCP client instance */
    mcpClient: MCPClient;
    /** Logger function (optional) */
    logger?: (message: string, context?: Record<string, any>) => void;
}

/**
 * MCP (Model Context Protocol) based tool provider class
 */
export class MCPToolProvider extends BaseToolProvider {
    private readonly mcpClient: MCPClient;
    public functions?: FunctionSchema[];

    constructor(options: MCPToolProviderOptions) {
        super({ logger: options.logger });
        this.mcpClient = options.mcpClient;
        this.initializeFunctions();
    }

    /**
     * Get tool list from MCP client and convert to function schema
     */
    private async initializeFunctions(): Promise<void> {
        try {
            if (this.mcpClient.listTools) {
                const result = await this.mcpClient.listTools();
                this.functions = result.tools.map(tool => ({
                    name: tool.name,
                    description: tool.description || `MCP tool: ${tool.name}`,
                    parameters: tool.inputSchema || {
                        type: 'object',
                        properties: {},
                        required: []
                    }
                }));
            }
        } catch (error) {
            this.logError('MCP tool list initialization failed', { error });
            // Continue even if it fails (can work without function list)
            this.functions = [];
        }
    }

    /**
     * Tool call implementation
     */
    async callTool(toolName: string, parameters: Record<string, any>): Promise<any> {
        return this.executeToolSafely(toolName, parameters, async () => {
            // Call tool through MCP client
            return await this.mcpClient.callTool(toolName, parameters);
        });
    }

    /**
     * Return available tool list (override)
     * For MCP, function list may not exist, so handle dynamically
     */
    getAvailableTools(): string[] {
        if (!this.functions || this.functions.length === 0) {
            // Return empty array if no function list
            // MCP client can provide tools dynamically
            return [];
        }
        return super.getAvailableTools();
    }

    /**
     * Check if specific tool exists (override)
     * For MCP, tool may exist even without function list, so always return true
     */
    hasTool(toolName: string): boolean {
        if (!this.functions || this.functions.length === 0) {
            // Assume MCP client can handle dynamically if no function list
            return true;
        }
        return super.hasTool(toolName);
    }
}

/**
 * MCP (Model Context Protocol) based tool provider creation function
 * 
 * @param mcpClient MCP client instance
 * @returns MCP-based tool provider object
 */
export function createMcpToolProvider(mcpClient: MCPClient): ToolProvider {
    return new MCPToolProvider({ mcpClient });
} 