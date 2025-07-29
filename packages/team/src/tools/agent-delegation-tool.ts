import { BaseTool, ToolHooks, SimpleLogger, SilentLogger, ToolExecutionContext, ToolParameters, ToolResult, ToolSchema, ExecutionHierarchyTracker, EventService } from '@robota-sdk/agents';
import { createZodFunctionTool } from '@robota-sdk/agents';
import { ZodSchema } from 'zod';
import { AssignTaskParams, AssignTaskResult, TemplateInfo } from '../types.js';
import { createDynamicAssignTaskSchema } from '../task-assignment/schema.js';
import { convertToAssignTaskParams, formatResultForLLM } from '../task-assignment/tool-factory.js';

/**
 * Options for AgentDelegationTool construction
 */
export interface AgentDelegationToolOptions {
    /**
     * Task execution function
     */
    executor: (params: AssignTaskParams, context?: ToolExecutionContext) => Promise<AssignTaskResult>;

    /**
     * Available agent templates for task assignment
     */
    availableTemplates: TemplateInfo[];

    /**
     * Optional hooks for tool lifecycle events
     */
    hooks?: ToolHooks;

    /**
     * Optional logger for tool execution
     */
    logger?: SimpleLogger | undefined;

    /**
     * Optional event service for unified event emission
     * If provided and hooks are not provided, will automatically create hooks using EventServiceHookFactory
     * @since 2.1.0
     */
    eventService?: EventService;

    /**
     * Optional ExecutionHierarchyTracker for hierarchy tracking
     */
    hierarchyTracker?: ExecutionHierarchyTracker;
}

/**
 * Agent delegation tool implementation
 * Wraps the existing createZodFunctionTool while adding Template Method Pattern hook support
 */
export class AgentDelegationTool implements BaseTool<ToolParameters, ToolResult> {
    private readonly wrappedTool: BaseTool<ToolParameters, ToolResult>;
    private readonly hooks: ToolHooks | undefined;
    private readonly logger: SimpleLogger;
    private readonly hierarchyTracker: ExecutionHierarchyTracker | undefined;

    constructor(options: AgentDelegationToolOptions) {
        this.hooks = options.hooks;
        this.logger = options.logger || SilentLogger;
        this.hierarchyTracker = options.hierarchyTracker;

        // Create dynamic schema with available templates
        const toolParametersSchema = createDynamicAssignTaskSchema(options.availableTemplates);

        // 🎯 Wrapped tool creation - hooks 중복 방지를 위해 전달하지 않음
        this.wrappedTool = createZodFunctionTool(
            'assignTask',
            this.createToolDescription(options.availableTemplates),
            toolParametersSchema as any, // Type compatibility workaround
            async (parameters: ToolParameters, context?: ToolExecutionContext) => {
                // 🔑 Execute the delegation logic directly
                return await this.executeWithHooks(parameters, context, options.executor, toolParametersSchema);
            },
            {
                // hooks: this.hooks,  // ❌ 제거 - executeWithHooks에서만 호출
                logger: this.logger,
                eventService: options.eventService // 🎯 Pass EventService to wrapped tool
            } as any // Type compatibility workaround
        );
    }

    // 🔧 BaseTool 인터페이스 구현 (proxy 메서드들)
    get schema() {
        return this.wrappedTool.schema;
    }

    getName(): string {
        return this.wrappedTool.getName();
    }

    getDescription(): string {
        return this.wrappedTool.getDescription();
    }

    async execute(parameters: ToolParameters, context?: ToolExecutionContext): Promise<ToolResult> {
        const toolName = 'assignTask';
        console.log('🔥 [DELEGATION] AgentDelegationTool.execute called with:', parameters);
        console.log('🔥 [DELEGATION] Has hooks:', !!this.hooks);

        // 🆕 Register tool execution instance if hierarchyTracker is available
        let toolExecutionId: string | undefined;
        if (this.hierarchyTracker) {
            toolExecutionId = `${toolName}-exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            this.hierarchyTracker.registerToolExecution({
                id: toolExecutionId,
                toolName: toolName,
                executionId: context?.executionId || 'unknown',
                parentId: context?.parentExecutionId || context?.executionId || 'unknown-parent',
                rootId: context?.rootExecutionId || context?.conversationId || 'unknown-root',
                level: (context?.executionLevel || 0) + 1,
                path: [...(context?.executionPath || []), toolExecutionId],
                parameters: parameters,
                metadata: {
                    timestamp: new Date().toISOString(),
                    source: 'AgentDelegationTool'
                }
            });

            this.logger.debug(`Tool execution instance registered: ${toolExecutionId}`, {
                parentId: context?.parentExecutionId,
                level: (context?.executionLevel || 0) + 1
            });
        }

        // ❌ 중복 hooks 호출 제거 - executeWithHooks에서만 호출
        // Call beforeExecute hook if present
        // if (this.hooks?.beforeExecute) {
        //     try {
        //         await this.hooks.beforeExecute(toolName, parameters, context);
        //     } catch (error) {
        //         this.logger.error('Hook beforeExecute failed', { error: String(error) });
        //     }
        // }

        try {
            // 🆕 Enhanced context with tool execution instance ID - PRESERVE original context
            const enhancedContext: ToolExecutionContext | undefined = context ? {
                ...context, // Preserve ALL original context including executionId

                // Add tool execution instance ID for internal tracking
                toolExecutionId: toolExecutionId,

                // 🔧 FIXED: Proper infinite nesting context for assignTask
                // For infinite nesting, the current Agent becomes the parent of the tool call
                // Tool call executionId should be the one generated by ToolExecutionService
                parentExecutionId: context.executionId, // Current Agent becomes parent

                // Keep root execution ID throughout the entire nesting chain
                rootExecutionId: context.rootExecutionId || context.executionId,

                // Tool calls happen at the next level after agent execution
                // This ensures proper Level progression: Agent(2) → Tool(3) → Agent(4) → Tool(5)...
                executionLevel: (context.executionLevel || 0) + 1,

                // Extend execution path with current tool call
                executionPath: [...(context.executionPath || []), context.executionId || 'unknown']
            } : undefined;

            // Execute the wrapped tool with enhanced context
            const result = await this.wrappedTool.execute(parameters, enhancedContext);

            // ❌ 중복 hooks 호출 제거 - executeWithHooks에서만 호출
            // Call afterExecute hook if present
            // if (this.hooks?.afterExecute) {
            //     try {
            //         await this.hooks.afterExecute(toolName, parameters, result, context);
            //     } catch (error) {
            //         this.logger.error('Hook afterExecute failed', { error: String(error) });
            //     }
            // }

            // 🆕 Mark tool execution as complete
            if (this.hierarchyTracker && toolExecutionId) {
                this.hierarchyTracker.markExecutionComplete(toolExecutionId);
            }

            return result;
        } catch (error) {
            // ❌ 중복 hooks 호출 제거 - executeWithHooks에서만 호출
            // Call onError hook if present
            // if (this.hooks?.onError) {
            //     try {
            //         await this.hooks.onError(toolName, parameters, error as Error, context);
            //     } catch (hookError) {
            //         this.logger.error('Hook onError failed', { error: String(hookError) });
            //     }
            // }

            // 🆕 Mark tool execution as failed
            if (this.hierarchyTracker && toolExecutionId) {
                const entity = this.hierarchyTracker.getEntity(toolExecutionId);
                if (entity) {
                    entity.metadata = {
                        ...entity.metadata,
                        status: 'failed',
                        error: error instanceof Error ? error.message : String(error)
                    };
                }
            }

            throw error;
        }
    }

    async executeImpl(parameters: ToolParameters, context?: ToolExecutionContext): Promise<ToolResult> {
        return await this.wrappedTool.executeImpl(parameters, context);
    }

    validate(parameters: unknown): ToolParameters {
        return this.wrappedTool.validate(parameters);
    }

    validateParameters(parameters: unknown): ToolParameters {
        return this.wrappedTool.validateParameters(parameters);
    }

    /**
     * Internal execution with hooks
     * Handle hooks with proper executionId context from ToolExecutionService
     */
    private async executeWithHooks(
        parameters: ToolParameters,
        context: ToolExecutionContext | undefined,
        executor: (params: AssignTaskParams, context?: ToolExecutionContext) => Promise<AssignTaskResult>,
        schema: any
    ): Promise<string> {
        const toolName = 'assignTask';

        try {
            // 🔑 Call beforeExecute hook with proper context
            await this.hooks?.beforeExecute?.(toolName, parameters, context);

            this.logger.debug(`Executing tool: ${toolName}`, {
                parameters,
                hasContext: !!context,
                contextExecutionId: context?.executionId,
                contextParentId: context?.parentExecutionId,
                executionLevel: context?.executionLevel
            });

            // Type-safe conversion using Zod's inferred type
            const validatedParams = schema.parse(parameters);
            const result = await executor(convertToAssignTaskParams(validatedParams), context);

            // Format result for LLM consumption
            const formattedResult = formatResultForLLM(result);

            this.logger.debug(`Tool execution completed: ${toolName}`, {
                result: formattedResult,
                resultLength: formattedResult.length
            });

            // 🔑 Call afterExecute hook with proper context and result
            await this.hooks?.afterExecute?.(toolName, parameters, formattedResult, context);

            return formattedResult;

        } catch (error) {
            this.logger.error(`Tool execution failed: ${toolName}`, {
                error: error instanceof Error ? error.message : error,
                parameters
            });

            // 🔑 Call onError hook with proper context
            await this.hooks?.onError?.(toolName, parameters, error as Error, context);

            throw error;
        }
    }

    /**
     * Create tool description
     */
    private createToolDescription(availableTemplates: TemplateInfo[]): string {
        const templateDescriptions = availableTemplates
            .map(t => `- ${t.id}: ${t.description}`)
            .join('\n');

        return `Delegate a task to a specialized agent. Available templates:\n${templateDescriptions}`;
    }
}

/**
 * Factory function to create AgentDelegationTool
 * This maintains compatibility with existing code while providing hook support
 */
export function createAgentDelegationTool(
    availableTemplates: TemplateInfo[],
    executor: (params: AssignTaskParams, context?: ToolExecutionContext) => Promise<AssignTaskResult>,
    options: { hooks?: ToolHooks; logger?: SimpleLogger } = {}
): AgentDelegationTool {
    return new AgentDelegationTool({
        executor,
        availableTemplates,
        hooks: options.hooks,
        logger: options.logger
    });
} 