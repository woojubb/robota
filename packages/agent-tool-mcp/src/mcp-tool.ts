import type {
  ITool,
  IToolResult,
  IToolExecutionContext,
  TToolParameters,
  IParameterValidationResult,
} from '@robota-sdk/agent-core';
import type { IToolSchema } from '@robota-sdk/agent-core';
import { ToolExecutionError, ValidationError } from '@robota-sdk/agent-core';
import {
  type IMCPConfig,
  type TMCPConnectionStatus,
  buildMCPRequest,
  executeMCPRequest,
  processMCPResponse,
} from './mcp-protocol';

export type { IMCPConfig };

const CONNECTION_CHECK_INTERVAL_MS = 100;

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
      const mcpRequest = buildMCPRequest(toolName, parameters, this.mcpConfig.headers);

      // Execute MCP call
      const mcpResponse = await executeMCPRequest(mcpRequest, this.mcpConfig.endpoint);

      // Process response
      const executionResult = processMCPResponse(mcpResponse);
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
