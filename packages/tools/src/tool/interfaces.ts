/**
 * Tool interfaces and type definitions
 * 
 * @module ToolInterfaces
 * @description
 * Common interfaces and type definitions used in the Tool module.
 */

import { z } from 'zod';
import type { FunctionDefinition, FunctionSchema } from '../types';

/**
 * Tool result interface
 * 
 * @template TResult - Result data type
 */
export interface ToolResult<TResult = any> {
    status: 'success' | 'error';
    data?: TResult;
    error?: string;
}

/**
 * Tool interface
 * 
 * @description
 * Base interface that all tools must implement.
 */
export interface ToolInterface {
    /**
     * Tool name
     */
    name: string;

    /**
     * Tool description
     */
    description?: string;

    /**
     * Tool schema
     */
    schema: any;

    /**
     * Tool execution function
     */
    execute: (args: any) => Promise<any>;

    /**
     * Convert to function definition
     */
    toFunctionDefinition(): FunctionDefinition;
}

/**
 * Base tool options interface
 * 
 * @template TParams - Parameter type
 * @template TResult - Result type
 */
export interface BaseToolOptions<TParams = any, TResult = any> {
    name: string;
    description: string;
    category?: string;
    version?: string;
    validateParams?: boolean;
    execute: (params: TParams) => Promise<ToolResult<TResult>> | ToolResult<TResult>;
    beforeExecute?: (params: TParams) => Promise<TParams> | TParams;
    afterExecute?: (result: ToolResult<TResult>) => Promise<ToolResult<TResult>> | ToolResult<TResult>;
}

/**
 * Zod tool options interface
 * 
 * @template TParams - Parameter type
 * @template TResult - Result type
 */
export interface ZodToolOptions<TParams = any, TResult = any> extends BaseToolOptions<TParams, TResult> {
    parameters: z.ZodObject<any>;
}

/**
 * MCP tool options interface
 * 
 * @template TParams - Parameter type
 * @template TResult - Result type
 */
export interface McpToolOptions<TParams = any, TResult = any> extends BaseToolOptions<TParams, TResult> {
    parameters: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    };
}

/**
 * OpenAPI tool options interface
 * 
 * @template TParams - Parameter type
 * @template TResult - Result type
 */
export interface OpenApiToolOptions<TParams = any, TResult = any> extends BaseToolOptions<TParams, TResult> {
    parameters: FunctionSchema['parameters'];
} 