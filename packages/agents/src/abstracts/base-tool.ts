import type { ToolInterface, ToolResult, ToolExecutionContext, ParameterValidationResult } from '../interfaces/tool';
import type { ToolSchema } from '../interfaces/provider';

/**
 * Base tool parameters type - extended for full ToolParameters compatibility
 * Used for parameter validation and execution in base tool context
 * 
 * REASON: Extended to include all ToolParameterValue types for complete compatibility
 * ALTERNATIVES_CONSIDERED: 
 * 1. Keep narrow type and use type assertions everywhere (increases maintenance burden)
 * 2. Create separate conversion functions (adds complexity without benefit)
 * 3. Use intersection types (unnecessary complexity for this use case)
 * 4. Modify ToolParameters to remove complex types (breaks existing APIs)
 * 5. Create type conversion utilities (adds runtime overhead)
 * TODO: Monitor usage patterns and consider narrowing if complex types cause runtime issues
 */
export type BaseToolParameters = Record<string,
    | string
    | number
    | boolean
    | string[]
    | number[]
    | boolean[]
    | Array<string | number | boolean>
    | Record<string, string | number | boolean>
    | null
    | undefined
>;

/**
 * Tool execution function type with proper parameter constraints
 */
export type ToolExecutionFunction<TParams = BaseToolParameters, TResult = ToolResult> = (
    parameters: TParams
) => Promise<TResult> | TResult;

/**
 * Base tool interface with type parameters for enhanced type safety
 * 
 * @template TParams - Tool parameters type (defaults to BaseToolParameters for backward compatibility)
 * @template TResult - Tool result type (defaults to ToolResult for backward compatibility)  
 */
export interface BaseToolInterface<TParams = BaseToolParameters, TResult = ToolResult> {
    name: string;
    description: string;
    parameters: ToolSchema['parameters'];
    execute: ToolExecutionFunction<TParams, TResult>;
}

/**
 * Type-safe tool interface with type parameters
 * 
 * @template TParameters - Tool parameters type (defaults to BaseToolParameters for backward compatibility)
 * @template TResult - Tool result type (defaults to ToolResult for backward compatibility)
 */
export interface TypeSafeToolInterface<TParameters = BaseToolParameters, TResult = ToolResult> {
    readonly schema: ToolSchema;
    execute(parameters: TParameters, context?: ToolExecutionContext): Promise<TResult>;
    validate(parameters: TParameters): boolean;
    validateParameters(parameters: TParameters): ParameterValidationResult;
    getDescription(): string;
    getName(): string;
}

/**
 * Base abstract class for tools with type parameter support
 * Provides type-safe parameter handling and result processing
 * 
 * @template TParameters - Tool parameters type (defaults to BaseToolParameters for backward compatibility)
 * @template TResult - Tool result type (defaults to ToolResult for backward compatibility)
 */
export abstract class BaseTool<TParameters = BaseToolParameters, TResult = ToolResult>
    implements TypeSafeToolInterface<TParameters, TResult> {
    abstract readonly schema: ToolSchema;

    abstract execute(parameters: TParameters, context?: ToolExecutionContext): Promise<TResult>;

    validate(parameters: TParameters): boolean {
        const required = this.schema.parameters.required || [];
        return required.every(field => field in (parameters as Record<string, string | number | boolean>));
    }

    /**
     * Validate tool parameters with detailed result (default implementation)
     */
    validateParameters(parameters: TParameters): ParameterValidationResult {
        const required = this.schema.parameters.required || [];
        const errors: string[] = [];
        const paramObj = parameters as Record<string, string | number | boolean>;

        for (const field of required) {
            if (!(field in paramObj)) {
                errors.push(`Missing required parameter: ${field}`);
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    getDescription(): string {
        return this.schema.description;
    }

    getName(): string {
        return this.schema.name;
    }
}

/**
 * Legacy tool class for backward compatibility
 * @deprecated Use BaseTool with type parameters instead
 */
export abstract class LegacyBaseTool extends BaseTool<BaseToolParameters, ToolResult> implements ToolInterface { } 