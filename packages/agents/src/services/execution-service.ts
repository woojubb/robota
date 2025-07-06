import { Message, AgentConfig, AssistantMessage, ToolMessage } from '../interfaces/agent';
import { PluginContext, Metadata } from '../interfaces/types';
import { BasePlugin } from '../abstracts/base-plugin';
import { ToolExecutionService, ToolExecutionBatchContext } from './tool-execution-service';
import { AIProviders } from '../managers/ai-provider-manager';
import { Tools } from '../managers/tool-manager';
import { ConversationHistory } from '../managers/conversation-history-manager';
import { BaseAIProvider } from '../abstracts/base-ai-provider';
import { Logger, createLogger } from '../utils/logger';
import { ChatOptions, ToolCall } from '../interfaces/provider';

/**
 * Execution context passed through the pipeline
 */
/**
 * Execution context for service operations
 * Applies Type Deduplication Rule: Use standardized metadata type
 */
export interface ExecutionContext {
    conversationId?: string;
    sessionId?: string;
    userId?: string;
    messages: Message[];
    config: AgentConfig;
    metadata?: Metadata;
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
 * History statistics type returned by ConversationHistory.getStats()
 */
interface HistoryStats {
    totalConversations: number;
    conversationIds: string[];
    totalMessages: number;
}

/**
 * Plugin statistics type - using a simpler structure
 */
interface PluginStats {
    pluginCount: number;
    pluginNames: string[];
    historyStats: HistoryStats;
    // Plugin-specific stats will be stored separately to avoid type conflicts
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
        this.logger = createLogger('ExecutionService');
    }

    /**
     * Register a plugin
     */
    registerPlugin(plugin: BasePlugin): void {
        this.plugins.push(plugin);
        this.logger.debug('Plugin registered', {
            pluginName: plugin.name,
            pluginType: plugin.constructor.name,
            hasBeforeRun: typeof plugin.beforeRun,
            hasAfterRun: typeof plugin.afterRun,
            hasBeforeProviderCall: typeof plugin.beforeProviderCall,
            hasAfterProviderCall: typeof plugin.afterProviderCall
        });
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
                        conversationSession.addAssistantMessage(msg.content, (msg as AssistantMessage).toolCalls, msg.metadata);
                    } else if (msg.role === 'system') {
                        conversationSession.addSystemMessage(msg.content, msg.metadata);
                    } else if (msg.role === 'tool') {
                        const toolName = (msg.metadata?.['toolName'] as string) || 'unknown';
                        conversationSession.addToolMessageWithId(
                            msg.content,
                            (msg as ToolMessage).toolCallId,
                            toolName,
                            msg.metadata
                        );
                    }
                });
            }

            // Add system message from config if provided and not already present
            // This allows for additional system messages during execution but prevents duplicates
            if (config.systemMessage) {
                const existingMessages = conversationSession.getMessages();
                const hasConfigSystemMessage = existingMessages.some(msg =>
                    msg.role === 'system' && msg.content === config.systemMessage
                );

                if (!hasConfigSystemMessage) {
                    conversationSession.addSystemMessage(config.systemMessage, { executionId });
                }
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
            await this.callPluginHook('beforeRun', {
                input,
                metadata: (context?.metadata || {}) as Metadata
            });

            // Get AI provider instance
            const provider = this.aiProviders.getCurrentProviderInstance();
            if (!provider) {
                throw new Error('No AI provider available');
            }

            // Ensure provider is BaseAIProvider with execute method
            if (!(provider instanceof BaseAIProvider)) {
                throw new Error('Provider must extend BaseAIProvider to support execution');
            }

            // Process with conversation loop - now delegated to provider
            let toolsExecuted: string[] = [];
            let maxRounds = 10; // Increased limit for complex team delegation scenarios
            let currentRound = 0;

            while (currentRound < maxRounds) {
                currentRound++;

                // Get messages from conversation history
                const conversationMessages = conversationSession.getMessages();

                this.logger.debug('Current conversation messages', {
                    round: currentRound,
                    messageCount: conversationMessages.length,
                    fullHistory: conversationMessages.map((m, index) => ({
                        index,
                        role: m.role,
                        content: m.content?.substring(0, 100),
                        hasToolCalls: 'toolCalls' in m ? !!m.toolCalls?.length : false,
                        toolCallId: 'toolCallId' in m ? m.toolCallId : undefined,
                        toolCallsCount: 'toolCalls' in m ? m.toolCalls?.length : 0
                    }))
                });

                // Call beforeProviderCall hook
                await this.callPluginHook('beforeProviderCall', {
                    messages: conversationMessages.map(msg => ({
                        role: msg.role,
                        content: msg.content || '',
                        timestamp: msg.timestamp?.toISOString() || new Date().toISOString()
                    }))
                });

                this.logger.debug('Sending messages to AI provider', {
                    round: currentRound,
                    messageCount: conversationMessages.length,
                    lastFewMessages: conversationMessages.slice(-5).map(m => ({
                        role: m.role,
                        content: m.content?.substring(0, 50),
                        hasToolCalls: 'toolCalls' in m ? !!m.toolCalls?.length : false,
                        toolCallId: 'toolCallId' in m ? m.toolCallId : undefined
                    }))
                });

                // Validate required model configuration - use new defaultModel format
                if (!config.defaultModel?.model) {
                    throw new Error('Default model is required in agent configuration');
                }

                // Delegate entire execution to provider
                const availableTools = this.tools.getTools();
                const chatOptions: ChatOptions = {
                    model: config.defaultModel.model,
                    ...(config.defaultModel.maxTokens !== undefined && { maxTokens: config.defaultModel.maxTokens }),
                    ...(config.defaultModel.temperature !== undefined && { temperature: config.defaultModel.temperature }),
                    ...(availableTools.length > 0 && { tools: availableTools })
                };

                const response = await provider.chat(conversationMessages, chatOptions);

                // Call afterProviderCall hook
                await this.callPluginHook('afterProviderCall', {
                    messages: conversationMessages.map(msg => ({
                        role: msg.role,
                        content: msg.content || '',
                        timestamp: msg.timestamp?.toISOString() || new Date().toISOString()
                    })),
                    response: response.content || ''
                });

                // Add assistant response to history
                // Response from AI provider should always be assistant message
                if (response.role !== 'assistant') {
                    throw new Error(`Unexpected response role: ${response.role}`);
                }

                const assistantResponse = response as AssistantMessage;
                conversationSession.addAssistantMessage(
                    assistantResponse.content ?? null,  // Convert undefined to null for consistency
                    assistantResponse.toolCalls,
                    {
                        round: currentRound,
                        ...(assistantResponse.metadata?.['usage'] && { usage: assistantResponse.metadata['usage'] })
                    }
                );

                // Check if we need to execute tools
                if (!assistantResponse.toolCalls || assistantResponse.toolCalls.length === 0) {
                    // No tools to execute, we're done
                    break;
                }

                this.logger.debug('Tool calls detected, executing tools', {
                    toolCallCount: assistantResponse.toolCalls.length,
                    round: currentRound,
                    toolCalls: assistantResponse.toolCalls.map((tc: ToolCall) => ({ id: tc.id, name: tc.function?.name }))
                });

                // Execute tools
                const toolRequests = this.toolExecutionService.createExecutionRequests(assistantResponse.toolCalls);
                const toolContext: ToolExecutionBatchContext = {
                    requests: toolRequests,
                    mode: 'parallel',
                    maxConcurrency: 5,
                    continueOnError: true
                };

                const toolSummary = await this.toolExecutionService.executeTools(toolContext);
                toolsExecuted.push(...toolSummary.results.map(r => r.toolName || 'unknown'));

                // Add tool results to history in the order they were called
                // This ensures proper conversation flow and prevents any duplicate entries
                for (const toolCall of assistantResponse.toolCalls) {
                    if (!toolCall.id) {
                        throw new Error(`Tool call missing ID: ${JSON.stringify(toolCall)}`);
                    }

                    // Find the corresponding result for this tool call
                    const result = toolSummary.results.find(r => r.executionId === toolCall.id);
                    const error = toolSummary.errors.find(e => e.executionId === toolCall.id);

                    let content: string;
                    let metadata: Record<string, string | number | boolean> = { round: currentRound };

                    if (result && result.success) {
                        // Successful tool execution
                        content = typeof result.result === 'string'
                            ? result.result
                            : JSON.stringify(result.result || 'Tool executed successfully');
                        metadata['success'] = true;
                        if (result.toolName) {
                            metadata['toolName'] = result.toolName;
                        }
                    } else if (error) {
                        // Tool execution failed
                        content = `Error: ${error.error.message}`;
                        metadata['success'] = false;
                        metadata['error'] = error.error.message;
                        if (error.toolName) {
                            metadata['toolName'] = error.toolName;
                        }
                    } else {
                        // No result found for this tool call
                        throw new Error(`No execution result found for tool call ID: ${toolCall.id}`);
                    }

                    // Add tool result to conversation history
                    // This will throw an error if duplicate toolCallId is detected
                    this.logger.debug('Adding tool result to conversation', {
                        toolCallId: toolCall.id,
                        toolName: toolCall.function?.name,
                        content: content.substring(0, 100),
                        round: currentRound,
                        currentHistoryLength: conversationSession.getMessages().length
                    });

                    conversationSession.addToolMessageWithId(
                        content,
                        toolCall.id,
                        toolCall.function?.name || 'unknown',
                        metadata
                    );

                    this.logger.debug('Tool result added to history', {
                        toolCallId: toolCall.id,
                        newHistoryLength: conversationSession.getMessages().length,
                        round: currentRound
                    });
                }

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
                    .filter(msg => msg.metadata?.['usage'])
                    .reduce((sum, msg) => {
                        const usage = msg.metadata?.['usage'];
                        if (usage && typeof usage === 'object' && 'totalTokens' in usage) {
                            return sum + (Number(usage.totalTokens) || 0);
                        }
                        return sum;
                    }, 0),
                toolsExecuted,
                success: true
            };

            // Call afterRun hook on all plugins
            await this.callPluginHook('afterRun', { input, response: result.response, metadata: context?.metadata as Metadata });

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

            // Call onError hook on all plugins
            await this.callPluginHook('onError', {
                error: error as Error,
                executionContext: this.convertExecutionContextToPluginFormat(fullContext)
            });

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
    async getStats(): Promise<PluginStats> {
        const stats: PluginStats = {
            pluginCount: this.plugins.length,
            pluginNames: this.plugins.map(p => p.name),
            historyStats: this.conversationHistory.getStats()
        };

        // Note: Plugin-specific stats are not included here to avoid type conflicts
        // Plugins can implement their own getStats() method returning their specific stat types

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
     * Handles different hook signatures properly
     */
    private async callPluginHook(
        hookName: string,
        context: PluginContext
    ): Promise<void> {
        for (const plugin of this.plugins) {
            try {
                // Define proper types for plugin hooks
                interface PluginHooks {
                    beforeRun?: (input: string, options?: Metadata) => Promise<void> | void;
                    afterRun?: (input: string, response: string, options?: Metadata) => Promise<void> | void;
                    beforeProviderCall?: (messages: Array<{ role: string; content: string; timestamp: string }>) => Promise<void> | void;
                    afterProviderCall?: (messages: Array<{ role: string; content: string; timestamp: string }>, response: { role: string; content: string; timestamp: Date }) => Promise<void> | void;
                    onError?: (error: Error, context?: Record<string, string | number | boolean>) => Promise<void> | void;
                }

                // Use type assertion to access the hook methods
                const pluginWithHooks = plugin as BasePlugin & PluginHooks;

                // Call the appropriate hook method with correct parameters
                switch (hookName) {
                    case 'beforeRun':
                        if (pluginWithHooks.beforeRun && context.input) {
                            await pluginWithHooks.beforeRun(context.input, context.metadata);
                        }
                        break;
                    case 'afterRun':
                        if (pluginWithHooks.afterRun && context.input && context.response) {
                            await pluginWithHooks.afterRun(context.input, context.response, context.metadata);
                        }
                        break;
                    case 'beforeProviderCall':
                        if (pluginWithHooks.beforeProviderCall && context.messages) {
                            // Convert messages to expected format
                            const formattedMessages = context.messages.map(msg => ({
                                role: String(msg['role'] || ''),
                                content: String(msg['content'] || ''),
                                timestamp: String(msg['timestamp'] || new Date().toISOString())
                            }));
                            await pluginWithHooks.beforeProviderCall(formattedMessages);
                        }
                        break;
                    case 'afterProviderCall':
                        if (pluginWithHooks.afterProviderCall && context.messages && context.response) {
                            // Convert messages to expected format
                            const formattedMessages = context.messages.map(msg => ({
                                role: String(msg['role'] || ''),
                                content: String(msg['content'] || ''),
                                timestamp: String(msg['timestamp'] || new Date().toISOString())
                            }));
                            // For afterProviderCall, we need a single response message
                            const responseMessage = {
                                role: 'assistant' as const,
                                content: context.response,
                                timestamp: new Date()
                            };
                            await pluginWithHooks.afterProviderCall(formattedMessages, responseMessage);
                        }
                        break;
                    case 'onError':
                        if (pluginWithHooks.onError && context.error) {
                            // Convert executionContext to expected format
                            const errorContext = context.executionContext ?
                                Object.fromEntries(
                                    Object.entries(context.executionContext).map(([key, value]) => [
                                        key,
                                        typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
                                            ? value
                                            : String(value)
                                    ])
                                ) : undefined;
                            await pluginWithHooks.onError(context.error, errorContext);
                        }
                        break;
                }
            } catch (error) {
                this.logger.warn('Plugin hook failed', {
                    pluginName: plugin.name,
                    hookName,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }

    /**
     * Convert ExecutionContext to PluginContext compatible format
     */
    private convertExecutionContextToPluginFormat(context: ExecutionContext): Record<string, string | number | boolean> {
        return {
            conversationId: context.conversationId || '',
            sessionId: context.sessionId || '',
            userId: context.userId || '',
            executionId: context.executionId,
            startTime: context.startTime.toISOString(),
            messageCount: context.messages.length
        };
    }
} 