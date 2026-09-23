import { FunctionTool, ValidationError, zodToJsonSchema } from '@robota-sdk/agent-core';

import type { IToolExecutionContext, TToolExecutor, TToolParameters } from '@robota-sdk/agent-core';
import type { IToolSchema } from '@robota-sdk/agent-core';
import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { TypeOf, ZodType } from 'zod';

// The concrete `FunctionTool` class is owned by @robota-sdk/agent-core (DATA-005 SSOT).
// These factories construct core's `FunctionTool`; agent-tools owns only the factories
// and the Zod-flavored wrapper.

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
 * What a tool declares about itself beyond its callable shape (CLI-1990).
 *
 * Optional, and omission is a declaration too: a tool that says nothing is RESIDENT — its schema is
 * sent on every request, which is what every tool in the tree does today.
 */
export interface IFunctionToolResidencyOptions {
  /**
   * Withhold this tool's schema from the model until it is loaded by `ToolSearch` or forced by a
   * `toolChoice`. Only honoured while the tool-search policy is engaged, so declaring it on a small
   * tool set costs nothing.
   */
  deferLoading?: boolean;
}

/**
 * Helper function to create a function tool from Zod schema
 */
export function createZodFunctionTool<S extends ZodType>(
  name: string,
  description: string,
  zodSchema: S,
  fn: TToolExecutor<TypeOf<S>>,
  residency: IFunctionToolResidencyOptions = {},
): FunctionTool {
  // Use comprehensive Zod to JSON schema conversion
  const parameters = zodToJsonSchema(zodSchema);

  const schema: IToolSchema = {
    name,
    description,
    parameters,
    // Spread rather than assigned: an absent marker must stay ABSENT, not become `undefined`, so a
    // resident tool's schema is byte-identical to what it was before residency existed.
    ...(residency.deferLoading !== undefined && { deferLoading: residency.deferLoading }),
  };

  // Wrap the function with validation and ensure proper parameter handling
  const wrappedFn: TToolExecutor = async (
    parameters: TToolParameters,
    context?: IToolExecutionContext,
  ): Promise<TUniversalValue> => {
    // Use Zod for runtime validation — the executor receives the PARSED, schema-typed value
    // (SDK-009): the runtime guarantee and the compile-time type now flow together.
    const parseResult = zodSchema.safeParse(parameters);
    if (!parseResult.success) {
      throw new ValidationError(`Zod validation failed: ${parseResult.error}`);
    }

    const result = await fn(parseResult.data as TypeOf<S>, context);
    // Ensure result is always a string for consistency with core package
    return typeof result === 'string' ? result : JSON.stringify(result);
  };

  return new FunctionTool(schema, wrappedFn);
}

// zodToJsonSchema function moved to Facade pattern schema-converter module
