import type { ToolManagerInterface } from '../interfaces/manager';
import type { ToolSchema } from '../interfaces/provider';
import type { ToolInterface, ToolExecutor, ToolExecutionData, ToolParameters } from '../interfaces/tool';
import { BaseManager } from '../abstracts/base-manager';
import { ToolRegistry } from '../tools/registry/tool-registry';
import { FunctionTool } from '../tools/implementations/function-tool';
import { ToolExecutionError } from '../utils/errors';
import { logger } from '../utils/logger';

/**
 * Tools implementation
 * Manages tool registration and execution using Tool Registry
 * Instance-based for isolated tool management
 */
export class Tools extends BaseManager implements ToolManagerInterface {
    private registry: ToolRegistry;
    private allowedTools?: string[];

    constructor() {
        super();
        this.registry = new ToolRegistry();
    }

    /**
     * Initialize the manager
     */
    protected async doInitialize(): Promise<void> {
        logger.debug('Tools initialized');
    }

    /**
     * Cleanup manager resources
     */
    protected async doDispose(): Promise<void> {
        this.registry.clear();
        delete this.allowedTools;
        logger.debug('Tools disposed');
    }

    /**
     * Register a tool with schema and executor function
     */
    addTool(schema: ToolSchema, executor: ToolExecutor): void {
        this.ensureInitialized();

        const tool = new FunctionTool(schema, executor);
        this.registry.register(tool);

        logger.debug(`Tool "${schema.name}" registered successfully`);
    }

    /**
     * Remove a tool by name
     */
    removeTool(name: string): void {
        this.ensureInitialized();
        this.registry.unregister(name);
    }

    /**
     * Get tool interface by name
     */
    getTool(name: string): ToolInterface | undefined {
        this.ensureInitialized();
        return this.registry.get(name);
    }

    /**
     * Get tool schema by name
     */
    getToolSchema(name: string): ToolSchema | undefined {
        this.ensureInitialized();
        const tool = this.registry.get(name);
        return tool?.schema;
    }

    /**
     * Get all registered tool schemas
     */
    getTools(): ToolSchema[] {
        this.ensureInitialized();

        const schemas = this.registry.getSchemas();

        // Filter by allowed tools if set
        if (this.allowedTools) {
            return schemas.filter(schema => this.allowedTools!.includes(schema.name));
        }

        return schemas;
    }

    /**
     * Execute a tool with parameters
     */
    async executeTool(name: string, parameters: ToolParameters): Promise<ToolExecutionData> {
        this.ensureInitialized();

        // Check if tool is allowed
        if (this.allowedTools && !this.allowedTools.includes(name)) {
            throw new ToolExecutionError(
                `Tool "${name}" is not in the allowed tools list`,
                name
            );
        }

        const tool = this.registry.get(name);
        if (!tool) {
            throw new ToolExecutionError(
                `Tool "${name}" is not registered`,
                name
            );
        }

        const result = await tool.execute(parameters);

        if (!result.success) {
            throw new ToolExecutionError(
                result.error || 'Tool execution failed',
                name,
                undefined,
                { parameters, result }
            );
        }

        return result.data;
    }

    /**
     * Check if tool exists
     */
    hasTool(name: string): boolean {
        this.ensureInitialized();
        return this.registry.has(name);
    }

    /**
     * Set allowed tools for filtering
     */
    setAllowedTools(tools: string[]): void {
        this.ensureInitialized();
        this.allowedTools = [...tools];
        logger.debug(`Set allowed tools: ${tools.join(', ')}`);
    }

    /**
     * Get allowed tools
     */
    getAllowedTools(): string[] | undefined {
        this.ensureInitialized();
        return this.allowedTools ? [...this.allowedTools] : undefined;
    }

    /**
     * Get tool registry instance (for advanced operations)
     */
    getRegistry(): ToolRegistry {
        this.ensureInitialized();
        return this.registry;
    }

    /**
     * Get tool count
     */
    getToolCount(): number {
        this.ensureInitialized();
        return this.registry.size();
    }
} 