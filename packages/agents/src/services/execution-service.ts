import { Message, AgentConfig, ToolCall } from '../interfaces/agent';
import { BasePlugin } from '../abstracts/base-plugin';
import { ToolExecutionService, ToolExecutionContext } from './tool-execution-service';
import { AIProviders } from '../managers/ai-provider-manager';
import { Tools } from '../managers/tool-manager';
import { ConversationHistory, ConversationSession, UniversalMessage } from '../managers/conversation-history-manager';
import { AIProvider } from '../interfaces/provider';
import { BaseAIProvider, ProviderExecutionConfig, ProviderExecutionResult } from '../abstracts/base-ai-provider';
import { Logger } from '../utils/logger';
import { ToolExecutionError } from '../utils/errors';

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
 * Coordinates AI provider execution, tool execution service, and plugin lifecycle
 * Uses centralized conversation history management
 */
export class ExecutionService {
    private toolExecutionService: ToolExecutionService;
    private aiProviders: AIProviders;
    private tools: Tools;
    private conversationHistory: ConversationHistory;
    private plugins: BasePlugin[] = [];
    private logger: Logger;

    constructor(
        aiProviders: AIProviders,
        tools: Tools,
        conversationHistory: ConversationHistory
    ) {
        this.toolExecutionService = new ToolExecutionService(tools);
        this.aiProviders = aiProviders;
        this.tools = tools;
        this.conversationHistory = conversationHistory;
        this.plugins = [];
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
     * Get a plugin by name
     */
    getPlugin<T extends BasePlugin = BasePlugin>(pluginName: string): T | null {
        const plugin = this.plugins.find(p => p.name === pluginName);
        return plugin as T | null;
    }

    /**
     * Get all registered plugins
     */
    getPlugins(): BasePlugin[] {
        return [...this.plugins];
    }

    /**
     * Execute the full pipeline with centralized history management
     */
    async execute(
        input: string,
        messages: Message[],
        config: AgentConfig,
        context?: Partial<ExecutionContext>
    ): Promise<ExecutionResult> {
        const executionId = this.generateExecutionId();
        const startTime = new Date();
        const conversationId = context?.conversationId || executionId;

        const fullContext: ExecutionContext = {
            messages,
            config,
            startTime,
            executionId,
            conversationId,
            ...(context?.sessionId && { sessionId: context.sessionId }),
            ...(context?.userId && { userId: context.userId }),
            ...(context?.metadata && { metadata: context.metadata })
        };

        this.logger.debug('Starting execution pipeline', {
            executionId,
            conversationId,
            messageCount: messages.length,
            hasContext: !!context
        });

        try {
            // Get conversation session for this conversation
            const conversationSession = this.conversationHistory.getConversationSession(conversationId);

            // Initialize conversation history with existing messages if this is first time
            if (conversationSession.getMessageCount() === 0 && messages.length > 0) {
                // Add all messages in the order they appear in the messages array
                // This preserves the original order including multiple system messages
                messages.forEach(msg => {
                    if (msg.role === 'user') {
                        conversationSession.addUserMessage(msg.content, msg.metadata);
                    } else if (msg.role === 'assistant') {
                        conversationSession.addAssistantMessage(msg.content, (msg as any).toolCalls, msg.metadata);
                    } else if (msg.role === 'system') {
                        conversationSession.addSystemMessage(msg.content, msg.metadata);
                    } else if (msg.role === 'tool') {
                        conversationSession.addToolMessageWithId(
                            msg.content,
                            (msg as any).toolCallId,
                            (msg as any).toolName,
                            msg.metadata
                        );
                    }
                });
            }

            // Add system message from config if provided
            // This allows for additional system messages during execution
            if (config.systemMessage) {
                conversationSession.addSystemMessage(config.systemMessage, { executionId });
            }

            // Only add the current input if it's not already the last message in the conversation
            const existingMessages = conversationSession.getMessages();
            const lastMessage = existingMessages[existingMessages.length - 1];
            const shouldAddInput = !lastMessage ||
                lastMessage.role !== 'user' ||
                lastMessage.content !== input;

            if (shouldAddInput) {
                conversationSession.addUserMessage(input, { executionId });
            }

            // Call beforeRun hook on all plugins
            await this.callPluginHook('beforeRun', input, context?.metadata);

            // Get AI provider instance
            const provider = this.aiProviders.getCurrentProviderInstance();
            if (!provider) {
                throw new Error('No AI provider available');
            }

            // Ensure provider is BaseAIProvider with execute method
            if (!(provider instanceof BaseAIProvider)) {
                throw new Error('Provider must extend BaseAIProvider to support execution');
            }

            // Get tool schemas from Tools
            const toolSchemas = this.tools.getTools();

            // Process with conversation loop - now delegated to provider
            let toolsExecuted: string[] = [];
            let maxRounds = 10; // Increased limit for complex team delegation scenarios
            let currentRound = 0;

            while (currentRound < maxRounds) {
                currentRound++;

                // Get messages from conversation history
                const conversationMessages = conversationSession.getMessages();

                // Prepare configuration for provider execution
                const providerConfig: ProviderExecutionConfig = {
                    model: config.model,
                    ...(config.systemMessage && { systemMessage: config.systemMessage }),
                    ...(config.temperature !== undefined && { temperature: config.temperature }),
                    ...(config.maxTokens !== undefined && { maxTokens: config.maxTokens }),
                    tools: toolSchemas,
                    ...(context?.metadata && { metadata: context.metadata })
                };

                // Call beforeProviderCall hook
                await this.callPluginHook('beforeProviderCall', conversationMessages);

                // Delegate entire execution to provider
                const response = await provider.execute(conversationMessages, providerConfig);

                // Call afterProviderCall hook
                await this.callPluginHook('afterProviderCall', conversationMessages, response);

                // Add assistant response to history
                conversationSession.addAssistantMessage(
                    response.content,
                    response.toolCalls,
                    { round: currentRound, usage: response['usage'] }
                );

                // Check if we need to execute tools
                if (!response.toolCalls || response.toolCalls.length === 0) {
                    // No tools to execute, we're done
                    break;
                }

                this.logger.debug('Tool calls detected, executing tools', {
                    toolCallCount: response.toolCalls.length,
                    round: currentRound
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
                toolsExecuted.push(...toolSummary.results.map(r => r.toolName || 'unknown'));

                // Add tool results to history - ensuring EVERY tool_call_id gets a response
                const resultMap = new Map();

                // Map successful results by execution ID (which is the tool call ID)
                toolSummary.results.forEach(result => {
                    if (!result.executionId) {
                        throw new Error(`Tool execution result missing executionId: ${JSON.stringify(result)}`);
                    }
                    resultMap.set(result.executionId, result);
                });

                // Map failed executions by execution ID (which is the tool call ID)
                toolSummary.errors.forEach(error => {
                    if (!error.executionId) {
                        throw new Error(`Tool execution error missing executionId: ${JSON.stringify(error)}`);
                    }
                    resultMap.set(error.executionId, {
                        success: false,
                        result: null,
                        error: error.error.message,
                        toolName: error.toolName,
                    });
                });

                // Add tool response for each tool call - MUST ensure every tool_call_id gets a response
                if (!response.toolCalls || response.toolCalls.length === 0) {
                    throw new Error('Tool calls array is empty but should contain tool calls');
                }

                response.toolCalls.forEach((toolCall: any) => {
                    if (!toolCall.id) {
                        throw new Error(`Tool call missing ID: ${JSON.stringify(toolCall)}`);
                    }

                    const result = resultMap.get(toolCall.id);
                    if (!result) {
                        throw new Error(`No execution result found for tool call ID: ${toolCall.id}`);
                    }

                    let content: string;
                    let metadata: Record<string, any> = { round: currentRound };

                    if ('success' in result && result['success']) {
                        // Ensure content is always a string (core pattern)
                        content = typeof result.result === 'string'
                            ? result.result
                            : JSON.stringify(result.result || 'Tool executed successfully');
                        metadata['success'] = true;
                    } else {
                        content = `Error: ${result['error'] || 'Tool execution failed'}`;
                        metadata['success'] = false;
                        metadata['error'] = result['error'];
                    }
                    metadata['toolName'] = result['toolName'];

                    conversationSession.addToolMessageWithId(
                        content,
                        toolCall.id,
                        toolCall.function?.name || 'unknown',
                        metadata
                    );
                });

                // Continue to next round - let the AI decide if more tools are needed
                // The AI will see the tool results and can either:
                // 1. Call more tools if needed
                // 2. Provide a final response without tool calls
            }

            // Check if we hit the round limit
            if (currentRound >= maxRounds) {
                this.logger.warn('Maximum execution rounds reached', {
                    maxRounds,
                    conversationId
                });
            }

            // Get final messages from history
            const finalMessages = conversationSession.getMessages();
            const lastAssistantMessage = finalMessages
                .filter(msg => msg.role === 'assistant')
                .pop();

            const duration = Date.now() - startTime.getTime();
            const result: ExecutionResult = {
                response: lastAssistantMessage?.content || 'No response generated',
                messages: finalMessages.map(msg => ({
                    role: msg.role,
                    content: msg.content || '',
                    timestamp: msg.timestamp,
                    metadata: msg.metadata,
                    ...(msg.role === 'assistant' && 'toolCalls' in msg ? { toolCalls: msg.toolCalls } : {}),
                    ...(msg.role === 'tool' && 'toolCallId' in msg ? { toolCallId: msg.toolCallId } : {})
                })) as Message[],
                executionId,
                duration,
                tokensUsed: finalMessages
                    .filter(msg => msg.metadata?.['usage']?.['totalTokens'])
                    .reduce((sum, msg) => sum + (msg.metadata?.['usage']?.['totalTokens'] || 0), 0),
                toolsExecuted,
                success: true
            };

            // Call afterRun hook on all plugins
            await this.callPluginHook('afterRun', input, result.response, context?.metadata);

            this.logger.debug('Execution pipeline completed successfully', {
                executionId,
                conversationId,
                duration,
                tokensUsed: result.tokensUsed,
                toolsExecuted: result.toolsExecuted.length,
                rounds: currentRound
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

            // Call onError hook on all plugins
            await this.callPluginHook('onError', error, fullContext);

            this.logger.error('Execution pipeline failed', {
                executionId,
                conversationId,
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
    ): AsyncGenerator<{ chunk: string; isComplete: boolean }> {
        // For now, fall back to regular execution
        // TODO: Implement proper streaming with provider delegation
        const result = await this.execute(input, messages, config, context);
        yield { chunk: result.response, isComplete: true };
    }

    /**
     * Generate a unique execution ID
     */
    private generateExecutionId(): string {
        return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get execution statistics from plugins
     */
    async getStats(): Promise<Record<string, any>> {
        const stats: Record<string, any> = {
            pluginCount: this.plugins.length,
            pluginNames: this.plugins.map(p => p.name),
            historyStats: this.conversationHistory.getStats()
        };

        // Collect stats from plugins that have getStats method
        for (const plugin of this.plugins) {
            if (typeof (plugin as any).getStats === 'function') {
                try {
                    const pluginStats = await (plugin as any).getStats();
                    stats[`plugin_${plugin.name}`] = pluginStats;
                } catch (error) {
                    this.logger.warn('Failed to get stats from plugin', {
                        pluginName: plugin.name,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
        }

        return stats;
    }

    /**
     * Clear all plugins
     */
    clearPlugins(): void {
        this.plugins = [];
        this.logger.debug('All plugins cleared');
    }

    /**
     * Call a hook method on all plugins that implement it
     */
    private async callPluginHook(hookName: string, ...args: any[]): Promise<void> {
        for (const plugin of this.plugins) {
            if (typeof (plugin as any)[hookName] === 'function') {
                try {
                    await (plugin as any)[hookName](...args);
                } catch (error) {
                    this.logger.warn('Plugin hook failed', {
                        pluginName: plugin.name,
                        hookName,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
        }
    }
} 