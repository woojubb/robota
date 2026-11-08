import type { TToolParameters, TUniversalValue } from '@robota-sdk/agent-core';

// Zod compatibility types and schema conversion moved to @robota-sdk/agent-core (CORE-015 SSOT):
// IZodSchema, IZodSchemaDef, IZodParseResult, ISchemaConversionOptions, zodToJsonSchema.

/**
 * Parameter type validation options
 */
export interface IFunctionToolValidationOptions {
  strict?: boolean;
  allowUnknown?: boolean;
  validateTypes?: boolean;
}

/**
 * Tool execution metadata
 */
export interface IFunctionToolExecutionMetadata {
  executionTime: number;
  toolName: string;
  parameters: TToolParameters;
}

/**
 * Tool result with metadata
 */
export interface IFunctionToolResult {
  success: boolean;
  data: TUniversalValue;
  metadata?: IFunctionToolExecutionMetadata;
}
