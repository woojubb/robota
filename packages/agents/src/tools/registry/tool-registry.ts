import type { ToolInterface, ToolRegistryInterface } from '../../interfaces/tool';
import type { ToolSchema } from '../../interfaces/provider';
import { ValidationError } from '../../utils/errors';
import { logger } from '../../utils/logger';

/**
 * Tool registry implementation
 * Manages tool registration, validation, and retrieval
 */
export class ToolRegistry implements ToolRegistryInterface {
    private tools = new Map<string, ToolInterface>();

    /**
     * Register a tool
     */
    register(tool: ToolInterface): void {
        if (!tool.schema?.name) {
            throw new ValidationError('Tool must have a valid schema with name');
        }

        const toolName = tool.schema.name;

        // Validate tool schema
        this.validateToolSchema(tool.schema);

        // Check for duplicate registration
        if (this.tools.has(toolName)) {
            logger.warn(`Tool "${toolName}" is already registered, overriding`, {
                toolName,
                existingTool: this.tools.get(toolName)?.constructor.name
            });
        }

        this.tools.set(toolName, tool);
        logger.debug(`Tool "${toolName}" registered successfully`, {
            toolName,
            toolType: tool.constructor.name,
            parameters: Object.keys(tool.schema.parameters?.properties || {})
        });
    }

    /**
     * Unregister a tool
     */
    unregister(name: string): void {
        if (!this.tools.has(name)) {
            logger.warn(`Attempted to unregister non-existent tool "${name}"`);
            return;
        }

        this.tools.delete(name);
        logger.debug(`Tool "${name}" unregistered successfully`);
    }

    /**
     * Get tool by name
     */
    get(name: string): ToolInterface | undefined {
        return this.tools.get(name);
    }

    /**
     * Get all registered tools
     */
    getAll(): ToolInterface[] {
        return Array.from(this.tools.values());
    }

    /**
     * Get tool schemas
     */
    getSchemas(): ToolSchema[] {
        return this.getAll().map(tool => tool.schema);
    }

    /**
     * Check if tool exists
     */
    has(name: string): boolean {
        return this.tools.has(name);
    }

    /**
     * Clear all tools
     */
    clear(): void {
        const toolCount = this.tools.size;
        this.tools.clear();
        logger.debug(`Cleared ${toolCount} tools from registry`);
    }

    /**
     * Get tool names
     */
    getToolNames(): string[] {
        return Array.from(this.tools.keys());
    }

    /**
     * Get tools by pattern
     */
    getToolsByPattern(pattern: string | RegExp): ToolInterface[] {
        const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
        return this.getAll().filter(tool => regex.test(tool.schema.name));
    }

    /**
     * Get tool count
     */
    size(): number {
        return this.tools.size;
    }

    /**
     * Validate tool schema
     */
    private validateToolSchema(schema: ToolSchema): void {
        if (!schema.name || typeof schema.name !== 'string') {
            throw new ValidationError('Tool schema must have a valid name');
        }

        if (!schema.description || typeof schema.description !== 'string') {
            throw new ValidationError('Tool schema must have a description');
        }

        if (!schema.parameters || typeof schema.parameters !== 'object') {
            throw new ValidationError('Tool schema must have parameters object');
        }

        if (schema.parameters.type !== 'object') {
            throw new ValidationError('Tool parameters type must be "object"');
        }

        // Validate parameter properties
        if (schema.parameters.properties) {
            for (const [propName, propSchema] of Object.entries(schema.parameters.properties)) {
                if (!propSchema.type) {
                    throw new ValidationError(`Parameter "${propName}" must have a type`);
                }

                const validTypes = ['string', 'number', 'boolean', 'array', 'object'];
                if (!validTypes.includes(propSchema.type)) {
                    throw new ValidationError(`Parameter "${propName}" has invalid type "${propSchema.type}"`);
                }
            }
        }

        // Validate required fields exist in properties
        if (schema.parameters.required) {
            const properties = schema.parameters.properties || {};
            for (const requiredField of schema.parameters.required) {
                if (!properties[requiredField]) {
                    throw new ValidationError(`Required parameter "${requiredField}" is not defined in properties`);
                }
            }
        }
    }
} 