import type { TToolParameters, TUniversalValue } from '@robota-sdk/agent-core';

/**
 * Zod schema compatibility types
 *
 * Widened to `unknown` so that actual Zod schemas (ZodObject<...>) are structurally
 * assignable without `as unknown as IZodSchema` casts at call sites.
 */
export interface IZodParseResult {
  success: boolean;
  data?: unknown;
  error?: unknown;
}

export interface IZodSchemaDef {
  typeName?: string;
  innerType?: IZodSchema;
  valueType?: IZodSchema;
  checks?: Array<{ kind: string; value?: TUniversalValue }>;
  shape?: () => Record<string, IZodSchema>;
  type?: IZodSchema;
  values?: TUniversalValue[];
  description?: string;
  unknownKeys?: 'passthrough' | 'strip' | 'strict';
}

export interface IZodSchema {
  parse(value: unknown): unknown;
  safeParse(value: unknown): IZodParseResult;
  _def?: IZodSchemaDef;
}

/**
 * Parameter type validation options
 */
export interface IFunctionToolValidationOptions {
  strict?: boolean;
  allowUnknown?: boolean;
  validateTypes?: boolean;
}

/**
 * Schema conversion options
 */
export interface ISchemaConversionOptions {
  includeDescription?: boolean;
  strictTypes?: boolean;
  allowAdditionalProperties?: boolean;
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
