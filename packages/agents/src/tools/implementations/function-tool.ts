import type { FunctionTool as IFunctionTool, ToolResult, ToolExecutionContext, ParameterValidationResult } from '../../interfaces/tool';
import type { ToolSchema } from '../../interfaces/provider';
import { BaseTool } from '../../abstracts/base-tool';
import { ToolExecutionError, ValidationError } from '../../utils/errors';
import { logger } from '../../utils/logger';

/**
 * Function tool implementation
 * Wraps a JavaScript function as a tool with schema validation
 */
export class FunctionTool extends BaseTool implements IFunctionTool {
    readonly schema: ToolSchema;
    readonly fn: (...args: any[]) => Promise<any>;

    constructor(schema: ToolSchema, fn: (...args: any[]) => Promise<any>) {
        super();
        this.schema = schema;
        this.fn = fn;
        this.validateConstructorInputs();
    }

    /**
     * Execute the function tool
     */
    async execute(parameters: Record<string, any>, context?: ToolExecutionContext): Promise<ToolResult> {
        const toolName = this.schema.name;

        try {
            // Validate parameters
            if (!this.validate(parameters)) {
                const errors = this.getValidationErrors(parameters);
                throw new ValidationError(`Invalid parameters for tool "${toolName}": ${errors.join(', ')}`);
            }

            logger.debug(`Executing function tool "${toolName}"`, {
                toolName,
                parameters,
                context
            });

            // Execute the function
            const startTime = Date.now();
            const result = await this.fn(parameters);
            const executionTime = Date.now() - startTime;

            logger.debug(`Function tool "${toolName}" executed successfully`, {
                toolName,
                executionTime,
                resultType: typeof result
            });

            return {
                success: true,
                data: result,
                metadata: {
                    executionTime,
                    toolName,
                    parameters
                }
            };

        } catch (error) {
            logger.error(`Function tool "${toolName}" execution failed`, {
                toolName,
                parameters,
                error: error instanceof Error ? error.message : String(error)
            });

            throw new ToolExecutionError(
                `Function execution failed: ${error instanceof Error ? error.message : String(error)}`,
                toolName,
                error instanceof Error ? error : new Error(String(error)),
                { parameters, context }
            );
        }
    }

    /**
     * Enhanced validation with detailed error reporting
     */
    validate(parameters: Record<string, any>): boolean {
        return this.getValidationErrors(parameters).length === 0;
    }

    /**
     * Validate tool parameters with detailed result
     */
    validateParameters(parameters: Record<string, any>): ParameterValidationResult {
        const errors = this.getValidationErrors(parameters);
        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Get detailed validation errors
     */
    private getValidationErrors(parameters: Record<string, any>): string[] {
        const errors: string[] = [];
        const required = this.schema.parameters.required || [];
        const properties = this.schema.parameters.properties || {};

        // Check required parameters
        for (const field of required) {
            if (!(field in parameters)) {
                errors.push(`Missing required parameter: ${field}`);
            }
        }

        // Check parameter types and constraints
        for (const [key, value] of Object.entries(parameters)) {
            const paramSchema = properties[key];
            if (!paramSchema) {
                errors.push(`Unknown parameter: ${key}`);
                continue;
            }

            const typeError = this.validateParameterType(key, value, paramSchema);
            if (typeError) {
                errors.push(typeError);
            }
        }

        return errors;
    }

    /**
     * Validate individual parameter type
     */
    private validateParameterType(key: string, value: any, schema: any): string | null {
        const expectedType = schema.type;

        switch (expectedType) {
            case 'string':
                if (typeof value !== 'string') {
                    return `Parameter "${key}" must be a string, got ${typeof value}`;
                }
                break;

            case 'number':
                if (typeof value !== 'number' || isNaN(value)) {
                    return `Parameter "${key}" must be a number, got ${typeof value}`;
                }
                break;

            case 'boolean':
                if (typeof value !== 'boolean') {
                    return `Parameter "${key}" must be a boolean, got ${typeof value}`;
                }
                break;

            case 'array':
                if (!Array.isArray(value)) {
                    return `Parameter "${key}" must be an array, got ${typeof value}`;
                }
                break;

            case 'object':
                if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                    return `Parameter "${key}" must be an object, got ${typeof value}`;
                }
                break;
        }

        // Check enum constraints
        if (schema.enum && !schema.enum.includes(value)) {
            return `Parameter "${key}" must be one of: ${schema.enum.join(', ')}, got ${value}`;
        }

        return null;
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
    parameters: ToolSchema['parameters'],
    fn: (...args: any[]) => Promise<any>
): FunctionTool {
    const schema: ToolSchema = {
        name,
        description,
        parameters
    };

    return new FunctionTool(schema, fn);
}

/**
 * Helper function to create a function tool from Zod schema
 */
export function createZodFunctionTool(
    name: string,
    description: string,
    zodSchema: any, // Zod schema
    fn: (...args: any[]) => Promise<any>
): FunctionTool {
    // Convert Zod schema to JSON schema format
    // This is a simplified conversion - in production, you might want to use a library
    const parameters: ToolSchema['parameters'] = {
        type: 'object',
        properties: {},
        required: []
    };

    // Basic Zod to JSON schema conversion
    // Note: This is simplified - for production use, consider using @anatine/zod-to-openapi
    if (zodSchema._def) {
        const shape = zodSchema._def.shape;
        if (shape) {
            for (const [key, zodField] of Object.entries(shape())) {
                const field = zodField as any;
                const fieldType = field._def?.typeName?.toLowerCase().replace('zod', '') || 'string';

                parameters.properties![key] = {
                    type: fieldType === 'string' ? 'string' :
                        fieldType === 'number' ? 'number' :
                            fieldType === 'boolean' ? 'boolean' :
                                fieldType === 'array' ? 'array' : 'object',
                    description: field._def?.description || `${key} parameter`
                };

                if (!field._def?.optional) {
                    parameters.required!.push(key);
                }
            }
        }
    }

    const schema: ToolSchema = {
        name,
        description,
        parameters
    };

    return new FunctionTool(schema, fn);
} 