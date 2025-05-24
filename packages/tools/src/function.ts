/**
 * Function creation and invocation utilities
 * 
 * @module Function
 * @description
 * Utilities for creating and managing functions that AI can invoke.
 * Uses the zod library to perform validation of function parameters.
 */

import { z } from 'zod';
import type { FunctionDefinition, FunctionCallResult, FunctionCall } from './types';

/**
 * Function result type
 */
export type FunctionResult<TResult = unknown> = {
    result: TResult;
};

/**
 * Function options interface
 */
export interface FunctionOptions<TParams = unknown, TResult = unknown> {
    name: string;
    description?: string;
    parameters: z.ZodObject<any> | any;
    execute: (params: TParams) => Promise<TResult> | TResult;
}

/**
 * Function interface
 */
export interface ToolFunction<TParams = unknown, TResult = unknown> {
    name: string;
    description?: string;
    schema: FunctionDefinition;
    execute: (params: TParams) => Promise<TResult>;
}

/**
 * Convert zod schema to JSON schema format
 * @param schema zod schema
 * @returns JSON schema
 */
function zodToJsonSchema(schema: z.ZodObject<any>): any {
    const jsonSchema: any = {
        type: 'object',
        properties: {},
        required: []
    };

    // Convert zod schema's shape object to JSON schema properties
    const shape = schema._def.shape();
    const entries = Object.entries(shape);

    for (const [key, value] of entries) {
        const fieldSchema = convertZodTypeToJsonSchema(value as z.ZodTypeAny, key);
        jsonSchema.properties[key] = fieldSchema;

        // Check required fields (when not optional and not nullable)
        if (!isOptionalType(value as z.ZodTypeAny) && !isNullableType(value as z.ZodTypeAny)) {
            if (!jsonSchema.required) {
                jsonSchema.required = [];
            }
            jsonSchema.required.push(key);
        }
    }

    return jsonSchema;
}

/**
 * Convert zod type to JSON schema type
 * @param zodType zod type
 * @param fieldName field name (for error messages)
 * @returns JSON schema type
 */
function convertZodTypeToJsonSchema(zodType: z.ZodTypeAny, fieldName: string): any {
    // Basic JSON schema object
    const jsonSchema: any = {};

    // Extract description
    const description = getZodDescription(zodType);
    if (description) {
        jsonSchema.description = description;
    }

    // Convert by type
    if (zodType instanceof z.ZodString) {
        jsonSchema.type = 'string';

        // String constraints
        if (zodType._def.checks) {
            for (const check of zodType._def.checks) {
                if (check.kind === 'min') {
                    jsonSchema.minLength = check.value;
                } else if (check.kind === 'max') {
                    jsonSchema.maxLength = check.value;
                } else if (check.kind === 'regex') {
                    jsonSchema.pattern = check.regex.source;
                } else if (check.kind === 'email') {
                    jsonSchema.format = 'email';
                } else if (check.kind === 'url') {
                    jsonSchema.format = 'uri';
                }
            }
        }
    } else if (zodType instanceof z.ZodNumber) {
        jsonSchema.type = 'number';

        // Number constraints
        if (zodType._def.checks) {
            for (const check of zodType._def.checks) {
                if (check.kind === 'min') {
                    jsonSchema.minimum = check.value;
                } else if (check.kind === 'max') {
                    jsonSchema.maximum = check.value;
                } else if (check.kind === 'int') {
                    jsonSchema.type = 'integer';
                }
            }
        }
    } else if (zodType instanceof z.ZodBoolean) {
        jsonSchema.type = 'boolean';
    } else if (zodType instanceof z.ZodArray) {
        jsonSchema.type = 'array';
        jsonSchema.items = convertZodTypeToJsonSchema(zodType._def.type, `${fieldName}[]`);

        // Array constraints
        if (zodType._def.minLength !== null) {
            jsonSchema.minItems = zodType._def.minLength.value;
        }
        if (zodType._def.maxLength !== null) {
            jsonSchema.maxItems = zodType._def.maxLength.value;
        }
    } else if (zodType instanceof z.ZodEnum) {
        jsonSchema.type = 'string';
        jsonSchema.enum = zodType._def.values;
    } else if (zodType instanceof z.ZodObject) {
        jsonSchema.type = 'object';
        const nestedSchema = zodToJsonSchema(zodType);
        jsonSchema.properties = nestedSchema.properties;
        jsonSchema.required = nestedSchema.required;
    } else if (zodType instanceof z.ZodUnion) {
        jsonSchema.oneOf = zodType._def.options.map((option: z.ZodTypeAny) =>
            convertZodTypeToJsonSchema(option, fieldName)
        );
    } else if (zodType instanceof z.ZodOptional) {
        return convertZodTypeToJsonSchema(zodType._def.innerType, fieldName);
    } else if (zodType instanceof z.ZodNullable) {
        const innerSchema = convertZodTypeToJsonSchema(zodType._def.innerType, fieldName);
        jsonSchema.type = [innerSchema.type, 'null'];
        Object.assign(jsonSchema, innerSchema);
    } else if (zodType instanceof z.ZodDefault) {
        const innerSchema = convertZodTypeToJsonSchema(zodType._def.innerType, fieldName);
        Object.assign(jsonSchema, innerSchema);
        jsonSchema.default = zodType._def.defaultValue();
    } else {
        // Other types are handled as strings
        jsonSchema.type = 'string';
        console.warn(`Unsupported zod type for field ${fieldName}, using string as fallback`);
    }

    return jsonSchema;
}

/**
 * Extract description from zod type
 * @param zodType zod type
 * @returns description string
 */
function getZodDescription(zodType: z.ZodTypeAny): string | undefined {
    // Extract description from zod type metadata
    const description = zodType._def.description;
    if (description) return description;

    // Recursively extract description if there's an inner type
    if (zodType instanceof z.ZodOptional || zodType instanceof z.ZodNullable) {
        return getZodDescription(zodType._def.innerType);
    }

    return undefined;
}

/**
 * Check if zod type is optional
 * @param zodType zod type
 * @returns whether it's optional
 */
function isOptionalType(zodType: z.ZodTypeAny): boolean {
    return zodType instanceof z.ZodOptional ||
        (zodType instanceof z.ZodDefault);
}

/**
 * Check if zod type allows null
 * @param zodType zod type
 * @returns whether it's nullable
 */
function isNullableType(zodType: z.ZodTypeAny): boolean {
    return zodType instanceof z.ZodNullable;
}

/**
 * Create a function
 * 
 * @function createFunction
 * @description
 * Creates a function that AI can invoke.
 * You can define function name, description, parameter schema, and execution logic.
 * 
 * @template TParams function parameter type
 * @template TResult function return result type
 * @param {FunctionOptions<TParams, TResult>} options - Function options
 * @param {string} options.name - Function name
 * @param {string} [options.description] - Function description
 * @param {z.ZodObject<any> | any} options.parameters - Parameter schema
 * @param {(params: TParams) => Promise<TResult> | TResult} options.execute - Execution logic
 * @returns {Function<TParams, TResult>} Created function object
 * 
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { createFunction } from '@robota-sdk/core';
 * 
 * const getWeather = createFunction({
 *   name: 'getWeather',
 *   description: 'Get weather information for a specific location.',
 *   parameters: z.object({
 *     location: z.string().describe('Location to check weather (city name)'),
 *     unit: z.enum(['celsius', 'fahrenheit']).optional().describe('Temperature unit')
 *   }),
 *   execute: async (params) => {
 *     // Weather API call logic
 *     return { temperature: 25, condition: 'sunny' };
 *   }
 * });
 * ```
 */
export function createFunction<TParams = unknown, TResult = unknown>(
    options: FunctionOptions<TParams, TResult>
): ToolFunction<TParams, TResult> {
    const { name, description, parameters, execute } = options;

    // Convert zod schema to JSON schema
    const schema: FunctionDefinition = {
        name,
        description,
        parameters: parameters instanceof z.ZodObject
            ? zodToJsonSchema(parameters)
            : parameters
    };

    // Function execution wrapper
    const wrappedExecute = async (params: TParams): Promise<TResult> => {
        try {
            // Validate parameters if zod schema exists
            if (parameters instanceof z.ZodObject) {
                parameters.parse(params);
            }

            // Execute function
            return await Promise.resolve(execute(params));
        } catch (error) {
            // Handle zod validation errors
            if (error instanceof z.ZodError) {
                const errorMessage = error.errors.map(e =>
                    `${e.path.join('.')}: ${e.message}`
                ).join(', ');

                throw new Error(`Parameter validation failed: ${errorMessage}`);
            }

            // Propagate other errors as is
            throw error;
        }
    };

    // Create function object
    return {
        name,
        description,
        schema,
        execute: wrappedExecute
    };
}

/**
 * Convert callback function to Function object
 * 
 * @function functionFromCallback
 * @description
 * Converts a regular JavaScript function to a Function object that AI can invoke.
 * 
 * @param {string} name - Function name
 * @param {Function} fn - Callback function to convert
 * @param {string} [description] - Function description
 * @returns {Function} Created function object
 * 
 * @example
 * ```typescript
 * import { functionFromCallback } from '@robota-sdk/core';
 * 
 * const calculateSum = functionFromCallback(
 *   'calculateSum',
 *   (a: number, b: number) => a + b,
 *   'Calculate the sum of two numbers.'
 * );
 * ```
 */
export function functionFromCallback(
    name: string,
    fn: (...args: any[]) => any,
    description?: string
): ToolFunction<Record<string, any>, any> {
    // Extract function parameter information
    const fnStr = fn.toString();
    const argsMatch = fnStr.match(/\(([^)]*)\)/);
    const argNames = argsMatch ? argsMatch[1].split(',').map(arg => arg.trim()).filter(Boolean) : [];

    // Create parameter schema
    const paramSchema = {
        type: 'object',
        properties: Object.fromEntries(argNames.map(name => [name, { type: 'string' }])),
        required: argNames
    };

    // Wrap execution function
    const execute = async (params: Record<string, any>) => {
        const args = argNames.map(name => params[name]);
        return await Promise.resolve(fn(...args));
    };

    return {
        name,
        description,
        schema: { name, description, parameters: paramSchema },
        execute
    };
}

/**
 * Utility function to convert function schema to Zod schema
 */
export function createFunctionSchema(definition: FunctionDefinition) {
    const propertySchemas: Record<string, z.ZodTypeAny> = {};

    if (definition.parameters && definition.parameters.properties) {
        for (const [key, prop] of Object.entries(definition.parameters.properties)) {
            switch (prop.type) {
                case 'string':
                    propertySchemas[key] = z.string();
                    break;
                case 'number':
                    propertySchemas[key] = z.number();
                    break;
                case 'boolean':
                    propertySchemas[key] = z.boolean();
                    break;
                case 'array':
                    propertySchemas[key] = z.array(z.any());
                    break;
                case 'object':
                    propertySchemas[key] = z.record(z.any());
                    break;
                default:
                    propertySchemas[key] = z.any();
            }
        }
    }

    return z.object(propertySchemas);
}

/**
 * Function call handler type
 */
export type FunctionHandler = (
    args: Record<string, any>,
    context?: any
) => Promise<any>;

/**
 * Function call registry
 */
export class FunctionRegistry {
    private functions: Map<string, FunctionHandler> = new Map();
    private definitions: Map<string, FunctionDefinition> = new Map();

    /**
     * Register a function
     */
    register(definition: FunctionDefinition, handler: FunctionHandler): void {
        this.functions.set(definition.name, handler);
        this.definitions.set(definition.name, definition);
    }

    /**
     * Get all registered function definitions
     */
    getAllDefinitions(): FunctionDefinition[] {
        return Array.from(this.definitions.values());
    }

    /**
     * Get function definition by name
     */
    getDefinition(name: string): FunctionDefinition | undefined {
        return this.definitions.get(name);
    }

    /**
     * Execute function call
     */
    async execute(
        functionCall: FunctionCall,
        context?: any
    ): Promise<FunctionCallResult> {
        const { name, arguments: args } = functionCall;
        const handler = this.functions.get(name);

        if (!handler) {
            throw new Error(`Function '${name}' is not registered`);
        }

        try {
            const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;
            const result = await handler(parsedArgs, context);

            return {
                name,
                result
            };
        } catch (error) {
            return {
                name,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
} 