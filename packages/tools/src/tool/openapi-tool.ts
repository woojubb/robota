/**
 * OpenAPI schema-based tool
 * 
 * @module OpenApiTool
 * @description
 * Tool that uses OpenAPI specification schema format.
 */

import type { FunctionSchema } from '../types';
import { BaseTool } from './base-tool';
import type { OpenApiToolOptions } from './interfaces';

/**
 * OpenAPI schema-based tool class
 * 
 * @class OpenApiTool
 * @extends BaseTool
 * @description
 * Tool that uses OpenAPI specification schema format for parameter definition.
 * 
 * @template TParams - Tool parameter type
 * @template TResult - Tool result type
 * 
 * @example
 * ```typescript
 * import { OpenApiTool } from '@robota-sdk/tools';
 * 
 * const apiTool = new OpenApiTool({
 *   name: 'userInfo',
 *   description: 'Get user information by ID',
 *   category: 'api',
 *   parameters: {
 *     type: 'object',
 *     properties: {
 *       userId: {
 *         type: 'string',
 *         description: 'Unique user identifier'
 *       },
 *       includeProfile: {
 *         type: 'boolean',
 *         description: 'Whether to include detailed profile information',
 *         default: false
 *       }
 *     },
 *     required: ['userId']
 *   },
 *   execute: async (params) => {
 *     // API call logic
 *     const userInfo = { id: params.userId, name: 'John Doe' };
 *     return {
 *       status: 'success',
 *       data: userInfo
 *     };
 *   }
 * });
 * ```
 */
export class OpenApiTool<TParams = any, TResult = any> extends BaseTool<TParams, TResult> {
    /**
     * OpenAPI parameter schema
     */
    private readonly parameters: FunctionSchema['parameters'];

    /**
     * Constructor
     * 
     * @param options - OpenAPI tool options
     */
    constructor(options: OpenApiToolOptions<TParams, TResult>) {
        super(options);
        this.parameters = options.parameters;
    }

    /**
     * Tool schema (returns OpenAPI schema)
     * 
     * @returns OpenAPI schema
     */
    public get schema(): FunctionSchema['parameters'] {
        return this.parameters;
    }

    /**
     * Convert OpenAPI schema to JSON schema
     * 
     * @returns JSON schema format parameter definition
     */
    protected toJsonSchema(): FunctionSchema['parameters'] {
        return this.parameters;
    }

    /**
     * Validate parameters using OpenAPI schema
     * 
     * @param params - Parameters to validate
     * @returns Validated parameters (basic validation)
     */
    protected validateParameters(params: any): TParams {
        if (this.parameters.required) {
            for (const required of this.parameters.required) {
                if (!(required in params)) {
                    throw new Error(`Required parameter '${required}' is missing`);
                }
            }
        }

        // Basic type validation for properties
        if (this.parameters.properties) {
            for (const [key, value] of Object.entries(params)) {
                const propertySchema = this.parameters.properties[key];
                if (!propertySchema) {
                    continue; // Allow extra properties
                }

                const expectedType = propertySchema.type;
                const actualType = typeof value;

                if (expectedType === 'number' && actualType !== 'number') {
                    if (actualType === 'string' && !isNaN(Number(value))) {
                        (params as any)[key] = Number(value);
                    } else {
                        throw new Error(`Parameter '${key}' must be a number`);
                    }
                } else if (expectedType === 'string' && actualType !== 'string') {
                    throw new Error(`Parameter '${key}' must be a string`);
                } else if (expectedType === 'boolean' && actualType !== 'boolean') {
                    throw new Error(`Parameter '${key}' must be a boolean`);
                } else if (expectedType === 'array' && !Array.isArray(value)) {
                    throw new Error(`Parameter '${key}' must be an array`);
                } else if (expectedType === 'object' && (actualType !== 'object' || Array.isArray(value))) {
                    throw new Error(`Parameter '${key}' must be an object`);
                }
            }
        }

        return params as TParams;
    }

    /**
     * OpenAPI tool creation helper method
     * 
     * @param options - OpenAPI tool options
     * @returns OpenApiTool instance
     */
    static create<TParams = any, TResult = any>(
        options: OpenApiToolOptions<TParams, TResult>
    ): OpenApiTool<TParams, TResult> {
        return new OpenApiTool<TParams, TResult>(options);
    }
} 