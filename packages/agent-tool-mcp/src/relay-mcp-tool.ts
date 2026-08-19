import { ToolExecutionError } from '@robota-sdk/agent-core';

import { ThirdPartySchemaValidator, type TUnenforceableSchemaReporter } from './third-party-schema';

import type {
  TToolParameters,
  IToolResult,
  IToolExecutionContext,
  IParameterValidationResult,
} from '@robota-sdk/agent-core';
import type { IToolSchema } from '@robota-sdk/agent-core';
import type { IEventService, IOwnerPathSegment } from '@robota-sdk/agent-core';

const ID_RADIX = 36;
const ID_SUBSTR_END = 8;

export interface IRelayMcpContext {
  /** OwnerPath including agent segment appended for this relay execution */
  ownerPath: IOwnerPathSegment[];
  /** Tool-bound EventService (already bound to tool by caller) */
  eventService: IEventService;
  /** Unbound base EventService (required to bind a new owner for created agent) */
  baseEventService: IEventService;
  /** Generated agent identifier for this relay execution */
  agentId: string;
}

export interface IRelayMcpOptions {
  /** MCP schema describing this relay tool */
  schema: IToolSchema;
  /**
   * Relay executor that performs the actual work (e.g., create Robota agent and run).
   * Must not perform ownerPath inference; receives the augmented agent ownerPath.
   */
  run: (parameters: TToolParameters, ctx: IRelayMcpContext) => Promise<IToolResult>;
  /**
   * CORE-040: told once, with the paths, when part of this tool's third-party schema is outside the
   * universal subset and therefore cannot be enforced. Optional — omitting it logs a warning rather
   * than passing over the gap in silence.
   */
  onUnenforceableSchema?: TUnenforceableSchemaReporter;
}

/**
 * RelayMcpTool
 *
 * Minimal relay tool for third-party MCP commands that need to spin up a Robota-based flow.
 * - Caller provides tool-bound EventService and ownerPath (up to tool segment).
 * - This tool appends a single agent segment and forwards control to the provided run() callback.
 * - No prefix injection, no ownerPath inference, no fallback/clone/context creation inside.
 *
 * Implements ITool without extending AbstractTool to avoid circular runtime dependency.
 */
export class RelayMcpTool {
  readonly schema: IToolSchema;
  private readonly runImpl: IRelayMcpOptions['run'];
  private readonly onUnenforceableSchema?: TUnenforceableSchemaReporter;
  /** CORE-040: built on first use and reused — narrowing is a property of the schema, not the call. */
  private validator?: ThirdPartySchemaValidator;

  constructor(options: IRelayMcpOptions) {
    this.schema = options.schema;
    this.runImpl = options.run;
    this.onUnenforceableSchema = options.onUnenforceableSchema;
  }

  async execute(
    parameters: TToolParameters,
    context?: IToolExecutionContext,
  ): Promise<IToolResult> {
    const eventService = context?.eventService;
    if (!eventService) {
      throw new ToolExecutionError(
        'RelayMcpTool requires tool-call scoped EventService in ToolExecutionContext',
        this.schema.name,
      );
    }
    const baseEventService = context?.baseEventService;
    if (!baseEventService) {
      throw new ToolExecutionError(
        'RelayMcpTool requires baseEventService in ToolExecutionContext',
        this.schema.name,
      );
    }

    const baseOwnerPath = context?.ownerPath;
    if (!baseOwnerPath || baseOwnerPath.length === 0) {
      throw new ToolExecutionError(
        'RelayMcpTool requires ownerPath bound to tool segment',
        this.schema.name,
      );
    }

    const agentId = `agent_${Date.now()}_${Math.random().toString(ID_RADIX).slice(2, ID_SUBSTR_END)}`;
    const agentOwnerPath: IOwnerPathSegment[] = [
      ...baseOwnerPath.map((segment) => ({ ...segment })),
      { type: 'agent', id: agentId },
    ];

    const ctx: IRelayMcpContext = {
      ownerPath: agentOwnerPath,
      eventService,
      baseEventService,
      agentId,
    };

    return this.runImpl(parameters, ctx);
  }

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

  getDescription(): string {
    return this.schema.description;
  }
}
