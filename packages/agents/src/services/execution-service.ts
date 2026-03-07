import { IAgentConfig, IAssistantMessage, IToolMessage, IExecutionContextInjection } from '../interfaces/agent';
import { IPluginContext, TMetadata } from '../interfaces/types';
import type { IPluginContract, IPluginHooks, IPluginOptions, IPluginStats, IPluginErrorContext } from '../abstracts/abstract-plugin';
import { ToolExecutionService, TOOL_EVENT_PREFIX } from './tool-execution-service';
import type { IAIProviderManager } from '../interfaces/manager';
import type { IToolManager } from '../interfaces/manager';
import { ConversationHistory } from '../managers/conversation-history-manager';
import { createLogger, type ILogger } from '../utils/logger';
import { IChatOptions } from '../interfaces/provider';
import type { IToolCall, TUniversalMessage } from '../interfaces/messages';
import {
    IEventService,
    isDefaultEventService,
    IEventContext,
    IOwnerPathSegment,
    IExecutionEventData,
    IToolEventData,
    bindWithOwnerPath,
    IBaseEventData
} from './event-service';
import type { IToolExecutionBatchContext } from './tool-execution-service';
import type { ExecutionCacheService } from './cache/execution-cache-service';

/**
 * ExecutionService owned events
 * Local event names only (no dots). Full names are composed at emit time.
 */
export const EXECUTION_EVENTS = {
    START: 'start',
    COMPLETE: 'complete',
    ERROR: 'error',
    ASSISTANT_MESSAGE_START: 'assistant_message_start',
    ASSISTANT_MESSAGE_COMPLETE: 'assistant_message_complete',
    USER_MESSAGE: 'user_message',
    TOOL_RESULTS_TO_LLM: 'tool_results_to_llm',
    TOOL_RESULTS_READY: 'tool_results_ready'
} as const;

export const EXECUTION_EVENT_PREFIX = 'execution' as const;

/**
 * Count words in text without allocating an intermediate array.
 * Avoids the cost of split(/\s+/) in hot paths.
 */
function countWords(text: string): number {
    let count = 0;
    let inWord = false;
    for (let i = 0; i < text.length; i++) {
        const isSpace = text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r';
        if (!isSpace && !inWord) { count++; inWord = true; }
        else if (isSpace) { inWord = false; }
    }
    return count;
}

// Step 1: ❌ Can't use Error.executionId (not in Error interface)
// Step 2: ❌ Can't extend Error interface (TypeScript limitation)  
// Step 3: ✅ Define custom interface for execution errors
interface IExecutionError extends Error {
    executionId?: string;
    toolName?: string;
    error?: Error;
}

// Type guard to check if error has execution properties
function isExecutionError(error: Error): error is IExecutionError {
    return 'executionId' in error || 'toolName' in error;
}

/**
 * Execution context passed through the pipeline
 */
/**
 * Execution context for service operations
 * Applies Type Deduplication Rule: Use standardized metadata type
 */
interface IExecutionContext {
    conversationId?: string;
    sessionId?: string;
    userId?: string;
    messages: TUniversalMessage[];
    config: IAgentConfig;
    metadata?: TMetadata;
    startTime: Date;
    executionId: string;
}

/**
 * Execution result containing the response and execution metadata
 */
interface IExecutionResult {
    response: string;
    messages: TUniversalMessage[];
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
interface IHistoryStats {
    totalConversations: number;
    conversationIds: string[];
    totalMessages: number;
}

/**
 * Plugin statistics type - using a simpler structure
 */
interface IExecutionServicePluginStats {
    pluginCount: number;
    pluginNames: string[];
    historyStats: IHistoryStats;
    // Plugin-specific stats will be stored separately to avoid type conflicts
}

/**
 * Service that orchestrates the entire execution pipeline
 * Coordinates AI provider execution, tool execution service, and plugin lifecycle
 * Uses centralized conversation history management
 */
export class ExecutionService {
    private toolExecutionService: ToolExecutionService;
    private aiProviders: IAIProviderManager;
    private tools: IToolManager;
    private conversationHistory: ConversationHistory;
    private plugins: Array<IPluginContract<IPluginOptions, IPluginStats> & IPluginHooks> = [];
    private logger: ILogger;
    private baseEventService: IEventService;
    private executionContext?: IExecutionContextInjection; // [CONTEXT-INJECTION] Parent execution context
    private ownerPathBase: IOwnerPathSegment[];
    private toolEventServices: Map<string, IEventService>;
    private agentOwnerPathBase: IOwnerPathSegment[];
    private cacheService?: ExecutionCacheService;

    constructor(
        aiProviders: IAIProviderManager,
        tools: IToolManager,
        conversationHistory: ConversationHistory,
        eventService?: IEventService,
        executionContext?: IExecutionContextInjection, // [CONTEXT-INJECTION] Accept parent context
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
        this.baseEventService = eventService;
        this.executionContext = executionContext; // [CONTEXT-INJECTION] Store parent context
        this.ownerPathBase = this.buildBaseOwnerPath(executionContext);
        this.toolEventServices = new Map();
        this.agentOwnerPathBase = [];
        this.cacheService = cacheService;
    }

    /**
     * Register a plugin
     */
    registerPlugin(plugin: IPluginContract<IPluginOptions, IPluginStats> & IPluginHooks): void {
        // Insert in priority order (higher priority first, stable for equal priority)
        const pluginPriority = plugin.priority ?? 0;
        const insertIndex = this.plugins.findIndex(p => (p.priority ?? 0) < pluginPriority);
        if (insertIndex === -1) {
            this.plugins.push(plugin);
        } else {
            this.plugins.splice(insertIndex, 0, plugin);
        }
        this.logger.debug('Plugin registered', {
            pluginName: plugin.name,
            priority: pluginPriority,
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
    getPlugin(pluginName: string): (IPluginContract<IPluginOptions, IPluginStats> & IPluginHooks) | null {
        return this.plugins.find(p => p.name === pluginName) ?? null;
    }

    /**
     * Get all registered plugins
     */
    getPlugins(): Array<IPluginContract<IPluginOptions, IPluginStats> & IPluginHooks> {
        return [...this.plugins];
    }

    /**
     * Execute the full pipeline with centralized history management
     */
    async execute(
        input: string,
        messages: TUniversalMessage[],
        config: IAgentConfig,
        context?: Partial<IExecutionContext>
    ): Promise<IExecutionResult> {
        // [EXECUTION-DEBUG] ExecutionService.execute entrypoint
        // Avoid console usage; use injected logger only.
        const executionId = this.generateExecutionId();
        const startTime = new Date();
        const conversationId = this.requireConversationId(context, 'execute');

        const fullContext: IExecutionContext = {
            messages,
            config,
            startTime,
            executionId,
            conversationId,
            ...(context?.sessionId && { sessionId: context.sessionId }),
            ...(context?.userId && { userId: context.userId }),
            ...(context?.metadata && { metadata: context.metadata })
        };

        this.prepareOwnerPathBases(conversationId);

        this.logger.debug('Starting execution pipeline', {
            executionId,
            conversationId,
            messageCount: messages.length,
            hasContext: !!context
        });

        // Get current provider info and tools for rich data
        const currentInfo = this.aiProviders.getCurrentProvider();
        const provider = currentInfo ? this.aiProviders.getProvider(currentInfo.provider) : null;
        if (!currentInfo || !currentInfo.provider || !provider) {
            throw new Error('[EXECUTION] Provider is required');
        }
        const availableTools = this.tools.getTools();

        // Emit execution start event
        const rootId: string = conversationId;

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
                name: tool.name,
                description: tool.description,
                parameters: props && typeof props === 'object' ? Object.keys(props) : []
            };
        });

        this.emitExecution(
            EXECUTION_EVENTS.START,
            {
                parameters: {
                    input,
                    agentConfiguration: aiProviderInfo,
                    availableTools: toolsInfo,
                    toolCount: toolsInfo.length,
                    hasTools: toolsInfo.length > 0,
                    systemMessage: config.defaultModel.systemMessage,
                    provider: config.defaultModel.provider,
                    model: config.defaultModel.model,
                    temperature: config.defaultModel.temperature,
                    maxTokens: config.defaultModel.maxTokens
                },
                metadata: {
                    method: 'execute',
                    inputLength: input.length,
                    messageCount: messages.length,
                    aiProvider: aiProviderInfo.providerName,
                    model: aiProviderInfo.model,
                    toolsAvailable: toolsInfo.map((t) => t.name),
                    agentCapabilities: {
                        canUseTools: toolsInfo.length > 0,
                        supportedActions: toolsInfo.map((t) => t.name)
                    }
                }
            },
            rootId,
            executionId
        );

        try {
            // Get conversation session for this conversation
            const conversationSession = this.conversationHistory.getConversationSession(conversationId);

            // Initialize conversation history with existing messages if this is first time
            if (conversationSession.getMessageCount() === 0 && messages.length > 0) {
                // Add all messages in the order they appear in the messages array
                // This preserves the original order including multiple system messages
                messages.forEach(msg => {
                    if (msg.role === 'user') {
                        conversationSession.addUserMessage(msg.content, msg.metadata, msg.parts);
                    } else if (msg.role === 'assistant') {
                        conversationSession.addAssistantMessage(
                            msg.content,
                            (msg as IAssistantMessage).toolCalls,
                            msg.metadata,
                            msg.parts
                        );
                    } else if (msg.role === 'system') {
                        conversationSession.addSystemMessage(msg.content, msg.metadata, msg.parts);
                    } else if (msg.role === 'tool') {
                        const toolName = msg.metadata?.['toolName'];
                        if (typeof toolName !== 'string' || toolName.length === 0) {
                            throw new Error('[EXECUTION] Tool message missing toolName metadata');
                        }
                        conversationSession.addToolMessageWithId(
                            msg.content,
                            (msg as IToolMessage).toolCallId,
                            toolName,
                            msg.metadata,
                            msg.parts
                        );
                    }
                });
            }

            // Add system message from config in the main execution path.
            if (config.systemMessage) {
                conversationSession.addSystemMessage(config.systemMessage, { executionId });
            }

            conversationSession.addUserMessage(input, { executionId });

            const rootId: string = conversationId;
            this.emitExecution(
                EXECUTION_EVENTS.USER_MESSAGE,
                {
                    parameters: {
                        input,
                        userPrompt: input,
                        userMessageContent: input,
                        messageLength: input.length,
                        wordCount: countWords(input),
                        characterCount: input.length
                    },
                    metadata: {
                        messageRole: 'user',
                        inputLength: input.length,
                        messageType: 'user_message',
                        hasQuestions: input.includes('?'),
                        containsUrgency: /urgent|asap|critical|emergency/i.test(input),
                        estimatedComplexity: input.length > 200 ? 'high' : input.length > 50 ? 'medium' : 'low'
                    }
                },
                rootId,
                executionId
            );

            // Call beforeRun hook on all plugins
            await this.callPluginHook('beforeRun', {
                input,
                ...(context?.metadata ? { metadata: context.metadata as TMetadata } : {})
            });

            // Use already retrieved provider info from rich data collection above
            if (!currentInfo) {
                throw new Error('No AI provider configured');
            }
            if (!provider) {
                throw new Error(`AI provider '${currentInfo.provider}' not found`);
            }

            // Provider implements IAIProvider, so chat() must exist.
            if (typeof provider.chat !== 'function') {
                throw new Error('Provider must have chat method to support execution');
            }

            // Process with conversation loop - now delegated to provider
            let toolsExecuted: string[] = [];
            let maxRounds = 10; // Increased limit for complex team delegation scenarios
            let currentRound = 0;

            // Running assistant message tracking to avoid per-round filter scans
            const initialMessages = conversationSession.getMessages();
            let runningAssistantCount = 0;
            let lastTrackedAssistantMessage: IAssistantMessage | undefined;
            for (const msg of initialMessages) {
                if (msg.role === 'assistant') {
                    runningAssistantCount++;
                    lastTrackedAssistantMessage = msg as IAssistantMessage;
                }
            }

            while (currentRound < maxRounds) {
                currentRound++;

                this.logger.debug(`[ROUND-${currentRound}] Starting execution round ${currentRound}`, {
                    executionId,
                    conversationId: fullContext.conversationId,
                    round: currentRound,
                    maxRounds: maxRounds
                });

                // Generate the thinking node id for this round at round start.
                const rootId: string = conversationId;
                // Path-only stable thinking id: conversation-level round (next assistant turn)
                const historyMessages = conversationSession.getMessages();
                if (!Array.isArray(historyMessages)) {
                    throw new Error('[EXECUTION] Conversation messages must be an array');
                }
                const assistantMessageCount = runningAssistantCount;
                const latestAssistantMessage = lastTrackedAssistantMessage;
                const shouldChainFromPreviousToolResult =
                    Array.isArray(latestAssistantMessage?.toolCalls) &&
                    latestAssistantMessage.toolCalls.length > 0;
                const thinkingNodeId = `thinking_${rootId}_round${assistantMessageCount + 1}`;
                const previousThinkingNodeId = shouldChainFromPreviousToolResult
                    ? `thinking_${rootId}_round${assistantMessageCount}`
                    : undefined;

                // Get messages from conversation history
                const conversationMessages = historyMessages;

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
                    messages: conversationMessages
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
                    throw new Error('Model is required in defaultModel configuration. Please specify a model.');
                }

                if (typeof config.defaultModel.model !== 'string' || config.defaultModel.model.trim() === '') {
                    throw new Error('Model must be a non-empty string in defaultModel configuration.');
                }

                // Delegate entire execution to provider (reuse availableTools from outer scope)
                const chatOptions: IChatOptions = {
                    model: config.defaultModel.model,
                    ...(config.defaultModel.maxTokens !== undefined && { maxTokens: config.defaultModel.maxTokens }),
                    ...(config.defaultModel.temperature !== undefined && { temperature: config.defaultModel.temperature }),
                    ...(availableTools.length > 0 && { tools: availableTools })
                };

                // Emit assistant message start event for each thinking phase.
                // Absolute path-only: the path tail must be the thinking node id for this round.
                this.emitWithContext(
                    EXECUTION_EVENTS.ASSISTANT_MESSAGE_START,
                    {
                        parameters: {
                            round: currentRound,
                            messageCount: conversationMessages.length
                        },
                        metadata: {
                            round: currentRound,
                            thinkingNodeId
                        }
                    },
                    () => this.buildThinkingOwnerContext(rootId, executionId, thinkingNodeId, previousThinkingNodeId),
                    ctx => {
                        if (!ctx.ownerType || !ctx.ownerId) {
                            throw new Error('[EXECUTION] Missing owner context for thinking event');
                        }
                        return bindWithOwnerPath(this.baseEventService, {
                            ownerType: ctx.ownerType,
                            ownerId: ctx.ownerId,
                            ownerPath: ctx.ownerPath
                        });
                    }
                );

                let response: TUniversalMessage;

                // Cache-first: check cache before LLM call (no-fallback on integrity error)
                if (this.cacheService) {
                    const cachedResponse = this.cacheService.lookup(
                        conversationMessages,
                        config.defaultModel.model,
                        config.defaultModel.provider,
                        { temperature: config.defaultModel.temperature, maxTokens: config.defaultModel.maxTokens }
                    );
                    if (cachedResponse) {
                        response = { role: 'assistant', content: cachedResponse, timestamp: new Date() };
                    } else {
                        response = await provider.chat(conversationMessages, chatOptions);
                        if (typeof response.content === 'string') {
                            this.cacheService.store(
                                conversationMessages,
                                config.defaultModel.model,
                                config.defaultModel.provider,
                                response.content,
                                { temperature: config.defaultModel.temperature, maxTokens: config.defaultModel.maxTokens }
                            );
                        }
                    }
                } else {
                    response = await provider.chat(conversationMessages, chatOptions);
                }

                const assistantToolCallsFromResponse = response.role === 'assistant'
                    ? (response as IAssistantMessage).toolCalls
                    : undefined;

                const hasToolCalls = Array.isArray(assistantToolCallsFromResponse) && assistantToolCallsFromResponse.length > 0;
                if (typeof response.content !== 'string' && !hasToolCalls) {
                    throw new Error('[EXECUTION] Provider response must have content or tool calls');
                }
                if (assistantToolCallsFromResponse && !Array.isArray(assistantToolCallsFromResponse)) {
                    throw new Error('[EXECUTION] assistant toolCalls must be an array');
                }
                const responseContent = response.content ?? '';
                this.logger.debug(`[ROUND-${currentRound}] Provider response completed`, {
                    executionId,
                    conversationId: fullContext.conversationId,
                    round: currentRound,
                    responseLength: responseContent.length,
                    hasToolCalls: Array.isArray(assistantToolCallsFromResponse) && assistantToolCallsFromResponse.length > 0,
                    toolCallsCount: Array.isArray(assistantToolCallsFromResponse) ? assistantToolCallsFromResponse.length : 0
                });

                // Call afterProviderCall hook
                await this.callPluginHook('afterProviderCall', {
                    messages: conversationMessages,
                    responseMessage: response
                });

                // Add assistant response to history
                // Response from AI provider should always be assistant message
                if (response.role !== 'assistant') {
                    throw new Error(`Unexpected response role: ${response.role}`);
                }

                const assistantResponse = response as IAssistantMessage;
                const assistantToolCalls = assistantResponse.toolCalls ?? [];
                if (!Array.isArray(assistantToolCalls)) {
                    throw new Error('[EXECUTION] assistantResponse.toolCalls must be an array');
                }
                conversationSession.addAssistantMessage(
                    assistantResponse.content ?? '',
                    assistantToolCalls,
                    {
                        round: currentRound,
                        ...(assistantResponse.metadata?.['usage'] && { usage: assistantResponse.metadata['usage'] })
                    }
                );
                // Update running assistant message tracker
                runningAssistantCount++;
                lastTrackedAssistantMessage = assistantResponse;

                if (assistantToolCalls.length === 0) {
                    // No tools to execute, we're done
                    this.logger.debug(`[AGENT-FLOW-CONTROL] Round ${currentRound} completed - no tool calls, execution finished for agent ${fullContext.conversationId}`);

                    if ((typeof assistantResponse.content !== 'string' || assistantResponse.content.length === 0) && assistantToolCalls.length === 0) {
                        throw new Error('[EXECUTION] assistant response must have content or tool calls');
                    }
                    if (!(assistantResponse.timestamp instanceof Date)) {
                        throw new Error('[EXECUTION] assistant response timestamp is required');
                    }
                    const responseContent = assistantResponse.content as string;
                    const responseStartTime = assistantResponse.timestamp;
                    const responseDuration = new Date().getTime() - responseStartTime.getTime();

                    this.emitWithContext(
                        EXECUTION_EVENTS.ASSISTANT_MESSAGE_COMPLETE,
                        {
                            parameters: {
                                assistantMessage: responseContent,
                                responseLength: responseContent.length,
                                wordCount: countWords(responseContent),
                                responseTime: responseDuration,
                                contentPreview: responseContent.length > 200
                                    ? responseContent.substring(0, 200) + '...'
                                    : responseContent
                            },
                            result: {
                                success: true,
                                data: responseContent.substring(0, 100) + '...',
                                fullResponse: responseContent,
                                responseMetrics: {
                                    length: responseContent.length,
                                    estimatedReadTime: Math.ceil(countWords(responseContent) / 200),
                                    hasCodeBlocks: /```/.test(responseContent),
                                    hasLinks: /https?:\/\//.test(responseContent),
                                    complexity: responseContent.length > 1000 ? 'high' : responseContent.length > 300 ? 'medium' : 'low'
                                }
                            },
                            metadata: {
                                executionId,
                                round: currentRound,
                                completed: true,
                                reason: 'no_tool_calls',
                                responseCharacteristics: {
                                    hasQuestions: responseContent.includes('?'),
                                    isError: /error|fail|wrong/i.test(responseContent),
                                    isComplete: /complete|done|finish/i.test(responseContent),
                                    containsNumbers: /\d/.test(responseContent)
                                }
                            }
                        },
                    () => this.buildResponseOwnerContext(rootId, executionId, thinkingNodeId, previousThinkingNodeId),
                        ctx => {
                            if (!ctx.ownerType || !ctx.ownerId) {
                                throw new Error('[EXECUTION] Missing owner context for response event');
                            }
                            return bindWithOwnerPath(this.baseEventService, {
                                ownerType: ctx.ownerType,
                                ownerId: ctx.ownerId,
                                ownerPath: ctx.ownerPath
                            });
                        }
                    );

                    break;
                } else {
                    // Tools are triggered in this round. Do not emit assistant_message_complete yet.
                    // Completion will be emitted when a subsequent assistant turn finishes without tool calls.
                }

                this.logger.debug('Tool calls detected, executing tools', {
                    toolCallCount: assistantToolCalls.length,
                    round: currentRound,
                    toolCalls: assistantToolCalls.map((tc: IToolCall) => ({ id: tc.id, name: tc.function?.name }))
                });

                // Execute tools
                // Ensure proper ID hierarchy for tool execution
                const toolRootId: string = conversationId;
                const rootForTools = toolRootId;
                // Absolute path-only: tool calls must be children of the thinking node (fork point).
                const toolOwnerPathBase = this.buildThinkingOwnerContext(rootForTools, executionId, thinkingNodeId, previousThinkingNodeId).ownerPath;
                const expectedCountForBatch = assistantToolCalls.length;
                const batchId = `${thinkingNodeId}`;
                const toolRequestsBase = this.toolExecutionService.createExecutionRequestsWithContext(
                    assistantToolCalls,
                    {
                        ownerPathBase: toolOwnerPathBase,
                        metadataFactory: toolCall => ({
                            conversationId: toolRootId,
                            round: currentRound,
                            directParentId: thinkingNodeId,
                            batchId,
                            expectedCount: expectedCountForBatch,
                            toolCallId: toolCall.id
                        })
                    }
                );
                const toolRequests = toolRequestsBase.map(request => {
                    if (!request.ownerId) {
                        throw new Error('[EXECUTION] Tool request missing ownerId');
                    }
                    return {
                        ...request,
                        eventService: this.ensureToolEventService(request.ownerId, request.ownerPath),
                        baseEventService: this.baseEventService
                    };
                });
                const toolContext: IToolExecutionBatchContext = {
                    requests: toolRequests,
                    mode: 'parallel',
                    maxConcurrency: 5,
                    continueOnError: true
                };

                const toolSummary = await this.toolExecutionService.executeTools(toolContext);

                toolsExecuted.push(...toolSummary.results.map(r => {
                    if (!r.toolName || r.toolName.length === 0) {
                        throw new Error('[EXECUTION] Tool result missing toolName');
                    }
                    return r.toolName;
                }));

                // Add tool results to history in the order they were called
                // This ensures proper conversation flow and prevents any duplicate entries
                for (const toolCall of assistantToolCalls) {
                    if (!toolCall.id) {
                        throw new Error(`Tool call missing ID: ${JSON.stringify(toolCall)}`);
                    }
                    const toolCallName = toolCall.function?.name;
                    if (!toolCallName || toolCallName.length === 0) {
                        throw new Error(`[EXECUTION] Tool call "${toolCall.id}" missing function name`);
                    }

                    // Find the corresponding result for this tool call
                    const result = toolSummary.results.find(r => r.executionId === toolCall.id);
                    const error = toolSummary.errors.find(e => isExecutionError(e) && e.executionId === toolCall.id);

                    let content: string;
                    let metadata: Record<string, string | number | boolean> = { round: currentRound };

                    if (result && result.success) {
                        if (typeof result.result === 'undefined') {
                            throw new Error('[EXECUTION] Tool result missing result payload');
                        }
                        content = typeof result.result === 'string'
                            ? result.result
                            : JSON.stringify(result.result);
                        metadata['success'] = true;
                        if (result.toolName) {
                            metadata['toolName'] = result.toolName;
                        }
                    } else if (result && !result.success) {
                        // Tool execution failed (result is still present to preserve deterministic ordering)
                        if (!result.error || result.error.length === 0) {
                            throw new Error('[EXECUTION] Tool result missing error message');
                        }
                        content = `Error: ${result.error}`;
                        metadata['success'] = false;
                        metadata['error'] = result.error;
                        if (result.toolName) {
                            metadata['toolName'] = result.toolName;
                        }
                    } else if (error) {
                        // Tool execution failed
                        const execError = error as IExecutionError;
                        const execMessage = (() => {
                            if (execError.error?.message) return execError.error.message;
                            if (execError.message) return execError.message;
                            return '';
                        })();
                        if (!execMessage || execMessage.length === 0) {
                            throw new Error('[EXECUTION] Tool execution error missing message');
                        }
                        content = `Error: ${execMessage}`;
                        metadata['success'] = false;
                        metadata['error'] = execMessage;
                        if (execError.toolName) {
                            metadata['toolName'] = execError.toolName;
                        }
                    } else {
                        // No result found for this tool call
                        throw new Error(`No execution result found for tool call ID: ${toolCall.id}`);
                    }

                    // Add tool result to conversation history
                    // This will throw an error if duplicate toolCallId is detected
                    this.logger.debug('Adding tool result to conversation', {
                        toolCallId: toolCall.id,
                        toolName: toolCallName,
                        content: content.substring(0, 100),
                        round: currentRound,
                        currentHistoryLength: conversationSession.getMessages().length
                    });

                    conversationSession.addToolMessageWithId(
                        content,
                        toolCall.id,
                        toolCallName,
                        metadata
                    );

                    this.logger.debug('Tool result added to history', {
                        toolCallId: toolCall.id,
                        newHistoryLength: conversationSession.getMessages().length,
                        round: currentRound
                    });
                }

                // Emit tool results ready (join trigger) and then delivery to LLM
                const toolResultsRootId: string = rootId;
                const toolCallIds = assistantToolCalls.map(toolCall => {
                    if (!toolCall.id || toolCall.id.length === 0) {
                        throw new Error('[EXECUTION] Tool call missing id for tool results ready payload');
                    }
                    return toolCall.id;
                });
                if (toolCallIds.length === 0) {
                    throw new Error('[EXECUTION] Tool results ready requires toolCallIds');
                }
                this.emitWithContext(
                    EXECUTION_EVENTS.TOOL_RESULTS_READY,
                    {
                        parameters: {
                            toolCallIds,
                            round: currentRound
                        },
                        metadata: {
                            round: currentRound
                        }
                    },
                    () => this.buildThinkingOwnerContext(rootId, executionId, thinkingNodeId, previousThinkingNodeId),
                    ctx => {
                        if (!ctx.ownerType || !ctx.ownerId) {
                            throw new Error('[EXECUTION] Missing owner context for tool results ready');
                        }
                        return bindWithOwnerPath(this.baseEventService, {
                            ownerType: ctx.ownerType,
                            ownerId: ctx.ownerId,
                            ownerPath: ctx.ownerPath
                        });
                    }
                );

                this.emitWithContext(
                    EXECUTION_EVENTS.TOOL_RESULTS_TO_LLM,
                    {
                        parameters: {
                            toolsExecuted: toolsExecuted.length,
                            round: currentRound
                        },
                        metadata: {
                            toolsExecuted: toolSummary.results.map(r => {
                                if (!r.toolName || r.toolName.length === 0) {
                                    throw new Error('[EXECUTION] Tool result missing toolName');
                                }
                                return r.toolName;
                            }),
                            round: currentRound
                        }
                    },
                    () => this.buildThinkingOwnerContext(toolResultsRootId, executionId, thinkingNodeId, previousThinkingNodeId),
                    ctx => {
                        if (!ctx.ownerType || !ctx.ownerId) {
                            throw new Error('[EXECUTION] Missing owner context for tool results to llm');
                        }
                        return bindWithOwnerPath(this.baseEventService, {
                            ownerType: ctx.ownerType,
                            ownerId: ctx.ownerId,
                            ownerPath: ctx.ownerPath
                        });
                    }
                );

                // Clean up per-round tool event services to bound Map growth
                this.toolEventServices.clear();

                // Continue to next round - let the AI decide if more tools are needed
                // The AI will see the tool results and can either:
                // 1. Call more tools if needed
                // 2. Provide a final response without tool calls
                this.logger.debug(`Round ${currentRound} completed - continuing to next round for agent ${fullContext.conversationId}`);
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
            if (!lastAssistantMessage || typeof lastAssistantMessage.content !== 'string' || lastAssistantMessage.content.length === 0) {
                throw new Error('[EXECUTION] Final assistant message is required');
            }

            const duration = Date.now() - startTime.getTime();
            const result: IExecutionResult = {
                response: lastAssistantMessage.content,
                messages: finalMessages.map(msg => {
                    if (typeof msg.content !== 'string') {
                        throw new Error('[EXECUTION] Message content is required');
                    }
                    return {
                        role: msg.role,
                        content: msg.content,
                        timestamp: msg.timestamp,
                        metadata: msg.metadata,
                        ...(msg.role === 'assistant' && 'toolCalls' in msg ? { toolCalls: msg.toolCalls } : {}),
                        ...(msg.role === 'tool' && 'toolCallId' in msg ? { toolCallId: msg.toolCallId } : {})
                    };
                }) as TUniversalMessage[],
                executionId,
                duration,
                tokensUsed: finalMessages
                    .filter(msg => msg.metadata?.['usage'])
                    .reduce((sum, msg) => {
                        const usage = msg.metadata?.['usage'];
                        if (usage && typeof usage === 'object' && 'totalTokens' in usage) {
                            const totalTokens = Number(usage.totalTokens);
                            if (Number.isNaN(totalTokens)) {
                                throw new Error('[EXECUTION] totalTokens must be a number');
                            }
                            return sum + totalTokens;
                        }
                        return sum;
                    }, 0),
                toolsExecuted,
                success: true
            };

            // Call afterRun hook on all plugins
            await this.callPluginHook('afterRun', { input, response: result.response, metadata: context?.metadata as TMetadata });

            this.logger.debug('Execution pipeline completed successfully', {
                executionId,
                conversationId,
                duration,
                tokensUsed: result.tokensUsed,
                toolsExecuted: result.toolsExecuted.length,
                rounds: currentRound
            });

            // Emit assistant message complete event
            // execution.assistant_message_complete emission is handled in the main execution loop.

            // Emit execution complete event
            const rootIdComplete = conversationId;
            this.emitExecution(
                EXECUTION_EVENTS.COMPLETE,
                {
                    result: {
                        success: true,
                        data: result.response.substring(0, 100) + '...'
                    },
                    metadata: {
                        method: 'execute',
                        success: true,
                        duration,
                        tokensUsed: result.tokensUsed,
                        toolsExecuted: result.toolsExecuted
                    }
                },
                rootIdComplete,
                executionId
            );

            return result;

        } catch (error) {
            const duration = Date.now() - startTime.getTime();

            // Call onError hook on all plugins
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            await this.callPluginHook('onError', {
                error: normalizedError,
                executionContext: this.convertExecutionContextToPluginFormat(fullContext)
            });

            this.logger.error('Execution pipeline failed', {
                executionId,
                conversationId,
                duration,
                error: error instanceof Error ? error.message : String(error)
            });

            // Emit execution error event
            this.emitExecution(
                EXECUTION_EVENTS.ERROR,
                {
                    error: error instanceof Error ? error.message : String(error),
                    metadata: {
                        method: 'execute',
                        success: false,
                        duration,
                        // Identity/hierarchy fields are derived from EventContext.ownerPath.
                    }
                },
                conversationId,
                executionId
            );

            throw error;
        } finally {
            this.resetOwnerPathBases();
        }
    }

    /**
     * Execute with streaming response
     */
    async* executeStream(
        input: string,
        messages: TUniversalMessage[],
        config: IAgentConfig,
        context?: Partial<IExecutionContext>
    ): AsyncGenerator<{ chunk: string; isComplete: boolean }> {
        this.logger.debug('ExecutionService.executeStream called');

        const executionId = this.generateExecutionId();
        const startTime = Date.now();
        if (!context?.conversationId || context.conversationId.length === 0) {
            throw new Error('[EXECUTION] conversationId is required for streaming');
        }
        const streamingConversationId = this.requireConversationId(context, 'streaming');
        this.prepareOwnerPathBases(streamingConversationId);

        try {
            // Create conversation session for this execution
            const conversationSession = this.conversationHistory.getConversationSession(context.conversationId);

            // Add user input to conversation
            if (input) {
                conversationSession.addUserMessage(input, { executionId });
            }

            // Call beforeRun hook on all plugins
            await this.callPluginHook('beforeRun', {
                input,
                ...(context?.metadata ? { metadata: context.metadata as TMetadata } : {})
            });

            // Get current provider info
            const currentInfo = this.aiProviders.getCurrentProvider();
            if (!currentInfo) {
                throw new Error('No AI provider configured');
            }

            // Get actual provider instance
            const provider = this.aiProviders.getProvider(currentInfo.provider);
            if (!provider) {
                throw new Error(`AI provider '${currentInfo.provider}' not found`);
            }

            // Ensure provider has chatStream method (streaming is optional on IAIProvider)
            if (typeof provider.chatStream !== 'function') {
                throw new Error('Provider must have chatStream method to support streaming execution');
            }

            this.logger.debug('ExecutionService calling provider.chatStream');

            // Get conversation messages for provider
            const conversationMessages = conversationSession.getMessages();

            // Create chat options
            const configToolsLength = Array.isArray(config.tools) ? config.tools.length : undefined;
            this.logger.debug('[EXECUTION-SERVICE] config.tools:', { length: configToolsLength });
            const toolSchemas = this.tools.getTools();
            const toolSchemasLength = Array.isArray(toolSchemas) ? toolSchemas.length : undefined;
            this.logger.debug('[EXECUTION-SERVICE] this.tools.getTools():', { length: toolSchemasLength });
            this.logger.debug('[EXECUTION-SERVICE] config.tools exists:', { exists: !!config.tools });
            this.logger.debug('[EXECUTION-SERVICE] config.tools.length > 0:', { hasTools: config.tools && config.tools.length > 0 });

            const chatOptions: IChatOptions = {
                model: config.defaultModel.model,
                ...(config.tools && config.tools.length > 0 && { tools: this.tools.getTools() })
            };

            this.logger.debug('[EXECUTION-SERVICE] Final chatOptions has tools:', { hasTools: !!chatOptions.tools });
            const chatOptionsToolsLength = Array.isArray(chatOptions.tools) ? chatOptions.tools.length : undefined;
            this.logger.debug('[EXECUTION-SERVICE] Final chatOptions.tools length:', { length: chatOptionsToolsLength });

            const chatStream = provider.chatStream;
            if (!chatStream) {
                throw new Error('Provider does not support streaming');
            }

            const stream = chatStream.call(provider, conversationMessages, chatOptions);
            let fullResponse = '';
            let toolCalls: IToolCall[] = [];
            let currentToolCallIndex = -1; // Index of the currently active tool call during streaming

            // Collect streaming chunks and tool calls
            for await (const chunk of stream) {
                if (chunk.content) {
                    fullResponse += chunk.content;
                    yield { chunk: chunk.content, isComplete: false };
                }

                // Collect tool calls from streaming chunks (type assertion for AssistantMessage)
                if (chunk.role === 'assistant') {
                    const assistantChunk = chunk as IAssistantMessage;
                    if (Array.isArray(assistantChunk.toolCalls) && assistantChunk.toolCalls.length > 0) {
                        // Manage tool call state while streaming
                        for (const chunkToolCall of assistantChunk.toolCalls) {
                            if (chunkToolCall.id && chunkToolCall.id !== '') {
                                // ✅ Tool call id present: start a new tool call
                                if (!chunkToolCall.type || chunkToolCall.type.length === 0) {
                                    throw new Error(`[EXECUTION] Tool call "${chunkToolCall.id}" missing type in stream`);
                                }
                                if (!chunkToolCall.function?.name || chunkToolCall.function.name.length === 0) {
                                    throw new Error(`[EXECUTION] Tool call "${chunkToolCall.id}" missing function name in stream`);
                                }
                                if (typeof chunkToolCall.function.arguments !== 'string') {
                                    throw new Error(`[EXECUTION] Tool call "${chunkToolCall.id}" missing arguments in stream`);
                                }
                                currentToolCallIndex = toolCalls.length;
                                toolCalls.push({
                                    id: chunkToolCall.id,
                                    type: chunkToolCall.type,
                                    function: {
                                        name: chunkToolCall.function.name,
                                        arguments: chunkToolCall.function.arguments
                                    }
                                });
                                this.logger.debug(`🆕 [TOOL-STREAM] New tool call started: ${chunkToolCall.id} (${chunkToolCall.function?.name})`);
                            } else if (currentToolCallIndex >= 0) {
                                // ✅ Tool call id missing: append fragments to the current tool call
                                const hasNameFragment = typeof chunkToolCall.function?.name === 'string' && chunkToolCall.function.name.length > 0;
                                const hasArgumentsFragment = typeof chunkToolCall.function?.arguments === 'string' && chunkToolCall.function.arguments.length > 0;
                                if (!hasNameFragment && !hasArgumentsFragment) {
                                    throw new Error(`[EXECUTION] Tool call fragment missing name/arguments for ${toolCalls[currentToolCallIndex].id}`);
                                }
                                if (hasNameFragment) {
                                    toolCalls[currentToolCallIndex].function.name += chunkToolCall.function!.name;
                                }
                                if (hasArgumentsFragment) {
                                    toolCalls[currentToolCallIndex].function.arguments += chunkToolCall.function!.arguments;
                                }
                                const fragmentPreview = hasArgumentsFragment
                                    ? chunkToolCall.function!.arguments
                                    : chunkToolCall.function!.name;
                                this.logger.debug(`📝 [TOOL-STREAM] Adding fragment to tool ${toolCalls[currentToolCallIndex].id}: "${fragmentPreview}"`);
                            }
                        }
                    }
                }
            }

            this.logger.debug('[EXECUTION-SERVICE-STREAM] Stream completed, toolCalls detected:', { count: toolCalls.length });

            if (typeof fullResponse !== 'string') {
                throw new Error('[EXECUTION] Streaming response content is required');
            }
            conversationSession.addAssistantMessage(
                fullResponse,
                toolCalls,
                { executionId }
            );

            // Execute tools if detected
            if (toolCalls.length > 0) {
                this.logger.debug('[EXECUTION-SERVICE-STREAM] Executing tools:', { tools: toolCalls.map(tc => tc.function.name) });

                // Execute tools with hierarchical context
                const streamingRootId = streamingConversationId;
                // Generate thinking node ID for streaming mode (direct provision)
                const streamingThinkingNodeId = `thinking_${streamingRootId}_${Date.now()}_${executionId}`;
                const streamingOwnerPathBase = [...this.buildExecutionOwnerContext(streamingRootId, executionId).ownerPath, { type: 'thinking', id: streamingThinkingNodeId }];
                const toolRequests = this.toolExecutionService.createExecutionRequestsWithContext(
                    toolCalls,
                    {
                        ownerPathBase: streamingOwnerPathBase
                    }
                );
                const toolContext: IToolExecutionBatchContext = {
                    requests: toolRequests,
                    mode: 'parallel',
                    maxConcurrency: 5,
                    continueOnError: true
                };

                const toolSummary = await this.toolExecutionService.executeTools(toolContext);

                // Add tool results to conversation in the order they were called
                for (const toolCall of toolCalls) {
                    if (!toolCall.id) {
                        throw new Error('[EXECUTION] Tool call missing id in streaming mode');
                    }
                    if (!toolCall.function?.name || toolCall.function.name.length === 0) {
                        throw new Error(`[EXECUTION] Tool call "${toolCall.id}" missing function name in streaming mode`);
                    }

                    // Find the corresponding result for this tool call
                    const result = toolSummary.results.find(r => r.executionId === toolCall.id);
                    const error = toolSummary.errors.find(e => isExecutionError(e) && e.executionId === toolCall.id);

                    let content: string;
                    let metadata: Record<string, string | number | boolean> = { executionId };

                    if (result && result.success) {
                        if (typeof result.result === 'undefined') {
                            throw new Error('[EXECUTION] Tool result missing result payload in streaming mode');
                        }
                        content = typeof result.result === 'string'
                            ? result.result
                            : JSON.stringify(result.result);
                        metadata['success'] = true;
                        if (result.toolName) {
                            metadata['toolName'] = result.toolName;
                        }

                        // Yield tool result as streaming chunk
                        yield { chunk: `\n[Tool: ${toolCall.function.name} executed successfully]`, isComplete: false };
                    } else if (error) {
                        // Tool execution failed
                        const execError = error as IExecutionError;
                        const execMessage = (() => {
                            if (execError.error?.message) return execError.error.message;
                            if (execError.message) return execError.message;
                            return '';
                        })();
                        if (!execMessage || execMessage.length === 0) {
                            throw new Error('[EXECUTION] Tool execution error missing message in streaming mode');
                        }
                        content = `Error: ${execMessage}`;
                        metadata['success'] = false;
                        metadata['error'] = execMessage;
                        if (execError.toolName) {
                            metadata['toolName'] = execError.toolName;
                        }

                        // Yield error as streaming chunk
                        yield { chunk: `\n[Tool: ${toolCall.function.name} failed: ${execMessage}]`, isComplete: false };
                    } else {
                        throw new Error(`[EXECUTION] Missing tool result for tool call "${toolCall.id}" in streaming mode`);
                    }

                    // Add tool result to conversation history
                    conversationSession.addToolMessageWithId(
                        content,
                        toolCall.id,
                        toolCall.function.name,
                        metadata
                    );
                }

                // After all tool responses are emitted and recorded, trigger aggregation join
                const streamingRoot = streamingConversationId;
                const streamingToolCallIds = toolCalls.map(toolCall => {
                    if (!toolCall.id || toolCall.id.length === 0) {
                        throw new Error('[EXECUTION] Tool call missing id for streaming tool results ready payload');
                    }
                    return toolCall.id;
                });
                if (streamingToolCallIds.length === 0) {
                    throw new Error('[EXECUTION] Tool results ready requires toolCallIds in streaming mode');
                }
                this.emitExecution(
                    EXECUTION_EVENTS.TOOL_RESULTS_READY,
                    {
                        parameters: {
                            toolCallIds: streamingToolCallIds,
                            round: 1
                        },
                        metadata: {
                            toolsExecuted: toolSummary.results.map(r => {
                                if (!r.toolName || r.toolName.length === 0) {
                                    throw new Error('[EXECUTION] Tool result missing toolName');
                                }
                                return r.toolName;
                            }),
                            round: 1,
                        }
                    },
                    streamingRoot,
                    executionId
                );
            }

            // Call afterRun hook
            await this.callPluginHook('afterRun', {
                input,
                response: fullResponse,
                ...(context?.metadata ? { metadata: context.metadata as TMetadata } : {})
            });

            yield { chunk: '', isComplete: true };

        } catch (error) {
            this.logger.error('ExecutionService streaming execution failed', {
                error: error instanceof Error ? error.message : String(error),
                executionTime: Date.now() - startTime
            });

            // Call error hook
            await this.callPluginHook('onError', {
                input,
                error: error instanceof Error ? error : new Error(String(error)),
                ...(context?.metadata ? { metadata: context.metadata as TMetadata } : {})
            });

            throw error;
        } finally {
            this.resetOwnerPathBases();
        }
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
    async getStats(): Promise<IExecutionServicePluginStats> {
        const stats: IExecutionServicePluginStats = {
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
     *
     * TODO: Candidate for extraction to PluginHookDispatcher class.
     * Currently blocked because this method directly accesses private fields
     * (this.plugins, this.logger). Extract once these are injectable.
     */
    private async callPluginHook(
        hookName: string,
        context: IPluginContext
    ): Promise<void> {
        for (const plugin of this.plugins) {
            try {
                // Use type assertion to access the hook methods
                const pluginWithHooks = plugin;

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
                            await pluginWithHooks.beforeProviderCall(context.messages);
                        }
                        break;
                    case 'afterProviderCall':
                        if (pluginWithHooks.afterProviderCall && context.messages && context.responseMessage) {
                            await pluginWithHooks.afterProviderCall(context.messages, context.responseMessage);
                        }
                        break;
                    case 'onError':
                        if (pluginWithHooks.onError && context.error) {
                            const errorContext: IPluginErrorContext = {
                                action: `${EXECUTION_EVENT_PREFIX}.${EXECUTION_EVENTS.ERROR}`,
                                metadata: {}
                            };

                            const executionIdValue = context.executionContext?.['executionId'];
                            if (typeof executionIdValue === 'string' && executionIdValue.length > 0) {
                                errorContext.executionId = executionIdValue;
                            }
                            const sessionIdValue = context.executionContext?.['sessionId'];
                            if (typeof sessionIdValue === 'string' && sessionIdValue.length > 0) {
                                errorContext.sessionId = sessionIdValue;
                            }
                            const userIdValue = context.executionContext?.['userId'];
                            if (typeof userIdValue === 'string' && userIdValue.length > 0) {
                                errorContext.userId = userIdValue;
                            }

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

    private ensureToolEventService(ownerId: string | undefined, ownerPath: IOwnerPathSegment[] | undefined): IEventService {
        if (isDefaultEventService(this.baseEventService)) {
            return this.baseEventService;
        }
        if (!ownerId) {
            throw new Error('[EVENT-SERVICE] Missing ownerId for tool event context');
        }
        if (!ownerPath || ownerPath.length === 0) {
            throw new Error('[EVENT-SERVICE] Missing ownerPath for tool event context');
        }
        if (this.toolEventServices.has(ownerId)) {
            return this.toolEventServices.get(ownerId)!;
        }
        const scoped = bindWithOwnerPath(this.baseEventService, {
            ownerType: TOOL_EVENT_PREFIX,
            ownerId,
            ownerPath: ownerPath.map(segment => ({ ...segment })),
        });
        this.toolEventServices.set(ownerId, scoped);
        return scoped;
    }

    private prepareOwnerPathBases(conversationId: string): void {
        this.toolEventServices.clear();
        const ownerPath = [...this.ownerPathBase, { type: 'agent', id: conversationId }];
        this.agentOwnerPathBase = ownerPath;
    }

    private resetOwnerPathBases(): void {
        this.toolEventServices.clear();
        this.agentOwnerPathBase = [];
    }

    private buildBaseOwnerPath(executionContext?: IExecutionContextInjection): IOwnerPathSegment[] {
        if (!executionContext?.ownerPath?.length) {
            return [];
        }
        return executionContext.ownerPath.map(segment => ({ ...segment }));
    }

    private buildExecutionOwnerContext(rootId: string, executionId: string): IEventContext {
        if (!rootId || rootId.length === 0) {
            throw new Error('[EXECUTION] Missing rootId for execution owner context');
        }
        if (!executionId || executionId.length === 0) {
            throw new Error('[EXECUTION] Missing executionId for execution owner context');
        }
        const basePath = this.agentOwnerPathBase.length ? this.agentOwnerPathBase : this.ownerPathBase;
        const path: IOwnerPathSegment[] = [...basePath];
        if (rootId && !path.some(segment => segment.type === 'agent' && segment.id === rootId)) {
            path.push({ type: 'agent', id: rootId });
        }
        path.push({ type: 'execution', id: executionId });
        return {
            ownerType: EXECUTION_EVENT_PREFIX,
            ownerId: executionId,
            ownerPath: path
        };
    }

    private buildThinkingOwnerContext(
        rootId: string,
        executionId: string,
        thinkingNodeId: string,
        previousThinkingNodeId?: string
    ): IEventContext {
        if (!thinkingNodeId || thinkingNodeId.length === 0) {
            throw new Error('[EXECUTION] Missing thinkingNodeId for thinking owner context');
        }
        const base = this.buildExecutionOwnerContext(rootId, executionId).ownerPath;
        const path: IOwnerPathSegment[] = [...base];
        if (previousThinkingNodeId) {
            path.push({ type: 'thinking', id: previousThinkingNodeId });
            path.push({ type: 'tool_result', id: `tool_result_${previousThinkingNodeId}` });
        }
        path.push({ type: 'thinking', id: thinkingNodeId });
        return {
            ownerType: EXECUTION_EVENT_PREFIX,
            ownerId: executionId,
            ownerPath: path
        };
    }

    private buildToolOwnerContext(rootId: string, executionId: string, toolCallId: string): IEventContext {
        // Tool calls are always children of a specific thinking phase (fork point).
        // The caller must provide an ownerPathBase that already includes `{ type: 'thinking', id }`.
        if (!toolCallId || toolCallId.length === 0) {
            throw new Error('[EXECUTION] Missing toolCallId for tool owner context');
        }
        const base = this.buildExecutionOwnerContext(rootId, executionId).ownerPath;
        const path = [...base, { type: 'tool', id: toolCallId }];
        return {
            ownerType: TOOL_EVENT_PREFIX,
            ownerId: toolCallId,
            ownerPath: path
        };
    }

    private buildResponseOwnerContext(
        rootId: string,
        executionId: string,
        thinkingNodeId: string,
        previousThinkingNodeId?: string
    ): IEventContext {
        const thinkingPath = this.buildThinkingOwnerContext(rootId, executionId, thinkingNodeId, previousThinkingNodeId).ownerPath;
        const responseNodeId = `response_${thinkingNodeId}`;
        const path: IOwnerPathSegment[] = [...thinkingPath, { type: 'response', id: responseNodeId }];
        return {
            ownerType: EXECUTION_EVENT_PREFIX,
            ownerId: executionId,
            ownerPath: path
        };
    }

    private emitExecution(eventType: string, data: Omit<IExecutionEventData, 'timestamp'>, rootId: string, executionId: string): void {
        this.emitWithContext(
            eventType,
            data,
            () => this.buildExecutionOwnerContext(rootId, executionId),
            context => {
                if (!context.ownerType || !context.ownerId) {
                    throw new Error('[EXECUTION] Missing owner context for execution event');
                }
                return bindWithOwnerPath(this.baseEventService, {
                    ownerType: context.ownerType,
                    ownerId: context.ownerId,
                    ownerPath: context.ownerPath
                });
            }
        );
    }

    private emitTool(eventType: string, data: Omit<IToolEventData, 'timestamp'>, rootId: string, executionId: string, toolCallId: string): void {
        this.emitWithContext(
            eventType,
            data,
            () => this.buildToolOwnerContext(rootId, executionId, toolCallId),
            context => this.ensureToolEventService(context.ownerId, context.ownerPath)
        );
    }

    private emitWithContext<TEvent extends IBaseEventData>(
        eventType: string,
        data: Omit<TEvent, 'timestamp'>,
        buildContext: () => IEventContext,
        resolveService: (context: IEventContext) => IEventService
    ): void {
        if (isDefaultEventService(this.baseEventService)) {
            return;
        }
        const context = buildContext();
        const service = resolveService(context);
        const payload: TEvent = {
            timestamp: new Date(),
            ...(data as Omit<TEvent, 'timestamp'>),
        } as TEvent;
        service.emit(eventType, payload, context);
    }

    private requireConversationId(context: { conversationId?: string } | undefined, label: string): string {
        if (!context?.conversationId || context.conversationId.length === 0) {
            throw new Error(`[EXECUTION] conversationId is required for ${label}`);
        }
        return context.conversationId;
    }

    /**
     * Convert IExecutionContext to IPluginContext compatible format
     */
    private convertExecutionContextToPluginFormat(context: IExecutionContext): Record<string, string | number | boolean> {
        const conversationId = this.requireConversationId(context, 'plugin-context');
        const payload: Record<string, string | number | boolean> = {
            conversationId: conversationId,
            executionId: context.executionId,
            startTime: context.startTime.toISOString(),
            messageCount: context.messages.length
        };
        if (context.sessionId) {
            payload.sessionId = context.sessionId;
        }
        if (context.userId) {
            payload.userId = context.userId;
        }
        return payload;
    }

}
