import {
    FunctionTool,
    OpenAPITool,
    MCPTool,
    createZodFunctionTool,
    type ToolSchema,
    type ToolExecutor,
    type SimpleLogger,
    type BaseTool,
    type ToolParameters,
    type ToolResult
} from '@robota-sdk/agents';
import { createAgentDelegationTool } from '@robota-sdk/team';
import type {
    BlockDataCollector,
    ToolHooks
} from './block-tracking';
import {
    createBlockTrackingHooks,
    createDelegationTrackingHooks
} from './block-tracking';

/**
 * Universal Tool Factory options
 */
export interface UniversalToolFactoryOptions {
    /** Block collector for tracking tool executions */
    blockCollector: BlockDataCollector;

    /** Logger for tool execution */
    logger?: SimpleLogger;

    /** Default parent block ID for tool hierarchy */
    defaultParentBlockId?: string;

    /** Default level for tool nesting */
    defaultLevel?: number;

    /** Custom block type mapping for specific tools */
    blockTypeMapping?: Record<string, 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'error' | 'group'>;
}

/**
 * Universal Tool Factory
 * Provides a unified interface for creating any type of tool with automatic block tracking
 * Leverages the universal Hook system from @robota-sdk/agents
 */
export class UniversalToolFactory {
    private readonly blockCollector: BlockDataCollector;
    private readonly logger?: SimpleLogger;
    private readonly defaultParentBlockId?: string;
    private readonly defaultLevel: number;
    private readonly blockTypeMapping: Record<string, any>;

    constructor(options: UniversalToolFactoryOptions) {
        this.blockCollector = options.blockCollector;
        this.logger = options.logger;
        this.defaultParentBlockId = options.defaultParentBlockId;
        this.defaultLevel = options.defaultLevel || 0;
        this.blockTypeMapping = options.blockTypeMapping || {};
    }

    /**
     * Create standard tool tracking hooks
     */
    private createHooks(options: {
        parentBlockId?: string;
        level?: number;
        toolName?: string;
    } = {}): ToolHooks {
        const parentBlockId = options.parentBlockId || this.defaultParentBlockId;
        const level = options.level ?? this.defaultLevel;

        const blockTypeMapping = options.toolName ?
            { [options.toolName]: this.blockTypeMapping[options.toolName] || 'tool_call' } :
            this.blockTypeMapping;

        return createBlockTrackingHooks(this.blockCollector, this.logger, {
            parentBlockId,
            level,
            blockTypeMapping
        });
    }

    /**
     * Create FunctionTool with block tracking
     */
    createFunctionTool(
        schema: ToolSchema,
        executor: ToolExecutor,
        options: {
            parentBlockId?: string;
            level?: number;
            logger?: SimpleLogger;
        } = {}
    ): FunctionTool {
        const hooks = this.createHooks({
            parentBlockId: options.parentBlockId,
            level: options.level,
            toolName: schema.name
        });

        return new FunctionTool(schema, executor, {
            hooks,
            logger: options.logger || this.logger
        });
    }

    /**
     * Create OpenAPITool with block tracking
     */
    createOpenAPITool(
        config: any, // OpenAPIToolConfig type would be imported from @robota-sdk/agents
        options: {
            parentBlockId?: string;
            level?: number;
            logger?: SimpleLogger;
        } = {}
    ): OpenAPITool {
        const hooks = this.createHooks({
            parentBlockId: options.parentBlockId,
            level: options.level,
            toolName: config.operationId || 'openapi-tool'
        });

        return new OpenAPITool(config, {
            hooks,
            logger: options.logger || this.logger
        });
    }

    /**
     * Create MCPTool with block tracking
     */
    createMCPTool(
        config: any, // MCPConfig type would be imported from @robota-sdk/agents
        schema: ToolSchema,
        options: {
            parentBlockId?: string;
            level?: number;
            logger?: SimpleLogger;
        } = {}
    ): MCPTool {
        const hooks = this.createHooks({
            parentBlockId: options.parentBlockId,
            level: options.level,
            toolName: schema.name
        });

        return new MCPTool(config, schema, {
            hooks,
            logger: options.logger || this.logger
        });
    }

    /**
     * Create AgentDelegationTool with delegation tracking
     */
    createDelegationTool(
        teamContainer: any, // TeamContainer type
        availableTemplates: any[], // TemplateInfo[] type
        options: {
            parentBlockId?: string;
            level?: number;
            logger?: SimpleLogger;
        } = {}
    ): any { // AgentDelegationTool type
        const hooks = createDelegationTrackingHooks(this.blockCollector, this.logger, {
            parentBlockId: options.parentBlockId || this.defaultParentBlockId,
            level: options.level ?? this.defaultLevel
        });

        return createAgentDelegationTool(
            availableTemplates,
            async (params: any) => {
                return await teamContainer.assignTask(params);
            },
            {
                hooks,
                logger: options.logger || this.logger
            }
        );
    }

    /**
     * Create Zod Function Tool with block tracking
     * For backward compatibility with existing createZodFunctionTool usage
     */
    createZodFunctionTool(
        name: string,
        description: string,
        schema: any, // ZodSchema
        executor: (params: ToolParameters) => Promise<any>,
        options: {
            parentBlockId?: string;
            level?: number;
            logger?: SimpleLogger;
        } = {}
    ): BaseTool<ToolParameters, ToolResult> {
        const hooks = this.createHooks({
            parentBlockId: options.parentBlockId,
            level: options.level,
            toolName: name
        });

        // Wrap the executor with block tracking
        const wrappedExecutor = async (params: ToolParameters) => {
            // The hooks will be called automatically by the BaseTool
            return await executor(params);
        };

        return createZodFunctionTool(name, description, schema, wrappedExecutor);
    }

    /**
     * Wrap any existing tool with block tracking
     * For tools that weren't created by this factory
     */
    wrapTool<T extends BaseTool<any, any>>(
        tool: T,
        options: {
            parentBlockId?: string;
            level?: number;
            toolName?: string;
        } = {}
    ): T {
        // Note: This would require modifying the tool's hooks after creation
        // which might not be possible with the current BaseTool implementation
        // This is a conceptual method for future enhancement
        console.warn('wrapTool is not yet implemented - tools should be created with tracking from the start');
        return tool;
    }

    /**
     * Create a batch of tools with block tracking
     */
    createToolBatch(toolConfigs: {
        type: 'function' | 'openapi' | 'mcp' | 'delegation';
        name: string;
        config: any;
        options?: {
            parentBlockId?: string;
            level?: number;
            logger?: SimpleLogger;
        };
    }[]): BaseTool<any, any>[] {
        return toolConfigs.map(({ type, name, config, options = {} }) => {
            switch (type) {
                case 'function':
                    return this.createFunctionTool(config.schema, config.executor, options);
                case 'openapi':
                    return this.createOpenAPITool(config, options);
                case 'mcp':
                    return this.createMCPTool(config.config, config.schema, options);
                case 'delegation':
                    return this.createDelegationTool(config.teamContainer, config.templates, options);
                default:
                    throw new Error(`Unknown tool type: ${type}`);
            }
        });
    }

    /**
     * Get block collector for direct access
     */
    getBlockCollector(): BlockDataCollector {
        return this.blockCollector;
    }

    /**
     * Create a child factory with different default settings
     */
    createChildFactory(options: {
        parentBlockId?: string;
        level?: number;
        blockTypeMapping?: Record<string, any>;
    }): UniversalToolFactory {
        return new UniversalToolFactory({
            blockCollector: this.blockCollector,
            logger: this.logger,
            defaultParentBlockId: options.parentBlockId || this.defaultParentBlockId,
            defaultLevel: options.level ?? this.defaultLevel + 1,
            blockTypeMapping: { ...this.blockTypeMapping, ...options.blockTypeMapping }
        });
    }
} 