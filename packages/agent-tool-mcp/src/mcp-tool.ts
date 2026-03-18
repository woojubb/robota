import type {
  ITool,
  IToolResult,
  IToolExecutionContext,
  TToolParameters,
  IParameterValidationResult,
} from '@robota-sdk/agent-core';
import type { IToolSchema } from '@robota-sdk/agent-core';
import type { IUniversalObjectValue } from '@robota-sdk/agent-core';
import { ToolExecutionError, ValidationError } from '@robota-sdk/agent-core';

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
 * Implements ITool without extending AbstractTool to avoid
 * circular runtime dependency (tool-mcp → agents → tools → agents).
 */
export class MCPTool implements ITool {
  readonly schema: IToolSchema;
  private readonly mcpConfig: IMCPConfig;
  private connectionStatus: TMCPConnectionStatus = 'disconnected';

  constructor(config: IMCPConfig, schema: IToolSchema) {
    this.mcpConfig = {
      timeout: 30000,
      retries: 3,
      ...config,
    };
    this.schema = schema;
  }

  /**
   * Execute the MCP tool
   */
  async execute(
    parameters: TToolParameters,
    _context?: IToolExecutionContext,
  ): Promise<IToolResult> {
    const toolName = this.schema.name;
    const startTime = Date.now();

    try {
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

      return {
        success: true,
        data: executionResult,
        metadata: {
          executionTime,
          toolName,
          endpoint: this.mcpConfig.endpoint,
          connectionStatus: this.connectionStatus,
        },
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;

      if (error instanceof ToolExecutionError || error instanceof ValidationError) {
        throw error;
      }

      const safeError = error instanceof Error ? error : new Error(String(error));
      throw new ToolExecutionError(
        `MCP tool execution failed: ${safeError.message}`,
        toolName,
        safeError,
        {
          executionTime,
          endpoint: this.mcpConfig.endpoint,
          connectionStatus: this.connectionStatus,
          parametersCount: Object.keys(parameters || {}).length,
        },
      );
    }
  }

  /**
   * Validate tool parameters
   */
  validate(parameters: TToolParameters): boolean {
    return this.validateParameters(parameters).isValid;
  }

  /**
   * Validate tool parameters with detailed result
   */
  validateParameters(parameters: TToolParameters): IParameterValidationResult {
    const required = this.schema.parameters.required || [];
    const errors: string[] = [];

    for (const field of required) {
      if (!(field in parameters)) {
        errors.push(`Missing required parameter: ${field}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get tool description
   */
  getDescription(): string {
    return this.schema.description;
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
            reject(
              new Error(
                `MCP connection timeout: still connecting after ${maxIterations * CONNECTION_CHECK_INTERVAL_MS}ms`,
              ),
            );
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

      // Simulate connection delay
      await new Promise((resolve) => setTimeout(resolve, CONNECTION_CHECK_INTERVAL_MS));

      this.connectionStatus = 'connected';
    } catch (error) {
      this.connectionStatus = 'error';
      throw new Error(
        `Failed to connect to MCP server: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Build MCP request from tool parameters
   */
  private buildMCPRequest(toolName: string, parameters: TToolParameters): IMCPRequest {
    const requestId = `${toolName}-${Date.now()}-${Math.random().toString(ID_RADIX).substring(2, ID_SUBSTR_END)}`;

    const mcpParams: IMCPRequestParams = {
      tool: toolName,
      arguments: parameters,
    };

    // Add metadata if configured
    if (this.mcpConfig.headers) {
      mcpParams.metadata = this.mcpConfig.headers as Record<string, string | number | boolean>;
    }

    return {
      jsonrpc: '2.0',
      id: requestId,
      method: 'tools/call',
      params: mcpParams,
    } satisfies IMCPRequest;
  }

  /**
   * Execute MCP request and return response
   */
  private async executeMCPRequest(request: IMCPRequest): Promise<IMCPResponse> {
    try {
      // TODO: Implement actual MCP protocol communication
      // This would typically use WebSocket or HTTP POST to the MCP server

      throw new Error('Not implemented: actual MCP execution is not yet available');
    } catch (error) {
      // Return error response in MCP format
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603, // Internal error
          message: error instanceof Error ? error.message : String(error),
          data: { endpoint: this.mcpConfig.endpoint },
        },
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
        metadata: response.error.data ?? undefined,
      };
      return errorData;
    }

    if (response.result) {
      const okData: IUniversalObjectValue = {
        success: true,
        content: response.result.content,
        metadata: response.result.metadata ?? undefined,
      };
      return okData;
    }

    // Unexpected response format
    const unexpected: IUniversalObjectValue = {
      success: false,
      content: 'Unexpected MCP response format',
      metadata: { responseId: String(response.id) },
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
        this.connectionStatus = 'disconnected';
      } catch (error) {
        this.connectionStatus = 'error';
        throw new Error(
          `Error disconnecting from MCP server: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

/**
 * Factory function to create MCP tools
 */
export function createMCPTool(config: IMCPConfig, schema: IToolSchema): MCPTool {
  return new MCPTool(config, schema);
}
