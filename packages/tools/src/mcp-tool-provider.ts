import { ToolProvider } from './tool-provider';

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
    // Additional methods...
}

/**
 * MCP(Model Context Protocol) based tool provider creation function
 * 
 * @param mcpClient MCP client instance
 * @returns MCP-based tool provider object
 */
export function createMcpToolProvider(mcpClient: MCPClient): ToolProvider {
    return {
        async callTool(toolName: string, parameters: Record<string, any>) {
            try {
                // Call tool through MCP client
                const result = await mcpClient.callTool(toolName, parameters);
                return result;
            } catch (error) {
                console.error(`Error calling tool '${toolName}':`, error);
                throw new Error(`Tool call failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    };
} 