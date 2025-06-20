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
import { zodToJsonSchema } from '../schema/zod-to-json';

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
        // Use the comprehensive zodToJsonSchema function instead of simplified conversion
        return zodToJsonSchema(this.parameters);
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