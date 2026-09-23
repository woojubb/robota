/**
 * Type definitions for AbstractTool.
 *
 * Extracted from abstract-tool.ts so foundational interfaces (e.g. `interfaces/agent.ts`) can
 * depend on the tool contract without importing the class module itself, which pulls in
 * `../utils/logger` at runtime and otherwise participates in a module-level import cycle.
 */
import type { IEventService } from '../interfaces/event-service';
import type { IToolSchema } from '../interfaces/provider';
import type {
  IToolResult,
  IToolExecutionContext,
  IParameterValidationResult,
  TToolParameters,
} from '../interfaces/tool';
import type { ILogger } from '../utils/logger';

/**
 * Options for AbstractTool construction
 */
export interface IAbstractToolOptions {
  /**
   * Optional logger for tool operations
   * Defaults to SilentLogger if not provided
   */
  logger?: ILogger;

  /**
   * Optional event service for unified event emission
   * If not provided, tool will operate silently without emitting events
   *
   * The caller should provide an EventService configured with appropriate settings
   * (e.g., ownerPrefix='tool' for tool events)
   *
   * @since 2.1.0
   */
  eventService?: IEventService;
}

/**
 * Tool execution function type with proper parameter constraints
 */
export type TToolExecutionFunction<TParams = TToolParameters, TResult = IToolResult> = (
  parameters: TParams,
) => Promise<TResult> | TResult;

/**
 * Abstract tool interface with type parameters for enhanced type safety
 *
 * @template TParams - Tool parameters type (defaults to AbstractToolParameters for backward compatibility)
 * @template TResult - Tool result type (defaults to ToolResult for backward compatibility)
 */
export interface IAbstractTool<TParams = TToolParameters, TResult = IToolResult> {
  name: string;
  description: string;
  parameters: IToolSchema['parameters'];
  execute: TToolExecutionFunction<TParams, TResult>;
}

/**
 * Type-safe tool interface with type parameters
 *
 * @template TParameters - Tool parameters type (defaults to AbstractToolParameters for backward compatibility)
 * @template TResult - Tool result type (defaults to ToolResult for backward compatibility)
 */
export interface IToolContract<TParameters = TToolParameters, TResult = IToolResult> {
  readonly schema: IToolSchema;
  execute(parameters: TParameters, context: IToolExecutionContext): Promise<TResult>;
  validate(parameters: TParameters): boolean;
  validateParameters(parameters: TParameters): IParameterValidationResult;
  getDescription(): string;
  getName(): string;
}

/**
 * Runtime tool instance contract used by Robota internals.
 *
 * Tools passed into Agent configuration must support EventService injection
 * so Robota can emit unified tool lifecycle events.
 */
export interface IToolWithEventService<
  TParameters = TToolParameters,
  TResult = IToolResult,
> extends IToolContract<TParameters, TResult> {
  setEventService(eventService: IEventService | undefined): void;
}
