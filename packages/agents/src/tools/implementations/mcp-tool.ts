import type { ToolInterface, ToolResult, ToolExecutionContext, MCPToolConfig, ToolParameters } from '../../interfaces/tool';
import type { ToolSchema } from '../../interfaces/provider';
import { BaseTool } from '../../abstracts/base-tool';
import { ToolExecutionError } from '../../utils/errors';
import { logger } from '../../utils/logger';

/**
 * MCP protocol message types
 */
interface MCPRequest {
    jsonrpc: '2.0';
    id: string | number;
    method: string;
    params?: MCPRequestParams;
}

interface MCPResponse {
    jsonrpc: '2.0';
    id: string | number;
    result?: MCPResultData;
    error?: MCPError;
}

interface MCPRequestParams {
    tool: string;
    arguments: ToolParameters;
    metadata?: Record<string, string | number | boolean>;
}

interface MCPResultData {
    content: string | object;
    metadata?: Record<string, string | number | boolean>;
    isError?: boolean;
}

interface MCPError {
    code: number;
    message: string;
    data?: Record<string, string | number | boolean>;
}

/**
 * MCP connection status
 */
type MCPConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

/**
 * MCP tool execution result
 */
interface MCPExecutionResult {
    success: boolean;
    content: string | object;
    metadata?: Record<string, string | number | boolean>;
    executionTime?: number;
    connectionStatus?: MCPConnectionStatus;
}

/**
 * MCP (Model Context Protocol) tool implementation
 * Executes tools via MCP protocol
 * 
 * @extends BaseTool<ToolParameters, ToolResult>
 */
export class MCPTool extends BaseTool<ToolParameters, ToolResult> implements ToolInterface {
    readonly schema: ToolSchema;
    private readonly mcpConfig: MCPToolConfig;
    private connectionStatus: MCPConnectionStatus = 'disconnected';

    constructor(schema: ToolSchema, mcpConfig: MCPToolConfig) {
        super();
        this.schema = schema;
        this.mcpConfig = mcpConfig;
    }

    /**
     * Execute the MCP tool
     */
    async execute(parameters: ToolParameters, context?: ToolExecutionContext): Promise<ToolResult> {
        const toolName = this.schema.name;
        const startTime = Date.now();

        try {
            logger.debug(`Executing MCP tool "${toolName}"`, {
                toolName,
                parametersCount: Object.keys(parameters || {}).length,
                endpoint: this.mcpConfig.endpoint,
                connectionStatus: this.connectionStatus
            });

            // Check connection status
            if (this.connectionStatus !== 'connected') {
                await this.ensureConnection();
            }

            // Build MCP request
            const mcpRequest = this.buildMCPRequest(toolName, parameters);

            // Execute MCP call
            const mcpResponse = await this.executeMCPRequest(mcpRequest);

            // Process response
            const executionResult = this.processMCPResponse(mcpResponse);
            const executionTime = Date.now() - startTime;

            logger.debug(`MCP tool "${toolName}" executed successfully`, {
                toolName,
                executionTime,
                connectionStatus: this.connectionStatus
            });

            return {
                success: executionResult.success,
                // REASON: MCP protocol returns dynamic content structure that cannot be known at compile time
                // ALTERNATIVES_CONSIDERED:
                // 1. Union types (insufficient for dynamic MCP responses)
                // 2. Interface definition (too restrictive for MCP protocol)
                // 3. Generic types (breaks ToolResult compatibility)
                // 4. Conditional types (complex mapping issues)
                // 5. Mapped types (structural incompatibility)
                // 6. Type guards (runtime only, doesn't solve compile time)
                // 7. Custom declarations (breaks existing tool interface)
                // 8. Code refactoring (would break MCP protocol compliance)
                // TODO: Create MCP TypeScript definitions package or contribute to MCP specification for standardized TypeScript types
                data: typeof executionResult.content === 'string' ? executionResult.content : JSON.stringify(executionResult.content),
                metadata: {
                    toolName,
                    toolType: 'mcp',
                    endpoint: this.mcpConfig.endpoint,
                    executionTime,
                    connectionStatus: this.connectionStatus,
                    mcpMetadata: executionResult.metadata || {}
                }
            };

        } catch (error) {
            const executionTime = Date.now() - startTime;

            logger.error(`MCP tool "${toolName}" execution failed`, {
                toolName,
                endpoint: this.mcpConfig.endpoint,
                executionTime,
                connectionStatus: this.connectionStatus,
                error: error instanceof Error ? error.message : String(error)
            });

            throw new ToolExecutionError(
                `MCP execution failed: ${error instanceof Error ? error.message : String(error)}`,
                toolName,
                error instanceof Error ? error : new Error(String(error)),
                {
                    parametersCount: Object.keys(parameters || {}).length,
                    hasContext: !!context,
                    endpoint: this.mcpConfig.endpoint,
                    connectionStatus: this.connectionStatus,
                    executionTime
                }
            );
        }
    }

    /**
     * Ensure MCP connection is established
     */
    private async ensureConnection(): Promise<void> {
        if (this.connectionStatus === 'connecting') {
            // Wait for existing connection attempt
            return new Promise((resolve) => {
                const checkConnection = () => {
                    if (this.connectionStatus !== 'connecting') {
                        resolve();
                    } else {
                        setTimeout(checkConnection, 100);
                    }
                };
                checkConnection();
            });
        }

        this.connectionStatus = 'connecting';

        try {
            // TODO: Implement actual MCP connection logic
            // This would typically involve WebSocket or HTTP connection
            logger.debug('Establishing MCP connection', { endpoint: this.mcpConfig.endpoint });

            // Simulate connection delay
            await new Promise(resolve => setTimeout(resolve, 100));

            this.connectionStatus = 'connected';
            logger.debug('MCP connection established', { endpoint: this.mcpConfig.endpoint });

        } catch (error) {
            this.connectionStatus = 'error';
            throw new Error(`Failed to connect to MCP server: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Build MCP request from tool parameters
     */
    private buildMCPRequest(toolName: string, parameters: ToolParameters): MCPRequest {
        const requestId = `${toolName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const mcpParams: MCPRequestParams = {
            tool: toolName,
            arguments: parameters
        };

        // Add metadata if configured
        if (this.mcpConfig.toolConfig) {
            mcpParams.metadata = this.mcpConfig.toolConfig as Record<string, string | number | boolean>;
        }

        return {
            jsonrpc: '2.0',
            id: requestId,
            method: 'tools/call',
            params: mcpParams
        };
    }

    /**
     * Execute MCP request and return response
     */
    private async executeMCPRequest(request: MCPRequest): Promise<MCPResponse> {
        const _timeout = this.mcpConfig.timeout || 30000; // 30 seconds default

        try {
            // TODO: Implement actual MCP protocol communication
            // This would typically use WebSocket or HTTP POST to the MCP server
            logger.debug('Sending MCP request', {
                endpoint: this.mcpConfig.endpoint,
                method: request.method,
                id: request.id
            });

            // Simulate MCP response for now
            const mockResponse: MCPResponse = {
                jsonrpc: '2.0',
                id: request.id,
                result: {
                    content: `MCP tool "${request.params?.tool}" executed with parameters: ${JSON.stringify(request.params?.arguments)}`,
                    metadata: {
                        timestamp: new Date().toISOString(),
                        server: this.mcpConfig.endpoint
                    }
                }
            };

            return mockResponse;

        } catch (error) {
            // Return error response in MCP format
            return {
                jsonrpc: '2.0',
                id: request.id,
                error: {
                    code: -32603, // Internal error
                    message: error instanceof Error ? error.message : String(error),
                    data: { endpoint: this.mcpConfig.endpoint }
                }
            };
        }
    }

    /**
     * Process MCP response and extract execution result
     */
    private processMCPResponse(response: MCPResponse): MCPExecutionResult {
        if (response.error) {
            const result: MCPExecutionResult = {
                success: false,
                content: response.error.message
            };

            if (response.error.data) {
                result.metadata = response.error.data;
            }

            return result;
        }

        if (response.result) {
            const result: MCPExecutionResult = {
                success: true,
                content: response.result.content
            };

            if (response.result.metadata) {
                result.metadata = response.result.metadata;
            }

            return result;
        }

        // Fallback for unexpected response format
        return {
            success: false,
            content: 'Unexpected MCP response format',
            metadata: { responseId: response.id }
        };
    }

    /**
     * Get current connection status
     */
    public getConnectionStatus(): MCPConnectionStatus {
        return this.connectionStatus;
    }

    /**
     * Disconnect from MCP server
     */
    public async disconnect(): Promise<void> {
        if (this.connectionStatus === 'connected') {
            this.connectionStatus = 'disconnecting' as MCPConnectionStatus;

            try {
                // TODO: Implement actual disconnection logic
                logger.debug('Disconnecting from MCP server', { endpoint: this.mcpConfig.endpoint });

                this.connectionStatus = 'disconnected';
                logger.debug('Disconnected from MCP server', { endpoint: this.mcpConfig.endpoint });

            } catch (error) {
                this.connectionStatus = 'error';
                logger.error('Error disconnecting from MCP server', {
                    endpoint: this.mcpConfig.endpoint,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }
}

/**
 * Factory function to create MCP tools
 */
export function createMCPTool(schema: ToolSchema, mcpConfig: MCPToolConfig): MCPTool {
    return new MCPTool(schema, mcpConfig);
} 