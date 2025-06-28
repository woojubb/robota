import type { ToolInterface, ToolResult, ToolExecutionContext, ParameterValidationResult } from '../interfaces/tool';
import type { ToolSchema } from '../interfaces/provider';

/**
 * Reusable type definitions for base tool
 */

/**
 * Base tool parameters type
 * Used for parameter validation and execution in base tool context
 */
export type BaseToolParameters = Record<string, string | number | boolean | string[] | number[] | boolean[] | null>;

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