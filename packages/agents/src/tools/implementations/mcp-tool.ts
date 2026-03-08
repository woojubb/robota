import type { ITool, IToolResult, IToolExecutionContext, TToolParameters } from '../../interfaces/tool';
import type { IToolSchema } from '../../interfaces/provider';
import type { IUniversalObjectValue } from '../../interfaces/types';
import { AbstractTool, type IAbstractToolOptions } from '../../abstracts/abstract-tool';
import { ToolExecutionError, ValidationError } from '../../utils/errors';
import { logger as _logger } from '../../utils/logger';

const CONNECTION_CHECK_INTERVAL_MS = 100;
const ID_RADIX = 36;
const ID_SUBSTR_END = 11;

/**
 * MCP (Model Context Protocol) tool configuration
 */
export interface IMCPConfig {
    endpoint: string;
    apiKey?: string;
    timeout?: number;
    retries?: number;
    headers?: Record<string, string>;
}

/**
 * MCP protocol message types
 */
interface IMCPRequest {
    jsonrpc: '2.0';
    id: string | number;
    method: string;
    params?: IMCPRequestParams;
}

interface IMCPResponse {
    jsonrpc: '2.0';
    id: string | number;
    result?: IMCPResultData;
    error?: IMCPError;
}

interface IMCPRequestParams {
    tool: string;
    arguments: TToolParameters;
    metadata?: Record<string, string | number | boolean>;
}

interface IMCPResultData {
    content: string | Record<string, string | number | boolean | null>;
    metadata?: Record<string, string | number | boolean>;
    isError?: boolean;
}

interface IMCPError {
    code: number;
    message: string;
    data?: Record<string, string | number | boolean>;
}

/**
 * MCP connection status
 */
type TMCPConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'disconnecting' | 'error';

/**
 * MCP tool execution result (domain payload).
 *
 * NOTE:
 * Tool result payloads must conform to the canonical UniversalValue axis.
 * We return a plain object (IUniversalObjectValue) so downstream consumers can safely
 * store/serialize it without `any`/`unknown`.
 */

/**
 * MCP (Model Context Protocol) tool implementation
 * Executes tools via the Model Context Protocol
 * 
 * @extends AbstractTool<TToolParameters, IToolResult>
 */
export class MCPTool extends AbstractTool<TToolParameters, IToolResult> implements ITool {
    readonly schema: IToolSchema;
    private readonly mcpConfig: IMCPConfig;
    private connectionStatus: TMCPConnectionStatus = 'disconnected';

    constructor(config: IMCPConfig, schema: IToolSchema, options: IAbstractToolOptions = {}) {
        super(options);
        this.mcpConfig = {
            timeout: 30000,
            retries: 3,
            ...config
        };
        this.schema = schema;
    }

    /**
     * Execute the MCP tool implementation
     * This method is called by the parent's Template Method Pattern
     */
    protected async executeImpl(parameters: TToolParameters, _context?: IToolExecutionContext): Promise<IToolResult> {
        const toolName = this.schema.name;
        const startTime = Date.now();

        try {
            this.logger.debug(`Executing MCP tool "${toolName}"`, {
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

            this.logger.debug(`MCP tool "${toolName}" executed successfully`, {
                toolName,
                executionTime,
                connectionStatus: this.connectionStatus
            });

            return {
                success: true,
                data: executionResult,
                metadata: {
                    executionTime,
                    toolName,
                    endpoint: this.mcpConfig.endpoint,
                    connectionStatus: this.connectionStatus
                }
            };

        } catch (error) {
            const executionTime = Date.now() - startTime;
            const safeError = error instanceof Error ? error : new Error(String(error));

            this.logger.error(`MCP tool "${toolName}" execution failed`, {
                toolName,
                executionTime,
                connectionStatus: this.connectionStatus,
                error: safeError,
                parameters
            });

            if (error instanceof ToolExecutionError || error instanceof ValidationError) {
                throw error;
            }

            throw new ToolExecutionError(
                `MCP tool execution failed: ${safeError.message}`,
                toolName,
                safeError,
                {
                    executionTime,
                    endpoint: this.mcpConfig.endpoint,
                    connectionStatus: this.connectionStatus,
                    parametersCount: Object.keys(parameters || {}).length
                }
            );
        }
    }

    /**
     * Ensure MCP connection is established
     */
    private async ensureConnection(): Promise<void> {
        if (this.connectionStatus === 'connecting') {
            // Wait for existing connection attempt with upper bound
            const maxIterations = 50;
            return new Promise((resolve, reject) => {
                let iterations = 0;
                const checkConnection = () => {
                    iterations++;
                    if (this.connectionStatus !== 'connecting') {
                        resolve();
                    } else if (iterations >= maxIterations) {
                        reject(new Error(`MCP connection timeout: still connecting after ${maxIterations * CONNECTION_CHECK_INTERVAL_MS}ms`));
                    } else {
                        setTimeout(checkConnection, CONNECTION_CHECK_INTERVAL_MS);
                    }
                };
                checkConnection();
            });
        }

        this.connectionStatus = 'connecting';

        try {
            // TODO: Implement actual MCP connection logic
            // This would typically involve WebSocket or HTTP connection
            this.logger.debug('Establishing MCP connection', { endpoint: this.mcpConfig.endpoint });

            // Simulate connection delay
            await new Promise(resolve => setTimeout(resolve, CONNECTION_CHECK_INTERVAL_MS));

            this.connectionStatus = 'connected';
            this.logger.debug('MCP connection established', { endpoint: this.mcpConfig.endpoint });

        } catch (error) {
            this.connectionStatus = 'error';
            throw new Error(`Failed to connect to MCP server: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Build MCP request from tool parameters
     */
    private buildMCPRequest(toolName: string, parameters: TToolParameters): IMCPRequest {
        const requestId = `${toolName}-${Date.now()}-${Math.random().toString(ID_RADIX).substring(2, ID_SUBSTR_END)}`;

        const mcpParams: IMCPRequestParams = {
            tool: toolName,
            arguments: parameters
        };

        // Add metadata if configured
        if (this.mcpConfig.headers) {
            mcpParams.metadata = this.mcpConfig.headers as Record<string, string | number | boolean>;
        }

        return {
            jsonrpc: '2.0',
            id: requestId,
            method: 'tools/call',
            params: mcpParams
        } satisfies IMCPRequest;
    }

    /**
     * Execute MCP request and return response
     */
    private async executeMCPRequest(request: IMCPRequest): Promise<IMCPResponse> {
        try {
            // TODO: Implement actual MCP protocol communication
            // This would typically use WebSocket or HTTP POST to the MCP server
            this.logger.debug('Sending MCP request', {
                endpoint: this.mcpConfig.endpoint,
                method: request.method,
                id: request.id
            });

            throw new Error('Not implemented: actual MCP execution is not yet available');

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
            } satisfies IMCPResponse;
        }
    }

    /**
     * Process MCP response and extract execution result
     */
    private processMCPResponse(response: IMCPResponse): IUniversalObjectValue {
        if (response.error) {
            const errorData: IUniversalObjectValue = {
                success: false,
                content: response.error.message,
                metadata: response.error.data ?? undefined
            };
            return errorData;
        }

        if (response.result) {
            const okData: IUniversalObjectValue = {
                success: true,
                content: response.result.content,
                metadata: response.result.metadata ?? undefined
            };
            return okData;
        }

        // Unexpected response format
        const unexpected: IUniversalObjectValue = {
            success: false,
            content: 'Unexpected MCP response format',
            metadata: { responseId: String(response.id) }
        };
        return unexpected;
    }

    /**
     * Get current connection status
     */
    public getConnectionStatus(): TMCPConnectionStatus {
        return this.connectionStatus;
    }

    /**
     * Disconnect from MCP server
     */
    public async disconnect(): Promise<void> {
        if (this.connectionStatus === 'connected') {
            this.connectionStatus = 'disconnecting';

            try {
                // TODO: Implement actual disconnection logic
                this.logger.debug('Disconnecting from MCP server', { endpoint: this.mcpConfig.endpoint });

                this.connectionStatus = 'disconnected';
                this.logger.debug('Disconnected from MCP server', { endpoint: this.mcpConfig.endpoint });

            } catch (error) {
                this.connectionStatus = 'error';
                this.logger.error('Error disconnecting from MCP server', {
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
export function createMCPTool(config: IMCPConfig, schema: IToolSchema, options: IAbstractToolOptions = {}): MCPTool {
    return new MCPTool(config, schema, options);
} 