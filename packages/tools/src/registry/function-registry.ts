/**
 * Function Registry for managing tool functions
 * 
 * @module FunctionRegistry
 * @description
 * Registry class for managing function definitions and execution.
 * Provides registration, lookup, and execution capabilities.
 */

import type { FunctionDefinition, FunctionCall, FunctionCallResult } from '../types';

/**
 * Function call handler type
 */
export type FunctionHandler = (
    args: Record<string, any>,
    context?: any
) => Promise<any>;

/**
 * Function call registry
 * 
 * Manages function definitions and their execution handlers.
 * Provides a centralized way to register, lookup, and execute functions.
 */
export class FunctionRegistry {
    /** @internal Map of function names to handlers */
    private functions: Map<string, FunctionHandler> = new Map();

    /** @internal Map of function names to definitions */
    private definitions: Map<string, FunctionDefinition> = new Map();

    /**
     * Register a function with its definition and handler
     * 
     * @param definition - Function definition with schema
     * @param handler - Function execution handler
     */
    register(definition: FunctionDefinition, handler: FunctionHandler): void {
        this.functions.set(definition.name, handler);
        this.definitions.set(definition.name, definition);
    }

    /**
     * Unregister a function by name
     * 
     * @param name - Function name to unregister
     * @returns True if function was found and removed
     */
    unregister(name: string): boolean {
        const hadFunction = this.functions.delete(name);
        const hadDefinition = this.definitions.delete(name);
        return hadFunction || hadDefinition;
    }

    /**
     * Check if a function is registered
     * 
     * @param name - Function name to check
     * @returns True if function is registered
     */
    has(name: string): boolean {
        return this.functions.has(name);
    }

    /**
     * Get all registered function definitions
     * 
     * @returns Array of all function definitions
     */
    getAllDefinitions(): FunctionDefinition[] {
        return Array.from(this.definitions.values());
    }

    /**
     * Get function definition by name
     * 
     * @param name - Function name
     * @returns Function definition if found
     */
    getDefinition(name: string): FunctionDefinition | undefined {
        return this.definitions.get(name);
    }

    /**
     * Get all registered function names
     * 
     * @returns Array of function names
     */
    getFunctionNames(): string[] {
        return Array.from(this.functions.keys());
    }

    /**
     * Get total number of registered functions
     * 
     * @returns Number of registered functions
     */
    getCount(): number {
        return this.functions.size;
    }

    /**
     * Clear all registered functions
     */
    clear(): void {
        this.functions.clear();
        this.definitions.clear();
    }

    /**
     * Execute function call
     * 
     * @param functionCall - Function call with name and arguments
     * @param context - Optional execution context
     * @returns Promise resolving to function call result
     */
    async execute(
        functionCall: FunctionCall,
        context?: any
    ): Promise<FunctionCallResult> {
        const { name, arguments: args } = functionCall;
        const handler = this.functions.get(name);

        if (!handler) {
            return {
                name,
                error: `Function '${name}' is not registered`
            };
        }

        try {
            const parsedArgs = this.parseArguments(args);
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

    /**
     * Parse function arguments safely
     * 
     * @param args - Arguments to parse (string or object)
     * @returns Parsed arguments object
     */
    private parseArguments(args: any): Record<string, any> {
        if (typeof args === 'string') {
            try {
                return JSON.parse(args);
            } catch (error) {
                throw new Error(`Failed to parse function arguments: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        return args || {};
    }
} 