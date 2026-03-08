import { IAgentConfig, IAssistantMessage, IToolMessage, IExecutionContextInjection } from '../interfaces/agent';
import { TMetadata } from '../interfaces/types';
import { ToolExecutionService } from './tool-execution-service';
import type { IAIProviderManager } from '../interfaces/manager';
import type { IToolManager } from '../interfaces/manager';
import { ConversationHistory } from '../managers/conversation-history-manager';
import { createLogger, type ILogger } from '../utils/logger';
import type { TUniversalMessage } from '../interfaces/messages';
import { IEventService } from './event-service';
import type { ExecutionCacheService } from './cache/execution-cache-service';
import type { ConversationSession } from '../managers/conversation-history-manager';

// Re-export constants for public API compatibility
export { EXECUTION_EVENTS, EXECUTION_EVENT_PREFIX } from './execution-constants';

import { EXECUTION_EVENTS } from './execution-constants';
import {
    type IResolvedProviderInfo,
    type IExecutionRoundState,
    type IExecutionContext,
    type IExecutionResult,
    type IExecutionServicePluginStats,
    PREVIEW_LENGTH,
    ID_RADIX,
    ID_RANDOM_LENGTH,
} from './execution-types';
import { ExecutionEventEmitter } from './execution-event-emitter';
import { callPluginHook, type TPluginWithHooks } from './plugin-hook-dispatcher';
import { executeStream as executeStreamFn } from './execution-stream';
import { executeRound } from './execution-round';

/**
 * Service that orchestrates the entire execution pipeline.
 * Coordinates AI provider execution, tool execution service, and plugin lifecycle.
 * Uses centralized conversation history management.
 */
export class ExecutionService {
    private toolExecutionService: ToolExecutionService;
    private aiProviders: IAIProviderManager;
    private tools: IToolManager;
    private conversationHistory: ConversationHistory;
    private plugins: TPluginWithHooks[] = [];
    private logger: ILogger;
    private eventEmitter: ExecutionEventEmitter;
    private cacheService?: ExecutionCacheService;

    constructor(
        aiProviders: IAIProviderManager,
        tools: IToolManager,
        conversationHistory: ConversationHistory,
        eventService?: IEventService,
        executionContext?: IExecutionContextInjection,
        cacheService?: ExecutionCacheService
    ) {
        this.toolExecutionService = new ToolExecutionService(tools);
        this.aiProviders = aiProviders;
        this.tools = tools;
        this.conversationHistory = conversationHistory;
        this.plugins = [];
        this.logger = createLogger('ExecutionService');
        if (!eventService) {
            throw new Error('[EXECUTION] EventService is required');
        }
        this.eventEmitter = new ExecutionEventEmitter(eventService, this.logger, executionContext);
        this.cacheService = cacheService;
    }

    /** Register a plugin */
    registerPlugin(plugin: TPluginWithHooks): void {
        const pluginPriority = plugin.priority ?? 0;
        const insertIndex = this.plugins.findIndex(p => (p.priority ?? 0) < pluginPriority);
        if (insertIndex === -1) {
            this.plugins.push(plugin);
        } else {
            this.plugins.splice(insertIndex, 0, plugin);
        }
        this.logger.debug('Plugin registered', {
            pluginName: plugin.name, priority: pluginPriority,
            hasBeforeRun: typeof plugin.beforeRun,
            hasAfterRun: typeof plugin.afterRun,
            hasBeforeProviderCall: typeof plugin.beforeProviderCall,
            hasAfterProviderCall: typeof plugin.afterProviderCall
        });
    }

    /** Remove a plugin */
    removePlugin(pluginName: string): boolean {
        const index = this.plugins.findIndex(p => p.name === pluginName);
        if (index !== -1) {
            this.plugins.splice(index, 1);
            this.logger.debug('Plugin removed', { pluginName });
            return true;
        }
        return false;
    }

    /** Get a plugin by name */
    getPlugin(pluginName: string): TPluginWithHooks | undefined {
        return this.plugins.find(p => p.name === pluginName);
    }

    /** Get all registered plugins */
    getPlugins(): TPluginWithHooks[] {
        return [...this.plugins];
    }

    /** Execute the full pipeline with centralized history management */
    async execute(
        input: string,
        messages: TUniversalMessage[],
        config: IAgentConfig,
        context?: Partial<IExecutionContext>
    ): Promise<IExecutionResult> {
        const executionId = this.generateExecutionId();
        const startTime = new Date();
        const conversationId = this.requireConversationId(context, 'execute');

        const fullContext: IExecutionContext = {
            messages, config, startTime, executionId, conversationId,
            ...(context?.sessionId && { sessionId: context.sessionId }),
            ...(context?.userId && { userId: context.userId }),
            ...(context?.metadata && { metadata: context.metadata })
        };

        this.eventEmitter.prepareOwnerPathBases(conversationId);

        this.logger.debug('Starting execution pipeline', {
            executionId, conversationId,
            messageCount: messages.length, hasContext: !!context
        });

        const resolved = this.resolveProviderAndTools(config);
        this.eventEmitter.emitExecutionStartEvent(input, config, messages, resolved, conversationId, executionId);

        try {
            const conversationSession = this.initializeConversationSession(
                conversationId, messages, config, executionId
            );

            conversationSession.addUserMessage(input, { executionId });
            this.eventEmitter.emitUserMessageEvent(input, conversationId, executionId);

            await callPluginHook(this.plugins, 'beforeRun', {
                input,
                ...(context?.metadata ? { metadata: context.metadata as TMetadata } : {})
            }, this.logger);

            this.validateProvider(resolved);

            const roundState: IExecutionRoundState = {
                toolsExecuted: [], currentRound: 0,
                runningAssistantCount: 0, lastTrackedAssistantMessage: undefined
            };

            const initialMessages = conversationSession.getMessages();
            for (const msg of initialMessages) {
                if (msg.role === 'assistant') {
                    roundState.runningAssistantCount++;
                    roundState.lastTrackedAssistantMessage = msg as IAssistantMessage;
                }
            }

            const maxRounds = 10;
            const roundDeps = {
                toolExecutionService: this.toolExecutionService,
                plugins: this.plugins,
                logger: this.logger,
                eventEmitter: this.eventEmitter,
                cacheService: this.cacheService,
            };

            while (roundState.currentRound < maxRounds) {
                roundState.currentRound++;
                const shouldBreak = await executeRound(
                    roundState, maxRounds, conversationSession,
                    conversationId, executionId, fullContext, config, resolved,
                    roundDeps
                );
                if (shouldBreak) break;
            }

            if (roundState.currentRound >= maxRounds) {
                this.logger.warn('Maximum execution rounds reached', { maxRounds, conversationId });
            }

            const result = this.buildFinalResult(
                conversationSession, executionId, startTime, roundState.toolsExecuted
            );

            await callPluginHook(this.plugins, 'afterRun', {
                input, response: result.response, metadata: context?.metadata as TMetadata
            }, this.logger);

            this.logger.debug('Execution pipeline completed successfully', {
                executionId, conversationId, duration: result.duration,
                tokensUsed: result.tokensUsed,
                toolsExecuted: result.toolsExecuted.length,
                rounds: roundState.currentRound
            });

            this.eventEmitter.emitExecution(
                EXECUTION_EVENTS.COMPLETE,
                {
                    result: {
                        success: true,
                        data: result.response.substring(0, PREVIEW_LENGTH) + '...'
                    },
                    metadata: {
                        method: 'execute', success: true,
                        duration: result.duration,
                        tokensUsed: result.tokensUsed,
                        toolsExecuted: result.toolsExecuted
                    }
                },
                conversationId, executionId
            );

            return result;
        } catch (error) {
            await this.handleExecutionError(error, fullContext, startTime, conversationId, executionId);
            throw error;
        } finally {
            this.eventEmitter.resetOwnerPathBases();
        }
    }

    /** Execute with streaming response */
    async* executeStream(
        input: string,
        messages: TUniversalMessage[],
        config: IAgentConfig,
        context?: Partial<IExecutionContext>
    ): AsyncGenerator<{ chunk: string; isComplete: boolean }> {
        yield* executeStreamFn(input, messages, config, context, {
            aiProviders: this.aiProviders,
            tools: this.tools,
            conversationHistory: this.conversationHistory,
            toolExecutionService: this.toolExecutionService,
            plugins: this.plugins,
            logger: this.logger,
            eventEmitter: this.eventEmitter,
            generateExecutionId: () => this.generateExecutionId(),
        });
    }

    /** Get execution statistics from plugins */
    async getStats(): Promise<IExecutionServicePluginStats> {
        return {
            pluginCount: this.plugins.length,
            pluginNames: this.plugins.map(p => p.name),
            historyStats: this.conversationHistory.getStats()
        };
    }

    /** Clear all plugins */
    clearPlugins(): void {
        this.plugins = [];
        this.logger.debug('All plugins cleared');
    }

    // --- Private helpers ---

    private resolveProviderAndTools(config: IAgentConfig): IResolvedProviderInfo {
        const currentInfo = this.aiProviders.getCurrentProvider();
        const provider = currentInfo ? this.aiProviders.getProvider(currentInfo.provider) : null;
        if (!currentInfo || !currentInfo.provider || !provider) {
            throw new Error('[EXECUTION] Provider is required');
        }
        const availableTools = this.tools.getTools();
        const aiProviderInfo = {
            providerName: currentInfo.provider,
            model: config.defaultModel.model,
            temperature: config.defaultModel.temperature,
            maxTokens: config.defaultModel.maxTokens
        };
        const toolsInfo = availableTools.map((tool) => {
            const paramSchema = tool.parameters as { properties?: Record<string, object> } | undefined;
            const props = paramSchema?.properties;
            if (!tool.description || tool.description.length === 0) {
                throw new Error(`[EXECUTION] Tool "${tool.name}" is missing description`);
            }
            return {
                name: tool.name, description: tool.description,
                parameters: props && typeof props === 'object' ? Object.keys(props) : []
            };
        });
        return { provider, currentInfo, aiProviderInfo, toolsInfo, availableTools };
    }

    private validateProvider(resolved: IResolvedProviderInfo): void {
        if (!resolved.currentInfo) throw new Error('No AI provider configured');
        if (!resolved.provider) throw new Error(`AI provider '${resolved.currentInfo.provider}' not found`);
        if (typeof resolved.provider.chat !== 'function') {
            throw new Error('Provider must have chat method to support execution');
        }
    }

    private initializeConversationSession(
        conversationId: string, messages: TUniversalMessage[],
        config: IAgentConfig, executionId: string
    ): ConversationSession {
        const session = this.conversationHistory.getConversationSession(conversationId);
        if (session.getMessageCount() === 0 && messages.length > 0) {
            for (const msg of messages) {
                if (msg.role === 'user') {
                    session.addUserMessage(msg.content, msg.metadata, msg.parts);
                } else if (msg.role === 'assistant') {
                    session.addAssistantMessage(msg.content, (msg as IAssistantMessage).toolCalls, msg.metadata, msg.parts);
                } else if (msg.role === 'system') {
                    session.addSystemMessage(msg.content, msg.metadata, msg.parts);
                } else if (msg.role === 'tool') {
                    const toolName = msg.metadata?.['toolName'];
                    if (typeof toolName !== 'string' || toolName.length === 0) {
                        throw new Error('[EXECUTION] Tool message missing toolName metadata');
                    }
                    session.addToolMessageWithId(msg.content, (msg as IToolMessage).toolCallId, toolName, msg.metadata, msg.parts);
                }
            }
        }
        if (config.systemMessage) {
            session.addSystemMessage(config.systemMessage, { executionId });
        }
        return session;
    }

    private buildFinalResult(
        conversationSession: ConversationSession, executionId: string,
        startTime: Date, toolsExecuted: string[]
    ): IExecutionResult {
        const finalMessages = conversationSession.getMessages();
        const lastAssistantMessage = finalMessages.filter(msg => msg.role === 'assistant').pop();
        if (!lastAssistantMessage || typeof lastAssistantMessage.content !== 'string' || lastAssistantMessage.content.length === 0) {
            throw new Error('[EXECUTION] Final assistant message is required');
        }
        const duration = Date.now() - startTime.getTime();
        return {
            response: lastAssistantMessage.content,
            messages: finalMessages.map(msg => {
                if (typeof msg.content !== 'string') throw new Error('[EXECUTION] Message content is required');
                return {
                    role: msg.role, content: msg.content, timestamp: msg.timestamp, metadata: msg.metadata,
                    ...(msg.role === 'assistant' && 'toolCalls' in msg ? { toolCalls: msg.toolCalls } : {}),
                    ...(msg.role === 'tool' && 'toolCallId' in msg ? { toolCallId: msg.toolCallId } : {})
                };
            }) as TUniversalMessage[],
            executionId, duration,
            tokensUsed: finalMessages.filter(msg => msg.metadata?.['usage']).reduce((sum, msg) => {
                const usage = msg.metadata?.['usage'];
                if (usage && typeof usage === 'object' && 'totalTokens' in usage) {
                    const totalTokens = Number(usage.totalTokens);
                    if (Number.isNaN(totalTokens)) throw new Error('[EXECUTION] totalTokens must be a number');
                    return sum + totalTokens;
                }
                return sum;
            }, 0),
            toolsExecuted, success: true
        };
    }

    private async handleExecutionError(
        error: unknown, fullContext: IExecutionContext,
        startTime: Date, conversationId: string, executionId: string
    ): Promise<void> {
        const duration = Date.now() - startTime.getTime();
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        await callPluginHook(this.plugins, 'onError', {
            error: normalizedError,
            executionContext: this.convertExecutionContextToPluginFormat(fullContext)
        }, this.logger);
        this.logger.error('Execution pipeline failed', {
            executionId, conversationId, duration,
            error: error instanceof Error ? error.message : String(error)
        });
        this.eventEmitter.emitExecution(
            EXECUTION_EVENTS.ERROR,
            { error: error instanceof Error ? error.message : String(error),
              metadata: { method: 'execute', success: false, duration } },
            conversationId, executionId
        );
    }

    private generateExecutionId(): string {
        return `exec_${Date.now()}_${Math.random().toString(ID_RADIX).substr(2, ID_RANDOM_LENGTH)}`;
    }

    private requireConversationId(context: { conversationId?: string } | undefined, label: string): string {
        if (!context?.conversationId || context.conversationId.length === 0) {
            throw new Error(`[EXECUTION] conversationId is required for ${label}`);
        }
        return context.conversationId;
    }

    private convertExecutionContextToPluginFormat(context: IExecutionContext): Record<string, string | number | boolean> {
        const conversationId = this.requireConversationId(context, 'plugin-context');
        const payload: Record<string, string | number | boolean> = {
            conversationId, executionId: context.executionId,
            startTime: context.startTime.toISOString(), messageCount: context.messages.length
        };
        if (context.sessionId) payload.sessionId = context.sessionId;
        if (context.userId) payload.userId = context.userId;
        return payload;
    }
}
