/**
 * MCP schema-based tool
 * 
 * @module McpTool
 * @description
 * Tool that uses MCP (Model Context Protocol) schema format.
 */

import type { FunctionSchema } from '../types';
import { BaseTool } from './base-tool';
import type { McpToolOptions } from './interfaces';

/**
 * MCP schema-based tool class
 * 
 * @class McpTool
 * @extends BaseTool
 * @description
 * Tool that uses MCP (Model Context Protocol) schema format for parameter definition.
 * 
 * @template TParams - Tool parameter type
 * @template TResult - Tool result type
 * 
 * @see {@link ../../../../apps/examples/03-integrations/01-mcp-client.ts | MCP Integration Example}
 */
export class McpTool<TParams = any, TResult = any> extends BaseTool<TParams, TResult> {
    /**
     * MCP schema definition
     */
    private readonly parameters: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    };

    /**
     * Constructor
     * 
     * @param options - MCP tool options
     */
    constructor(options: McpToolOptions<TParams, TResult>) {
        super(options);
        this.parameters = options.parameters;
    }

    /**
     * Tool schema (returns MCP schema)
     * 
     * @returns MCP schema
     */
    public get schema(): any {
        return this.parameters;
    }

    /**
     * Convert MCP schema to JSON schema
     * 
     * @returns JSON schema format parameter definition
     */
    protected toJsonSchema(): FunctionSchema['parameters'] {
        return this.parameters as FunctionSchema['parameters'];
    }

    /**
     * Validate parameters using MCP schema
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

        return params as TParams;
    }

    /**
     * MCP tool creation helper method
     * 
     * @param options - MCP tool options
     * @returns McpTool instance
     */
    static create<TParams = any, TResult = any>(
        options: McpToolOptions<TParams, TResult>
    ): McpTool<TParams, TResult> {
        return new McpTool<TParams, TResult>(options);
    }
} 