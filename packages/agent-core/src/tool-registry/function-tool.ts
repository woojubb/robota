import { validateToolOutput } from './output-validator';
import { getValidationErrors, validateToolParameters } from './parameter-validator';
import { generateSpanId } from '../event-service/event-service';
import { SPAN_EVENTS } from '../event-service/span-events';
import { ToolExecutionError, ValidationError } from '../utils/errors';

import type { ISpanCompletionEventData } from '../event-service/span-events';
import type { IToolSchema } from '../interfaces/provider';
import type {
  IFunctionTool,
  IToolResult,
  IToolExecutionContext,
  IParameterValidationResult,
  TToolExecutor,
  TToolParameters,
  IEventService,
} from '../interfaces/tool';
import type { TUniversalValue } from '../interfaces/types';

/**
 * Function tool implementation
 * Wraps a JavaScript function as a tool with schema validation
 *
 * Implements IFunctionTool without extending AbstractTool to avoid
 * circular runtime dependency (tools -> agents -> tools).
 */
export class FunctionTool implements IFunctionTool {
  readonly schema: IToolSchema;
  readonly fn: TToolExecutor;
  private eventService: IEventService | undefined;

  constructor(schema: IToolSchema, fn: TToolExecutor) {
    this.schema = schema;
    this.fn = fn;
    this.validateConstructorInputs();
  }

  /**
   * Get tool name
   */
  getName(): string {
    return this.schema.name;
  }

  /**
   * Set EventService for post-construction injection.
   * Accepts EventService as-is without transformation.
   * Caller is responsible for providing properly configured EventService.
   */
  setEventService(eventService: IEventService | undefined): void {
    this.eventService = eventService;
  }

  /**
   * Execute the function tool
   */
  async execute(
    parameters: TToolParameters,
    context?: IToolExecutionContext,
  ): Promise<IToolResult> {
    const toolName = this.schema.name;

    // Validate parameters before execution
    if (!this.validate(parameters)) {
      const errors = getValidationErrors(
        parameters,
        this.schema.parameters.required || [],
        this.schema.parameters.properties || {},
        this.schema.parameters.additionalProperties,
      );
      throw new ValidationError(`Invalid parameters for tool "${toolName}": ${errors.join(', ')}`);
    }

    // Execute the function
    const startTime = Date.now();
    let result: TUniversalValue;
    try {
      result = await this.fn(parameters, context);
    } catch (error) {
      if (error instanceof ToolExecutionError || error instanceof ValidationError) {
        throw error;
      }

      throw new ToolExecutionError(
        `Function tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
        toolName,
        error instanceof Error ? error : new Error(String(error)),
        {
          parameterCount: Object.keys(parameters || {}).length,
          hasContext: !!context,
        },
      );
    }

    // SELFHOST-005: validate the tool OUTPUT against its declared schema (beside the tool-input
    // validation above), throwing before the result returns — same layer as the input validator.
    if (this.schema.outputSchema) {
      validateToolOutput(toolName, result, this.schema.outputSchema);
    }

    const executionTime = Date.now() - startTime;

    // SELFHOST-004: surface per-operation timing as a span-completion event whose PAYLOAD JOINS the
    // span id with the measured duration + op name (raw scalars). A consumer (agent-framework) turns
    // this into a record span entry; agent-core builds NO transport entry (it depends on neither
    // transport nor plugin — no cycle). Owner correlation (to the turn) is applied by the event
    // service's binding (`ownerPath`); the authoritative span id lives on the payload.
    if (this.eventService) {
      const spanEvent: ISpanCompletionEventData = {
        timestamp: new Date(),
        spanId: generateSpanId(),
        durationMs: executionTime,
        op: toolName,
      };
      this.eventService.emit(SPAN_EVENTS.COMPLETED, spanEvent);
    }

    return {
      success: true,
      data: result,
      metadata: {
        executionTime,
        toolName,
        parameters,
      },
    };
  }

  /**
   * Validate parameters (simple boolean result)
   */
  validate(parameters: TToolParameters): boolean {
    return (
      getValidationErrors(
        parameters,
        this.schema.parameters.required || [],
        this.schema.parameters.properties || {},
        this.schema.parameters.additionalProperties,
      ).length === 0
    );
  }

  /**
   * Validate tool parameters with detailed result
   */
  validateParameters(parameters: TToolParameters): IParameterValidationResult {
    return validateToolParameters(
      parameters,
      this.schema.parameters.required || [],
      this.schema.parameters.properties || {},
      this.schema.parameters.additionalProperties,
    );
  }

  /**
   * Get tool description
   */
  getDescription(): string {
    return this.schema.description;
  }

  /**
   * Validate constructor inputs
   */
  private validateConstructorInputs(): void {
    if (!this.schema) {
      throw new ValidationError('Tool schema is required');
    }

    if (!this.fn || typeof this.fn !== 'function') {
      throw new ValidationError('Tool function is required and must be a function');
    }

    if (!this.schema.name) {
      throw new ValidationError('Tool schema must have a name');
    }
  }
}
