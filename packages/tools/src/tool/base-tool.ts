/**
 * Base tool abstract class
 * 
 * @module BaseTool
 * @description
 * Base implementation for all tools.
 */

import type { FunctionDefinition, FunctionSchema } from '../types';
import type { ToolInterface, BaseToolOptions, ToolResult } from './interfaces';

/**
 * Base tool abstract class
 * 
 * @abstract
 * @class BaseTool
 * @implements {ToolInterface}
 * @description
 * Provides base implementation for all tools.
 * Common functionality is implemented here, schema-related methods are implemented in subclasses.
 * 
 * @template TParams - Tool parameter type
 * @template TResult - Tool result type
 */
export abstract class BaseTool<TParams = any, TResult = any> implements ToolInterface {
    /**
     * Tool name
     */
    public readonly name: string;

    /**
     * Tool description
     */
    public readonly description: string;

    /**
     * Tool category
     */
    public readonly category?: string;

    /**
     * Tool version
     */
    public readonly version?: string;

    /**
     * Whether to validate parameters
     */
    protected readonly validateParams: boolean;

    /**
     * Tool execution function
     */
    private readonly _execute: (params: TParams) => Promise<ToolResult<TResult>> | ToolResult<TResult>;

    /**
     * Pre-execution hook
     */
    private readonly beforeExecute?: (params: TParams) => Promise<TParams> | TParams;

    /**
     * Post-execution hook
     */
    private readonly afterExecute?: (result: ToolResult<TResult>) => Promise<ToolResult<TResult>> | ToolResult<TResult>;

    /**
     * Constructor
     * 
     * @param options - Base tool options
     */
    constructor(options: BaseToolOptions<TParams, TResult>) {
        this.name = options.name;
        this.description = options.description;
        this.category = options.category;
        this.version = options.version;
        this.validateParams = options.validateParams ?? true;
        this._execute = options.execute;
        this.beforeExecute = options.beforeExecute;
        this.afterExecute = options.afterExecute;
    }

    /**
     * Tool schema (implemented by subclasses)
     */
    public abstract get schema(): any;

    /**
     * Convert to JSON schema (implemented by subclasses)
     * 
     * @returns JSON schema format parameter definition
     */
    protected abstract toJsonSchema(): FunctionSchema['parameters'];

    /**
     * Validate parameters (implemented by subclasses)
     * 
     * @param params - Parameters to validate
     * @returns Validated parameters
     */
    protected abstract validateParameters(params: any): TParams;

    /**
     * Execute tool
     * 
     * @param params - Tool parameters
     * @returns Tool execution result
     */
    async execute(params: TParams): Promise<ToolResult<TResult>> {
        try {
            let validatedParams = params;

            // Parameter validation
            if (this.validateParams) {
                validatedParams = this.validateParameters(params);
            }

            // Apply pre-execution hook
            if (this.beforeExecute) {
                validatedParams = await Promise.resolve(this.beforeExecute(validatedParams));
            }

            // Execute tool
            let result = await Promise.resolve(this._execute(validatedParams));

            // Apply post-execution hook
            if (this.afterExecute) {
                result = await Promise.resolve(this.afterExecute(result));
            }

            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                status: 'error',
                error: errorMessage
            };
        }
    }

    /**
     * Convert to function schema
     * 
     * @returns Function schema
     */
    toFunctionSchema(): FunctionSchema {
        return {
            name: this.name,
            description: this.description,
            parameters: this.toJsonSchema()
        };
    }

    /**
     * Convert to function definition
     * 
     * @returns Function definition
     */
    toFunctionDefinition(): FunctionDefinition {
        return {
            name: this.name,
            description: this.description,
            parameters: this.toJsonSchema()
        };
    }

    /**
     * Generate string representation
     * 
     * @returns String representation of the tool
     */
    toString(): string {
        return `${this.constructor.name}(name=${this.name}, category=${this.category || 'none'}, version=${this.version || 'none'})`;
    }
} 