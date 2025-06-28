import type { ToolInterface, ToolResult, ToolExecutionContext, ParameterValidationResult } from '../interfaces/tool';
import type { ToolSchema } from '../interfaces/provider';

/**
 * Reusable type definitions for base tool
 */

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
 * Base abstract class for tools
 */
export abstract class BaseTool implements ToolInterface {
    abstract readonly schema: ToolSchema;

    abstract execute(parameters: BaseToolParameters, context?: ToolExecutionContext): Promise<ToolResult>;

    validate(parameters: BaseToolParameters): boolean {
        const required = this.schema.parameters.required || [];
        return required.every(field => field in parameters);
    }

    /**
     * Validate tool parameters with detailed result (default implementation)
     */
    validateParameters(parameters: BaseToolParameters): ParameterValidationResult {
        const required = this.schema.parameters.required || [];
        const errors: string[] = [];

        for (const field of required) {
            if (!(field in parameters)) {
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