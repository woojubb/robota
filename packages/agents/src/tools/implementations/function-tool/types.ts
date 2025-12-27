/**
 * FunctionTool - Type definitions for Facade pattern implementation
 * 
 * REASON: Complex Zod schema type compatibility requires separation of concerns
 * ALTERNATIVES_CONSIDERED:
 * 1. Fix all Zod undefined issues in single file (creates maintenance burden)
 * 2. Use any types strategically (reduces type safety)
 * 3. Remove Zod support entirely (breaks existing functionality)
 * 4. Create complex conditional types (adds cognitive overhead)
 * 5. Use type assertions everywhere (increases runtime risk)
 * NOTE: Tool functionality is now integrated into @robota-sdk/agents package
 */

import type { TToolParameterValue, TToolParameters } from '../../../interfaces/tool';
import type { TToolResultData } from '../../../interfaces/types';

/**
 * Zod schema compatibility types
 */
export interface IZodParseResult {
    success: boolean;
    data?: TToolParameters;
    error?: string | Error;
}

export interface IZodSchemaDef {
    typeName?: string;
    innerType?: IZodSchema;
    checks?: Array<{ kind: string; value?: TToolParameterValue }>;
    shape?: () => Record<string, IZodSchema>;
    type?: IZodSchema;
    values?: TToolParameterValue[];
    description?: string;
}

export interface IZodSchema {
    parse(value: TToolParameters): TToolParameters;
    safeParse(value: TToolParameters): IZodParseResult;
    _def?: IZodSchemaDef;
}

/**
 * Parameter type validation options
 */
export interface IValidationOptions {
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
    data: TToolResultData;
    metadata?: IFunctionToolExecutionMetadata;
}