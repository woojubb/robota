import { BaseTool, createZodFunctionTool, type ToolHooks, type ToolParameters, type ToolResult, type ToolExecutionContext, type SimpleLogger, SilentLogger } from '@robota-sdk/agents';
import type { AssignTaskParams, AssignTaskResult, TemplateInfo } from '../types';
import { createDynamicAssignTaskSchema, type DynamicAssignTaskSchemaType } from '../task-assignment/schema.js';
import { convertToAssignTaskParams, formatResultForLLM } from '../task-assignment/tool-factory.js';

/**
 * Options for AgentDelegationTool construction
 */
export interface AgentDelegationToolOptions {
    /**
     * Task execution function
     */
    executor: (params: AssignTaskParams) => Promise<AssignTaskResult>;

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
}

/**
 * Agent delegation tool implementation
 * Wraps the existing createZodFunctionTool while adding Template Method Pattern hook support
 */
export class AgentDelegationTool implements BaseTool<ToolParameters, ToolResult> {
    private readonly wrappedTool: BaseTool<ToolParameters, ToolResult>;
    private readonly hooks: ToolHooks | undefined;
    private readonly logger: SimpleLogger;

    constructor(options: AgentDelegationToolOptions) {
        this.hooks = options.hooks;
        this.logger = options.logger || SilentLogger;

        // Create dynamic schema with available templates
        const toolParametersSchema = createDynamicAssignTaskSchema(options.availableTemplates);

        // Create the wrapped tool instance with proper schema validation and Hook support
        this.wrappedTool = createZodFunctionTool(
            'assignTask',
            this.createToolDescription(options.availableTemplates),
            toolParametersSchema,
            async (parameters: ToolParameters, context?: ToolExecutionContext) => {
                return await this.executeWithHooks(parameters, context, options.executor, toolParametersSchema);
            },
            { hooks: this.hooks, logger: this.logger } // ✅ Hook과 logger 전달
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

        // Call beforeExecute hook if present
        if (this.hooks?.beforeExecute) {
            try {
                await this.hooks.beforeExecute(toolName, parameters, context);
            } catch (error) {
                this.logger.error('Hook beforeExecute failed', { error: String(error) });
            }
        }

        try {
            // Execute the wrapped tool
            const result = await this.wrappedTool.execute(parameters, context);

            // Call afterExecute hook if present
            if (this.hooks?.afterExecute) {
                try {
                    await this.hooks.afterExecute(toolName, parameters, result, context);
                } catch (error) {
                    this.logger.error('Hook afterExecute failed', { error: String(error) });
                }
            }

            return result;
        } catch (error) {
            // Call onError hook if present
            if (this.hooks?.onError) {
                try {
                    await this.hooks.onError(toolName, parameters, error as Error, context);
                } catch (hookError) {
                    this.logger.error('Hook onError failed', { error: String(hookError) });
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
     */
    private async executeWithHooks(
        parameters: ToolParameters,
        context: ToolExecutionContext | undefined,
        executor: (params: AssignTaskParams) => Promise<AssignTaskResult>,
        schema: any
    ): Promise<string> {
        const toolName = 'assignTask';

        try {
            // Pre-execution hook
            await this.hooks?.beforeExecute?.(toolName, parameters, context);

            this.logger.debug(`Executing tool: ${toolName}`, { parameters });

            // Type-safe conversion using Zod's inferred type
            const validatedParams = schema.parse(parameters);
            const result = await executor(convertToAssignTaskParams(validatedParams));

            // Format result for LLM consumption
            const formattedResult = formatResultForLLM(result);

            this.logger.debug(`Tool execution completed: ${toolName}`, { result: formattedResult });

            // Post-execution hook
            await this.hooks?.afterExecute?.(toolName, parameters, formattedResult, context);

            return formattedResult;

        } catch (error) {
            this.logger.error(`Tool execution failed: ${toolName}`, {
                error: error instanceof Error ? error.message : error,
                parameters
            });

            // Error hook
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
    executor: (params: AssignTaskParams) => Promise<AssignTaskResult>,
    options: { hooks?: ToolHooks; logger?: SimpleLogger } = {}
): AgentDelegationTool {
    return new AgentDelegationTool({
        executor,
        availableTemplates,
        hooks: options.hooks,
        logger: options.logger
    });
} 