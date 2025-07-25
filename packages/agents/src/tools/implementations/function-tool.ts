import type { FunctionTool as IFunctionTool, ToolResult, ToolExecutionContext, ParameterValidationResult, ToolExecutor, ToolExecutionData, ToolParameters, ToolParameterValue } from '../../interfaces/tool';
import type { ToolSchema, ParameterSchema } from '../../interfaces/provider';
import { BaseTool, type BaseToolOptions } from '../../abstracts/base-tool';
import { ToolExecutionError, ValidationError } from '../../utils/errors';

// Import from Facade pattern modules for type safety
import type { ZodSchema } from './function-tool/types';
import { zodToJsonSchema } from './function-tool/schema-converter';

// Zod type definitions moved to Facade pattern modules

/**
 * Function tool implementation
 * Wraps a JavaScript function as a tool with schema validation
 * 
 * @extends BaseTool<ToolParameters, ToolResult>
 */
export class FunctionTool extends BaseTool<ToolParameters, ToolResult> implements IFunctionTool {
    readonly schema: ToolSchema;
    readonly fn: ToolExecutor;

    constructor(schema: ToolSchema, fn: ToolExecutor, options: BaseToolOptions = {}) {
        super(options);
        this.schema = schema;
        this.fn = fn;
        this.validateConstructorInputs();
    }

    /**
     * Execute the function tool implementation
     * This method is called by the parent's Template Method Pattern
     */
    protected async executeImpl(parameters: ToolParameters, context?: ToolExecutionContext): Promise<ToolResult> {
        const toolName = this.schema.name;

        try {
            // Validate parameters
            if (!this.validate(parameters)) {
                const errors = this.getValidationErrors(parameters);
                throw new ValidationError(`Invalid parameters for tool "${toolName}": ${errors.join(', ')}`);
            }

            this.logger.debug(`Executing function tool "${toolName}"`, {
                toolName,
                parameterCount: Object.keys(parameters || {}).length,
                hasContext: !!context
            });

            // Execute the function
            const startTime = Date.now();
            const result = await this.fn(parameters, context);
            const executionTime = Date.now() - startTime;

            this.logger.debug(`Function tool "${toolName}" executed successfully`, {
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
            this.logger.error(`Function tool "${toolName}" execution failed`, {
                toolName,
                error: error instanceof Error ? error.message : error,
                parameters
            });

            if (error instanceof ToolExecutionError || error instanceof ValidationError) {
                throw error;
            }

            throw new ToolExecutionError(
                `Function tool execution failed: ${error instanceof Error ? error.message : error}`,
                toolName,
                error instanceof Error ? error : new Error(String(error)),
                {
                    parameterCount: Object.keys(parameters || {}).length,
                    hasContext: !!context
                }
            );
        }
    }

    /**
     * Enhanced validation with detailed error reporting
     */
    override validate(parameters: ToolParameters): boolean {
        return this.getValidationErrors(parameters).length === 0;
    }

    /**
     * Validate tool parameters with detailed result
     */
    override validateParameters(parameters: ToolParameters): ParameterValidationResult {
        const errors = this.getValidationErrors(parameters);
        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Get detailed validation errors
     */
    private getValidationErrors(parameters: ToolParameters): string[] {
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
    private validateParameterType(key: string, value: ToolParameterValue, schema: ParameterSchema): string | null {
        const expectedType = schema['type'];

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
                // Check array items if specified
                if (schema.items) {
                    for (let i = 0; i < value.length; i++) {
                        const itemError = this.validateParameterType(`${key}[${i}]`, value[i], schema.items);
                        if (itemError) {
                            return itemError;
                        }
                    }
                }
                break;

            case 'object':
                if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                    return `Parameter "${key}" must be an object, got ${typeof value}`;
                }
                break;
        }

        // Check enum constraints
        if (schema.enum && schema.enum.length > 0) {
            const enumValues = schema.enum;
            let isValidEnum = false;

            // Type-safe enum checking based on JSONSchemaEnum type
            for (const enumValue of enumValues) {
                if (value === enumValue) {
                    isValidEnum = true;
                    break;
                }
            }

            if (!isValidEnum) {
                return `Parameter "${key}" must be one of: ${enumValues.join(', ')}, got ${value}`;
            }
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
    fn: ToolExecutor
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
    zodSchema: ZodSchema,
    fn: ToolExecutor
): FunctionTool {
    // Use comprehensive Zod to JSON schema conversion
    const parameters = zodToJsonSchema(zodSchema);

    const schema: ToolSchema = {
        name,
        description,
        parameters
    };

    // Wrap the function with validation and ensure proper parameter handling
    const wrappedFn: ToolExecutor = async (parameters: ToolParameters, context?: ToolExecutionContext): Promise<ToolExecutionData> => {
        // Use Zod for runtime validation
        const parseResult = zodSchema.safeParse(parameters);
        if (!parseResult.success) {
            throw new ValidationError(`Zod validation failed: ${parseResult.error}`);
        }

        const result = await fn(parseResult.data || parameters, context);
        // Ensure result is always a string for consistency with core package
        return typeof result === 'string' ? result : JSON.stringify(result);
    };

    return new FunctionTool(schema, wrappedFn);
}

// zodToJsonSchema function moved to Facade pattern schema-converter module 