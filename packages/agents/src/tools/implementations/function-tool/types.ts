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
 * TODO: Consider moving to @robota-sdk/tools package for better isolation
 */

import type { ToolParameters, ToolExecutionContext, ToolExecutionData, ParameterValidationResult } from '../../../interfaces/tool';
import type { ToolSchema } from '../../../interfaces/provider';

/**
 * Zod schema compatibility types
 */
export interface ZodParseResult {
    success: boolean;
    data?: ToolParameters;
    error?: string | Error;
}

export interface ZodSchemaDef {
    typeName?: string;
    innerType?: ZodSchema;
    checks?: Array<{ kind: string; value?: ToolParameterValue }>;
    shape?: () => Record<string, ZodSchema>;
    type?: ZodSchema;
    values?: ToolParameterValue[];
    description?: string;
}

export interface ZodSchema {
    parse(value: ToolParameters): ToolParameters;
    safeParse(value: ToolParameters): ZodParseResult;
    _def?: ZodSchemaDef;
}

/**
 * Tool executor function type
 */
export type ToolExecutor = (
    parameters: ToolParameters,
    context?: ToolExecutionContext
) => Promise<ToolExecutionData>;

/**
 * Function tool interface
 */
export interface IFunctionTool {
    readonly schema: ToolSchema;
    readonly fn: ToolExecutor;
    execute(parameters: ToolParameters, context?: ToolExecutionContext): Promise<ToolResult>;
    validate(parameters: ToolParameters): boolean;
    validateParameters(parameters: ToolParameters): ParameterValidationResult;
}

/**
 * Parameter type validation options
 */
export interface ValidationOptions {
    strict?: boolean;
    allowUnknown?: boolean;
    validateTypes?: boolean;
}

/**
 * Schema conversion options
 */
export interface SchemaConversionOptions {
    includeDescription?: boolean;
    strictTypes?: boolean;
    allowAdditionalProperties?: boolean;
}

/**
 * Tool execution metadata
 */
export interface ToolExecutionMetadata {
    executionTime: number;
    toolName: string;
    parameters: ToolParameters;
}

/**
 * Tool result with metadata
 */
export interface ToolResult {
    success: boolean;
    data: ToolExecutionData;
    metadata?: ToolExecutionMetadata;
}

/**
 * Tool parameter value types (for compatibility)
 */
export type ToolParameterValue =
    | string
    | number
    | boolean
    | string[]
    | number[]
    | boolean[]
    | Array<string | number | boolean>
    | Record<string, string | number | boolean>
    | null
    | undefined; 