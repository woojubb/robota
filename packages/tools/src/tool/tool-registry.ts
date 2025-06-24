/**
 * Tool registry for managing tools
 * 
 * @module ToolRegistry
 * @description
 * Registry for managing and organizing tools.
 */

import type { FunctionDefinition } from '../types';
import type { ToolInterface } from './interfaces';

/**
 * Tool registry class
 * 
 * @class ToolRegistry
 * @description Manages a collection of tools with registration, retrieval, and organization capabilities.
 * 
 * @see {@link @examples/02-functions | Function Tool Examples}
 */
export class ToolRegistry {
    /**
     * Map of tools by name
     */
    private tools: Map<string, ToolInterface> = new Map();

    /**
     * Register a tool
     * 
     * @param tool - Tool to register
     * @throws Error if tool with same name already exists
     */
    register(tool: ToolInterface): void {
        if (this.tools.has(tool.name)) {
            throw new Error(`Tool with name '${tool.name}' is already registered`);
        }
        this.tools.set(tool.name, tool);
    }

    /**
     * Get tool by name
     * 
     * @param name - Tool name
     * @returns Tool instance or undefined if not found
     */
    get(name: string): ToolInterface | undefined {
        return this.tools.get(name);
    }

    /**
     * Check if tool exists
     * 
     * @param name - Tool name
     * @returns Whether tool exists
     */
    has(name: string): boolean {
        return this.tools.has(name);
    }

    /**
     * Get all tools
     * 
     * @returns Array of all registered tools
     */
    getAll(): ToolInterface[] {
        return Array.from(this.tools.values());
    }

    /**
     * Get tools by category
     * 
     * @param category - Tool category
     * @returns Array of tools in the specified category
     */
    getByCategory(category: string): ToolInterface[] {
        return this.getAll().filter(tool =>
            (tool as any).category === category
        );
    }

    /**
     * Get all tool names
     * 
     * @returns Array of all tool names
     */
    getNames(): string[] {
        return Array.from(this.tools.keys());
    }

    /**
     * Unregister a tool
     * 
     * @param name - Tool name to unregister
     * @returns Whether tool was successfully unregistered
     */
    unregister(name: string): boolean {
        return this.tools.delete(name);
    }

    /**
     * Clear all tools
     */
    clear(): void {
        this.tools.clear();
    }

    /**
     * Get number of registered tools
     * 
     * @returns Number of tools
     */
    size(): number {
        return this.tools.size;
    }

    /**
     * Generate string representation
     * 
     * @returns String representation of the registry
     */
    toString(): string {
        return `ToolRegistry(${this.size()} tools: [${this.getNames().join(', ')}])`;
    }

    /**
     * Get function definitions for all tools
     * 
     * @returns Array of function definitions for all registered tools
     */
    getFunctionDefinitions(): FunctionDefinition[] {
        return Array.from(this.tools.values()).map(tool => tool.toFunctionDefinition());
    }

    /**
     * Execute a tool by name
     * 
     * @param name - Tool name to execute
     * @param args - Tool execution arguments
     * @returns Tool execution result
     * @throws Error if tool is not registered
     */
    async execute(name: string, args: Record<string, any>): Promise<any> {
        const tool = this.tools.get(name);

        if (!tool) {
            throw new Error(`Tool '${name}' is not registered`);
        }

        return await tool.execute(args);
    }
} 