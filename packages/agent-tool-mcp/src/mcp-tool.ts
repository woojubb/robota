import { ToolExecutionError, ValidationError } from '@robota-sdk/agent-core';

import {
  createFailClosedMCPActivationAdmission,
  type IMCPActivationAdmission,
  type IMCPActivationRequest,
  type IMCPActivationStatusResult,
} from './mcp-activation.js';
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
  IEventService,
  IToolWithEventService,
  IToolResult,
  IToolExecutionContext,
  TToolParameters,
  IParameterValidationResult,
} from '@robota-sdk/agent-core';
import type { IToolSchema } from '@robota-sdk/agent-core';

export type { IMCPConfig };

export interface IMCPToolOptions {
  /** The exact resolved definition identity that must be admitted before the first request. */
  readonly activationRequest?: IMCPActivationRequest;
  /** Host-owned admission policy. Omitted means fail closed. */
  readonly admission?: IMCPActivationAdmission;
  readonly onUnenforceableSchema?: TUnenforceableSchemaReporter;
}

const CONNECTION_CHECK_INTERVAL_MS = 100;

/**
 * MCP (Model Context Protocol) tool implementation
 * Executes tools via the Model Context Protocol
 *
 * Implements ITool without extending AbstractTool to avoid
 * circular runtime dependency (tool-mcp → agents → tools → agents).
 */
export class MCPTool implements IToolWithEventService {
  readonly schema: IToolSchema;

  /** Held for the runtime's benefit; see `setEventService`. */
  private eventService: IEventService | undefined;
  private readonly mcpConfig: IMCPConfig;
  private readonly activationRequest?: IMCPActivationRequest;
  private readonly activationAdmission: IMCPActivationAdmission;
  private readonly onUnenforceableSchema?: TUnenforceableSchemaReporter;
  private connectionStatus: TMCPConnectionStatus = 'disconnected';
  private sessionId: string | undefined;

  /** CORE-040: built on first use and reused — narrowing is a property of the schema, not the call. */
  private validator?: ThirdPartySchemaValidator;

  constructor(
    config: IMCPConfig,
    schema: IToolSchema,
    onUnenforceableSchemaOrOptions?: TUnenforceableSchemaReporter | IMCPToolOptions,
    options?: IMCPToolOptions,
  ) {
    const resolvedOptions =
      typeof onUnenforceableSchemaOrOptions === 'function'
        ? options
        : onUnenforceableSchemaOrOptions;
    this.onUnenforceableSchema =
      typeof onUnenforceableSchemaOrOptions === 'function'
        ? onUnenforceableSchemaOrOptions
        : resolvedOptions?.onUnenforceableSchema;
    this.activationRequest = resolvedOptions?.activationRequest;
    this.activationAdmission =
      resolvedOptions?.admission ?? createFailClosedMCPActivationAdmission();
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
      const admission = this.checkActivationAdmission();
      if (!admission.allowed) {
        throw new ToolExecutionError(
          `MCP activation denied: ${admission.reason}`,
          toolName,
          undefined,
          {
            activationStatus: admission.status,
            activationServerId: admission.serverId,
          },
        );
      }

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
   * Check the policy on every execution, including executions that reuse an existing session.
   * This keeps revocation and workspace-generation changes effective without requiring transports
   * to duplicate the admission rule.
   */
  private checkActivationAdmission(): IMCPActivationStatusResult {
    if (!this.activationRequest) {
      return {
        serverId: 'unknown',
        source: 'project',
        status: 'pending',
        allowed: false,
        reason: 'MCP activation requires an exact activation request.',
        provenance: { kind: 'project', id: 'missing' },
        definitionFingerprint: 'missing',
        securityIdentity: 'missing',
      };
    }
    return this.activationAdmission.admit(this.activationRequest);
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
   * TOOL-006. The runtime's tool slot is `IToolWithEventService`, and registration calls
   * `setEventService` unconditionally — so a tool without it is a `TypeError` at registration, not a
   * type error a caller can work around by casting. Both methods exist for that contract.
   */
  getName(): string {
    return this.schema.name;
  }

  /**
   * Accepts the runtime's event service so tool lifecycle events are emitted.
   *
   * Stored and not otherwise used here: this class emits nothing of its own, and the point of the
   * method is that the runtime can call it. Refusing to hold the reference would satisfy the type
   * and break the contract's purpose, which is the shape this package was already in.
   */
  setEventService(eventService: IEventService | undefined): void {
    this.eventService = eventService;
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
export function createMCPTool(
  config: IMCPConfig,
  schema: IToolSchema,
  options?: IMCPToolOptions,
): MCPTool {
  return new MCPTool(config, schema, options);
}
