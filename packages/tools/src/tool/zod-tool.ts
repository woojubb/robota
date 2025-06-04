/**
 * Zod schema-based tool
 * 
 * @module ZodTool
 * @description
 * Tool that uses Zod schema for parameter validation.
 */

import { z } from 'zod';
import type { FunctionSchema } from '../types';
import { BaseTool } from './base-tool';
import type { ZodToolOptions } from './interfaces';

/**
 * Zod schema-based tool class
 * 
 * @class ZodTool
 * @extends BaseTool
 * @description Tool that uses Zod schema for parameter validation.
 * 
 * @template TParams - Tool parameter type
 * @template TResult - Tool result type
 * 
 * @see {@link ../../../../apps/examples/02-functions | Function Tool Examples}
 */
export class ZodTool<TParams = any, TResult = any> extends BaseTool<TParams, TResult> {
    /**
     * Zod schema
     */
    private readonly parameters: z.ZodObject<any>;

    /**
     * Constructor
     * 
     * @param options - Zod tool options
     */
    constructor(options: ZodToolOptions<TParams, TResult>) {
        super(options);
        this.parameters = options.parameters;
    }

    /**
     * Tool schema (returns Zod schema)
     * 
     * @returns Zod schema
     */
    public get schema(): z.ZodObject<any> {
        return this.parameters;
    }

    /**
     * Convert Zod schema to JSON schema
     * 
     * @returns JSON schema format parameter definition
     */
    protected toJsonSchema(): FunctionSchema['parameters'] {
        const jsonSchema: FunctionSchema['parameters'] = {
            type: 'object',
            properties: {}
        };

        const shape = this.parameters.shape;

        // Convert Zod schema to JSON schema format
        for (const [key, zodType] of Object.entries(shape)) {
            jsonSchema.properties[key] = {
                type: this.getSchemaType(zodType as z.ZodTypeAny),
                description: this.getZodDescription(zodType as z.ZodTypeAny) || undefined
            };

            // Add enum values if present
            if ((zodType as any)._def.values) {
                jsonSchema.properties[key].enum = (zodType as any)._def.values;
            }
        }

        // Add required fields
        jsonSchema.required = Object.entries(shape)
            .filter(([_key, zodType]) => !this.isOptionalType(zodType as z.ZodTypeAny))
            .map(([key]) => key);

        if (jsonSchema.required?.length === 0) {
            delete jsonSchema.required;
        }

        return jsonSchema;
    }

    /**
     * Validate parameters using Zod schema
     * 
     * @param params - Parameters to validate
     * @returns Validated parameters
     */
    protected validateParameters(params: any): TParams {
        return this.parameters.parse(params) as TParams;
    }

    /**
     * Extract description from Zod type
     * 
     * @param zodType - Zod type
     * @returns Description string
     */
    private getZodDescription(zodType: z.ZodTypeAny): string | undefined {
        // Extract description from Zod type metadata
        const description = (zodType as any)._def.description;
        if (description) return description;

        // Recursively extract description for inner types
        if (zodType instanceof z.ZodOptional || zodType instanceof z.ZodNullable) {
            return this.getZodDescription((zodType as any)._def.innerType);
        }

        return undefined;
    }

    /**
     * Convert Zod schema type to JSON schema type
     * 
     * @param schema - Zod schema
     * @returns JSON schema type string
     */
    private getSchemaType(schema: z.ZodTypeAny): string {
        if (schema instanceof z.ZodString) {
            return 'string';
        } else if (schema instanceof z.ZodNumber) {
            return 'number';
        } else if (schema instanceof z.ZodBoolean) {
            return 'boolean';
        } else if (schema instanceof z.ZodArray) {
            return 'array';
        } else if (schema instanceof z.ZodObject) {
            return 'object';
        } else if (schema instanceof z.ZodEnum) {
            return 'string';
        } else if (schema instanceof z.ZodOptional) {
            return this.getSchemaType((schema as any)._def.innerType);
        } else {
            return 'string';
        }
    }

    /**
     * Check if Zod type is optional
     * 
     * @param zodType - Zod type
     * @returns Whether the type is optional
     */
    private isOptionalType(zodType: z.ZodTypeAny): boolean {
        return zodType instanceof z.ZodOptional ||
            (zodType instanceof z.ZodDefault);
    }

    /**
     * Zod tool creation helper method
     * 
     * @param options - Zod tool options
     * @returns ZodTool instance
     */
    static create<TParams = any, TResult = any>(
        options: ZodToolOptions<TParams, TResult>
    ): ZodTool<TParams, TResult> {
        return new ZodTool<TParams, TResult>(options);
    }
} 