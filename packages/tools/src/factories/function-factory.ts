/**
 * Function creation utilities
 * 
 * @module FunctionFactory
 * @description
 * Pure functions for creating tool functions with validation and error handling.
 * These functions are side-effect free and can be easily tested.
 */

import { z } from 'zod';
import type { FunctionDefinition } from '../types';
import { zodToJsonSchema } from '../schema/zod-to-json';

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
 * Create a function with validation and error handling
 * 
 * @template TParams - Function parameter type
 * @template TResult - Function return result type
 * @param options - Function creation options
 * @returns Created function object with validation
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

    // Function execution wrapper with validation and error handling
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
                const errorMessage = formatZodError(error);
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
 * Convert callback function to ToolFunction object
 * 
 * @param name - Function name
 * @param fn - Callback function to convert
 * @param description - Optional function description
 * @returns Created function object
 */
export function functionFromCallback(
    name: string,
    fn: (...args: any[]) => any,
    description?: string
): ToolFunction<Record<string, any>, any> {
    // Extract function parameter information
    const paramInfo = extractParameterInfo(fn);

    // Create parameter schema
    const paramSchema = createParameterSchema(paramInfo.argNames);

    // Wrap execution function
    const execute = async (params: Record<string, any>) => {
        const args = paramInfo.argNames.map(name => params[name]);
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
 * Create function with enhanced validation
 * 
 * @param options - Function options with enhanced validation
 * @returns Function with comprehensive error handling
 */
export function createValidatedFunction<TParams = unknown, TResult = unknown>(
    options: FunctionOptions<TParams, TResult> & {
        validateResult?: (result: TResult) => boolean;
        resultErrorMessage?: string;
    }
): ToolFunction<TParams, TResult> {
    const baseFunction = createFunction(options);

    if (!options.validateResult) {
        return baseFunction;
    }

    // Wrap execute with result validation
    const wrappedExecute = async (params: TParams): Promise<TResult> => {
        const result = await baseFunction.execute(params);

        if (!options.validateResult!(result)) {
            throw new Error(
                options.resultErrorMessage ||
                'Function result validation failed'
            );
        }

        return result;
    };

    return {
        ...baseFunction,
        execute: wrappedExecute
    };
}

/**
 * Format Zod validation error into readable message
 * 
 * @param error - Zod validation error
 * @returns Formatted error message
 */
function formatZodError(error: z.ZodError): string {
    return error.errors.map(e => {
        const path = e.path.length > 0 ? e.path.join('.') : 'root';
        return `${path}: ${e.message}`;
    }).join(', ');
}

/**
 * Extract parameter information from function
 * 
 * @param fn - Function to analyze
 * @returns Parameter information
 */
function extractParameterInfo(fn: Function): { argNames: string[] } {
    const fnStr = fn.toString();
    const argsMatch = fnStr.match(/\(([^)]*)\)/);
    const argNames = argsMatch
        ? argsMatch[1].split(',').map(arg => arg.trim()).filter(Boolean)
        : [];

    return { argNames };
}

/**
 * Create parameter schema for callback functions
 * 
 * @param argNames - Parameter names
 * @returns JSON schema for parameters
 */
function createParameterSchema(argNames: string[]): any {
    return {
        type: 'object',
        properties: Object.fromEntries(
            argNames.map(name => [name, { type: 'string' }])
        ),
        required: argNames
    };
} 