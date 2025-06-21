import { Message, AgentConfig, ToolCall } from '../interfaces/agent.js';
import { BasePlugin } from '../abstracts/base-plugin.js';
import { ConversationService, ConversationContext } from './conversation-service.js';
import { ToolExecutionService, ToolExecutionContext } from './tool-execution-service.js';
import { AIProviderManager } from '../managers/ai-provider-manager.js';
import { ToolManager } from '../managers/tool-manager.js';
import { AIProvider } from '../interfaces/provider.js';
import { Logger } from '../utils/logger.js';

/**
 * Execution context passed through the pipeline
 */
export interface ExecutionContext {
    conversationId?: string;
    sessionId?: string;
    userId?: string;
    messages: Message[];
    config: AgentConfig;
    metadata?: Record<string, any>;
    startTime: Date;
    executionId: string;
}

/**
 * Execution result containing the response and execution metadata
 */
export interface ExecutionResult {
    response: string;
    messages: Message[];
    executionId: string;
    duration: number;
    tokensUsed?: number;
    toolsExecuted: string[];
    success: boolean;
    error?: Error;
}

/**
 * Service that orchestrates the entire execution pipeline
 * Coordinates conversation service, tool execution service, and plugin lifecycle
 */
export class ExecutionService {
    private conversationService: ConversationService;
    private toolExecutionService: ToolExecutionService;
    private aiProviderManager: AIProviderManager;
    private toolManager: ToolManager;
    private plugins: BasePlugin[] = [];
    private logger: Logger;

    constructor(
        conversationService: ConversationService,
        toolExecutionService: ToolExecutionService,
        aiProviderManager: AIProviderManager,
        toolManager: ToolManager
    ) {
        this.conversationService = conversationService;
        this.toolExecutionService = toolExecutionService;
        this.aiProviderManager = aiProviderManager;
        this.toolManager = toolManager;
        this.logger = new Logger('ExecutionService');
    }

    /**
     * Register a plugin
     */
    registerPlugin(plugin: BasePlugin): void {
        this.plugins.push(plugin);
        this.logger.debug('Plugin registered', { pluginName: plugin.name });
    }

    /**
     * Remove a plugin
     */
    removePlugin(pluginName: string): boolean {
        const index = this.plugins.findIndex(p => p.name === pluginName);
        if (index !== -1) {
            this.plugins.splice(index, 1);
            this.logger.debug('Plugin removed', { pluginName });
            return true;
        }
        return false;
    }

    /**
     * Execute the full pipeline
     */
    async execute(
        input: string,
        messages: Message[],
        config: AgentConfig,
        context?: Partial<ExecutionContext>
    ): Promise<ExecutionResult> {
        const executionId = this.generateExecutionId();
        const startTime = new Date();

        const fullContext: ExecutionContext = {
            messages,
            config,
            startTime,
            executionId,
            conversationId: context?.conversationId,
            sessionId: context?.sessionId,
            userId: context?.userId,
            metadata: context?.metadata || {}
        };

        this.logger.info('Starting execution pipeline', {
            executionId,
            messageCount: messages.length,
            hasContext: !!context
        });

        try {
            // Get AI provider
            const provider = this.aiProviderManager.getCurrentProvider();
            if (!provider) {
                throw new Error('No AI provider available');
            }

            // Add user message to conversation
            const userMessage = this.conversationService.createUserMessage(input);
            const allMessages = [...messages, userMessage];

            // Prepare conversation context
            const conversationContext = this.conversationService.prepareContext(
                allMessages,
                config.model,
                config.provider,
                {
                    systemMessage: config.systemMessage,
                    temperature: config.temperature,
                    maxTokens: config.maxTokens,
                    tools: config.tools,
                    metadata: context?.metadata
                }
            );

            // Generate initial response
            const response = await this.conversationService.generateResponse(
                provider,
                conversationContext
            );

            let finalResponse = response;
            let toolsExecuted: string[] = [];
            let finalMessages = [
                ...allMessages,
                this.conversationService.createAssistantMessage(response)
            ];

            // Handle tool calls if present
            if (response.toolCalls && response.toolCalls.length > 0) {
                this.logger.debug('Tool calls detected, executing tools', {
                    toolCallCount: response.toolCalls.length
                });

                // Execute tools
                const toolRequests = this.toolExecutionService.createExecutionRequests(response.toolCalls);
                const toolContext: ToolExecutionContext = {
                    requests: toolRequests,
                    mode: 'parallel',
                    maxConcurrency: 5,
                    continueOnError: true
                };

                const toolSummary = await this.toolExecutionService.executeTools(toolContext);
                toolsExecuted = toolSummary.results.map(r => r.toolName || 'unknown');

                // Add tool messages
                const toolMessages = toolSummary.results.map(result =>
                    this.conversationService.createToolMessage(
                        result.executionId || 'unknown',
                        result.result,
                        result.metadata
                    )
                );

                finalMessages.push(...toolMessages);

                // Generate final response with tool results
                const finalContext = this.conversationService.prepareContext(
                    finalMessages,
                    config.model,
                    config.provider,
                    {
                        systemMessage: config.systemMessage,
                        temperature: config.temperature,
                        maxTokens: config.maxTokens,
                        metadata: context?.metadata
                    }
                );

                finalResponse = await this.conversationService.generateResponse(
                    provider,
                    finalContext
                );

                finalMessages.push(this.conversationService.createAssistantMessage(finalResponse));
            }

            const duration = Date.now() - startTime.getTime();
            const result: ExecutionResult = {
                response: finalResponse.content,
                messages: finalMessages,
                executionId,
                duration,
                tokensUsed: finalResponse.usage?.totalTokens,
                toolsExecuted,
                success: true
            };

            this.logger.info('Execution pipeline completed successfully', {
                executionId,
                duration,
                tokensUsed: result.tokensUsed,
                toolsExecuted: result.toolsExecuted.length
            });

            return result;

        } catch (error) {
            const duration = Date.now() - startTime.getTime();
            const errorResult: ExecutionResult = {
                response: 'Execution failed',
                messages: [],
                executionId,
                duration,
                toolsExecuted: [],
                success: false,
                error: error instanceof Error ? error : new Error(String(error))
            };

            this.logger.error('Execution pipeline failed', {
                executionId,
                duration,
                error: error instanceof Error ? error.message : String(error)
            });

            throw error;
        }
    }

    /**
     * Execute with streaming response
     */
    async* executeStream(
        input: string,
        messages: Message[],
        config: AgentConfig,
        context?: Partial<ExecutionContext>
    ): AsyncGenerator<string, ExecutionResult, unknown> {
        const executionId = this.generateExecutionId();
        const startTime = new Date();

        try {
            const provider = this.aiProviderManager.getCurrentProvider();
            if (!provider) {
                throw new Error('No AI provider available');
            }

            // Add user message
            const userMessage = this.conversationService.createUserMessage(input);
            const allMessages = [...messages, userMessage];

            // Prepare context
            const conversationContext = this.conversationService.prepareContext(
                allMessages,
                config.model,
                config.provider,
                {
                    systemMessage: config.systemMessage,
                    temperature: config.temperature,
                    maxTokens: config.maxTokens,
                    tools: config.tools,
                    metadata: context?.metadata
                }
            );

            // Stream response
            let fullContent = '';
            let usage: any;

            const streamGenerator = this.conversationService.generateStreamingResponse(
                provider,
                conversationContext
            );

            for await (const chunk of streamGenerator) {
                fullContent += chunk.delta;
                if (chunk.usage) {
                    usage = chunk.usage;
                }
                yield chunk.delta;
            }

            const duration = Date.now() - startTime.getTime();
            const result: ExecutionResult = {
                response: fullContent,
                messages: [
                    ...allMessages,
                    this.conversationService.createAssistantMessage({
                        content: fullContent,
                        usage
                    })
                ],
                executionId,
                duration,
                tokensUsed: usage?.totalTokens,
                toolsExecuted: [],
                success: true
            };

            return result;

        } catch (error) {
            this.logger.error('Streaming execution failed', {
                executionId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Generate unique execution ID
     */
    private generateExecutionId(): string {
        return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get execution statistics
     */
    getStats(): {
        pluginCount: number;
        registeredPlugins: string[];
    } {
        return {
            pluginCount: this.plugins.length,
            registeredPlugins: this.plugins.map(p => p.name)
        };
    }

    /**
     * Clear all plugins
     */
    clearPlugins(): void {
        this.plugins = [];
        this.logger.info('All plugins cleared');
    }
} 