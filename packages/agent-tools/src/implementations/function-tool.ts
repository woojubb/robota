import type {
  IFunctionTool,
  IToolResult,
  IToolExecutionContext,
  IParameterValidationResult,
  TToolExecutor,
  TToolParameters,
  IEventService,
} from '@robota-sdk/agent-core';
import type { IToolSchema } from '@robota-sdk/agent-core';
import { ToolExecutionError, ValidationError } from '@robota-sdk/agent-core';
import type { TUniversalValue } from '@robota-sdk/agent-core';

// Import from Facade pattern modules for type safety
import type { IZodSchema } from './function-tool/types';
import { zodToJsonSchema } from './function-tool/schema-converter';
import { getValidationErrors, validateToolParameters } from './function-tool/parameter-validator';

/**
 * Function tool implementation
 * Wraps a JavaScript function as a tool with schema validation
 *
 * Implements IFunctionTool without extending AbstractTool to avoid
 * circular runtime dependency (tools → agents → tools).
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

    const executionTime = Date.now() - startTime;

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

/**
 * Helper function to create a function tool from a simple function
 */
export function createFunctionTool(
  name: string,
  description: string,
  parameters: IToolSchema['parameters'],
  fn: TToolExecutor,
): FunctionTool {
  const schema: IToolSchema = {
    name,
    description,
    parameters,
  };

  return new FunctionTool(schema, fn);
}

/**
 * Helper function to create a function tool from Zod schema
 */
export function createZodFunctionTool(
  name: string,
  description: string,
  zodSchema: IZodSchema,
  fn: TToolExecutor,
): FunctionTool {
  // Use comprehensive Zod to JSON schema conversion
  const parameters = zodToJsonSchema(zodSchema);

  const schema: IToolSchema = {
    name,
    description,
    parameters,
  };

  // Wrap the function with validation and ensure proper parameter handling
  const wrappedFn: TToolExecutor = async (
    parameters: TToolParameters,
    context?: IToolExecutionContext,
  ): Promise<TUniversalValue> => {
    // Use Zod for runtime validation
    const parseResult = zodSchema.safeParse(parameters);
    if (!parseResult.success) {
      throw new ValidationError(`Zod validation failed: ${parseResult.error}`);
    }

    const result = await fn(parseResult.data || parameters, context);
    // Ensure result is always a string for consistency with core package
    return typeof result === 'string' ? result : JSON.stringify(result);
  };

  return new FunctionTool(schema, wrappedFn);
}

// zodToJsonSchema function moved to Facade pattern schema-converter module
