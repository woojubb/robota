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

import type { TToolParameters, IToolExecutionContext, TToolExecutionData, ParameterValidationResult } from '../../../interfaces/tool';
import type { IToolSchema } from '../../../interfaces/provider';

/**
 * Zod schema compatibility types
 */
export interface ZodParseResult {
    success: boolean;
    data?: TToolParameters;
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
    parse(value: TToolParameters): TToolParameters;
    safeParse(value: TToolParameters): ZodParseResult;
    _def?: ZodSchemaDef;
}

/**
 * Tool executor function type
 */
export type ToolExecutor = (
    parameters: TToolParameters,
    context?: IToolExecutionContext
) => Promise<TToolExecutionData>;

/**
 * Function tool interface
 */
export interface IFunctionTool {
    readonly schema: IToolSchema;
    readonly fn: ToolExecutor;
    execute(parameters: TToolParameters, context?: IToolExecutionContext): Promise<IFunctionToolResult>;
    validate(parameters: TToolParameters): boolean;
    validateParameters(parameters: TToolParameters): ParameterValidationResult;
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
    parameters: TToolParameters;
}

/**
 * Tool result with metadata
 */
export interface IFunctionToolResult {
    success: boolean;
    data: TToolExecutionData;
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