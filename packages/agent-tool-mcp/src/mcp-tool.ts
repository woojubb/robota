import { ToolExecutionError, ValidationError } from '@robota-sdk/agent-core';

import {
  type IMCPConfig,
  type TMCPConnectionStatus,
  buildMCPRequest,
  initializeMCPSession,
  processMCPResponse,
  sendMCPRequest,
  terminateMCPSession,
} from './mcp-protocol';
import { ThirdPartySchemaValidator, type TUnenforceableSchemaReporter } from './third-party-schema';

import type {
  ITool,
  IToolResult,
  IToolExecutionContext,
  TToolParameters,
  IParameterValidationResult,
} from '@robota-sdk/agent-core';
import type { IToolSchema } from '@robota-sdk/agent-core';

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
  private sessionId: string | undefined;

  /** CORE-040: built on first use and reused — narrowing is a property of the schema, not the call. */
  private validator?: ThirdPartySchemaValidator;

  constructor(
    config: IMCPConfig,
    schema: IToolSchema,
    private readonly onUnenforceableSchema?: TUnenforceableSchemaReporter,
  ) {
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
    context?: IToolExecutionContext,
  ): Promise<IToolResult> {
    const toolName = this.schema.name;
    const startTime = Date.now();

    try {
      // Check connection status
      if (this.connectionStatus !== 'connected') {
        await this.ensureConnection();
      }

      // Build MCP request (spec-conformant tools/call params)
      const mcpRequest = buildMCPRequest(toolName, parameters);

      // Execute MCP call over Streamable HTTP
      const { response: mcpResponse, sessionId } = await sendMCPRequest(
        mcpRequest,
        this.mcpConfig,
        this.sessionId,
        context?.signal,
      );
      this.sessionId = sessionId ?? this.sessionId;
      if (mcpResponse === null) {
        throw new Error('MCP server returned no response for tools/call');
      }

      // Process response — throws on JSON-RPC errors and isError results
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
   * Validate tool parameters with detailed result.
   *
   * CORE-040: routed through the universal-subset walk, narrowed to what it can enforce for a
   * THIRD-PARTY schema. This used to be a presence check over the top-level `required` list and
   * nothing else, so declared types, enums, bounds and every nested field were advertised to the
   * model and enforced by nobody.
   */
  validateParameters(parameters: TToolParameters): IParameterValidationResult {
    this.validator ??= new ThirdPartySchemaValidator(
      this.schema.name,
      this.schema.parameters,
      this.onUnenforceableSchema,
    );
    return this.validator.validate(parameters);
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
        const checkConnection = (): void => {
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
      this.sessionId = await initializeMCPSession(this.mcpConfig);
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
        await terminateMCPSession(this.mcpConfig, this.sessionId);
        this.sessionId = undefined;
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
