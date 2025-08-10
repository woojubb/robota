import { Message, AgentConfig, AssistantMessage, ToolMessage } from '../interfaces/agent';
import { PluginContext, Metadata } from '../interfaces/types';
import { BasePlugin } from '../abstracts/base-plugin';
import { ToolExecutionService } from './tool-execution-service';
import type { AIProviderManagerInterface } from '../interfaces/manager';
import type { ToolManagerInterface } from '../interfaces/manager';
import { ConversationHistory } from '../managers/conversation-history-manager';
import { ToolExecutionContext } from '../interfaces/tool'; // 🎯 [CONTEXT-INJECTION] Import ToolExecutionContext
import { BaseAIProvider } from '../abstracts/base-ai-provider';
import { Logger, createLogger } from '../utils/logger';
import { ChatOptions, ToolCall } from '../interfaces/provider';
import { EventService, SilentEventService } from './event-service';
import type { ToolExecutionBatchContext } from './tool-execution-service';

/**
 * 🎯 [EVENT-CONSTANTS] ExecutionService owned events
 * All events emitted by ExecutionService must use these constants
 */
// 🎯 [EVENT-PREFIX-UNIFICATION] ExecutionService 소유 이벤트 - 모든 이벤트에 execution. 접두어 통일
export const EXECUTION_EVENTS = {
    START: 'execution.start',
    COMPLETE: 'execution.complete',
    ERROR: 'execution.error',
    ASSISTANT_MESSAGE_START: 'execution.assistant_message_start',
    ASSISTANT_MESSAGE_COMPLETE: 'execution.assistant_message_complete',
    USER_MESSAGE: 'execution.user_message',
    TOOL_RESULTS_TO_LLM: 'execution.tool_results_to_llm'
} as const;

/**
 * 🎯 [EVENT-CONSTANTS] Tool events - Separate ownership
 * Tools are responsible for their own lifecycle events
 */
export const TOOL_EVENTS = {
    CALL_START: 'tool.call_start',
    CALL_COMPLETE: 'tool.call_complete',
    CALL_ERROR: 'tool.call_error'
} as const;

// Step 1: ❌ Can't use Error.executionId (not in Error interface)
// Step 2: ❌ Can't extend Error interface (TypeScript limitation)  
// Step 3: ✅ Define custom interface for execution errors
interface ExecutionError extends Error {
    executionId?: string;
    toolName?: string;
    error?: Error;
}

// Type guard to check if error has execution properties
function isExecutionError(error: Error): error is ExecutionError {
    return 'executionId' in error || 'toolName' in error;
}

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
    private aiProviders: AIProviderManagerInterface;
    private tools: ToolManagerInterface;
    private conversationHistory: ConversationHistory;
    private plugins: BasePlugin[] = [];
    private logger: Logger;
    private eventService: EventService;
    private executionContext?: ToolExecutionContext; // 🎯 [CONTEXT-INJECTION] Parent execution context

    constructor(
        aiProviders: AIProviderManagerInterface,
        tools: ToolManagerInterface,
        conversationHistory: ConversationHistory,
        eventService?: EventService,
        executionContext?: ToolExecutionContext // 🎯 [CONTEXT-INJECTION] Accept parent context
    ) {
        this.toolExecutionService = new ToolExecutionService(tools as any);
        this.aiProviders = aiProviders;
        this.tools = tools;
        this.conversationHistory = conversationHistory;
        this.plugins = [];
        this.logger = createLogger('ExecutionService');
        this.eventService = eventService || new SilentEventService();
        this.executionContext = executionContext; // 🎯 [CONTEXT-INJECTION] Store parent context
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
        // 🎯 [EXECUTION-DEBUG] ExecutionService.execute 호출 확인
        console.log(`🚀 [EXECUTION-DEBUG] ExecutionService.execute started for agent: ${context?.conversationId}`);
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

        // Get current provider info and tools for rich data
        const currentInfo = this.aiProviders.getCurrentProvider();
        const provider = currentInfo ? this.aiProviders.getProvider(currentInfo.provider) : null;
        const availableTools = this.tools.getTools();

        // Emit execution start event
        console.log(`📢 [EXECUTION-START-EMIT] About to emit execution.start for agent: ${fullContext.conversationId || executionId}`);
        if (this.eventService && !(this.eventService instanceof SilentEventService)) {
            const rootId = fullContext.conversationId || executionId;
            console.log(`📢 [EXECUTION-START-EMIT] Emitting execution.start for agent: ${rootId}`);

            // 🎯 [RICH-DATA] Collect AI provider and tool information
            const aiProviderInfo = provider ? {
                providerName: currentInfo?.provider || 'unknown',
                model: (provider as any).model || (provider as any).modelName || 'unknown',
                temperature: (provider as any).temperature || undefined,
                maxTokens: (provider as any).maxTokens || undefined,
                apiEndpoint: (provider as any).apiEndpoint || undefined
            } : null;

            const toolsInfo = availableTools.map((tool: any) => ({
                name: tool.name,
                description: tool.description || 'No description',
                parameters: tool.parameters ? Object.keys(tool.parameters.properties || {}) : []
            }));

            this.eventService.emit(EXECUTION_EVENTS.START, {
                sourceType: 'agent',
                sourceId: rootId,
                timestamp: startTime,
                executionId: executionId,
                parameters: {
                    input,
                    // 🎯 [RICH-DATA] Enhanced agent data
                    agentConfiguration: aiProviderInfo,
                    availableTools: toolsInfo as any,
                    toolCount: toolsInfo.length,
                    hasTools: toolsInfo.length > 0
                },
                // Hierarchical tracking information
                rootExecutionId: rootId,
                parentExecutionId: this.executionContext?.parentExecutionId,
                executionLevel: 1, // Agent level execution
                executionPath: [rootId],
                metadata: {
                    executionId,
                    method: 'execute',
                    inputLength: input.length,
                    conversationId: fullContext.conversationId,
                    messageCount: messages.length,
                    // 🎯 [RICH-DATA] Additional agent metadata
                    aiProvider: aiProviderInfo?.providerName || 'unknown',
                    model: aiProviderInfo?.model || 'unknown',
                    toolsAvailable: toolsInfo.map((t: any) => t.name),
                    agentCapabilities: {
                        canUseTools: toolsInfo.length > 0,
                        supportedActions: toolsInfo.map((t: any) => t.name)
                    }
                }
            });
        }

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

                // Emit user message event as the starting point
                if (this.eventService && !(this.eventService instanceof SilentEventService)) {
                    const rootId = fullContext.conversationId || executionId;

                    // 🎯 [RICH-DATA] Enhanced user message event with detailed content
                    const timestamp = new Date();
                    this.eventService.emit(EXECUTION_EVENTS.USER_MESSAGE, {
                        sourceType: 'agent',
                        sourceId: rootId,
                        timestamp: timestamp,
                        parameters: {
                            input,
                            // 🎯 Rich data for user message node
                            userPrompt: input,
                            userMessageContent: input,
                            messageLength: input.length,
                            wordCount: input.split(/\s+/).filter(word => word.length > 0).length,
                            characterCount: input.length,
                            messageTimestamp: timestamp.toISOString()
                        },
                        // Hierarchical tracking information
                        rootExecutionId: rootId,
                        parentExecutionId: this.executionContext?.parentExecutionId,
                        executionLevel: 0, // User message is Level 0
                        executionPath: [rootId],
                        metadata: {
                            executionId,
                            messageRole: 'user',
                            inputLength: input.length,
                            conversationId: fullContext.conversationId,
                            // 🎯 Additional rich metadata
                            messageType: 'user_input',
                            hasQuestions: input.includes('?'),
                            containsUrgency: /urgent|urgent|급함|긴급|asap/i.test(input),
                            estimatedComplexity: input.length > 200 ? 'high' : input.length > 50 ? 'medium' : 'low'
                        }
                    });
                }
            }

            // Call beforeRun hook on all plugins
            await this.callPluginHook('beforeRun', {
                input,
                metadata: (context?.metadata || {}) as Metadata
            });

            // Use already retrieved provider info from rich data collection above
            if (!currentInfo) {
                throw new Error('No AI provider configured');
            }
            if (!provider) {
                throw new Error(`AI provider '${currentInfo.provider}' not found`);
            }

            // Ensure provider has chat method (duck typing check)
            if (typeof (provider as any).chat !== 'function') {
                throw new Error('Provider must have chat method to support execution');
            }

            // Process with conversation loop - now delegated to provider
            let toolsExecuted: string[] = [];
            let maxRounds = 10; // Increased limit for complex team delegation scenarios
            let currentRound = 0;

            while (currentRound < maxRounds) {
                currentRound++;

                // 🎯 [ROUND-DEBUG] Round 시작 명확히 로깅
                this.logger.info(`🔄 [ROUND-DEBUG] Starting Round ${currentRound} for agent ${fullContext.conversationId}`);
                this.logger.debug(`🔄 [ROUND-${currentRound}] Starting execution round ${currentRound}`, {
                    executionId,
                    conversationId: fullContext.conversationId,
                    round: currentRound,
                    maxRounds: maxRounds
                });

                // 🎯 라운드 시작 시점에 해당 라운드의 thinking ID를 생성
                const rootId = fullContext.conversationId || executionId;
                const conversationId = String(rootId).replace('conv_', '').substring(0, 16);
                const thinkingNodeId = `thinking_agent_0_copy_1_${conversationId}_round${currentRound}`;

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
                    throw new Error('Model is required in defaultModel configuration. Please specify a model.');
                }

                if (typeof config.defaultModel.model !== 'string' || config.defaultModel.model.trim() === '') {
                    throw new Error('Model must be a non-empty string in defaultModel configuration.');
                }

                // Delegate entire execution to provider
                const availableTools = this.tools.getTools();

                // 🔍 [TOOL-FLOW] ExecutionService.execute() - Tool schemas from ToolManager
                console.log('🔍 [TOOL-FLOW] ExecutionService.execute() - Retrieved tool schemas:', {
                    count: availableTools.length,
                    schemas: availableTools.map(s => ({
                        name: s.name,
                        description: s.description,
                        hasParameters: !!s.parameters,
                        parameterKeys: s.parameters?.properties ? Object.keys(s.parameters.properties) : []
                    }))
                });

                const chatOptions: ChatOptions = {
                    model: config.defaultModel.model,
                    ...(config.defaultModel.maxTokens !== undefined && { maxTokens: config.defaultModel.maxTokens }),
                    ...(config.defaultModel.temperature !== undefined && { temperature: config.defaultModel.temperature }),
                    ...(availableTools.length > 0 && { tools: availableTools })
                };

                // 🔍 [TOOL-FLOW] ExecutionService.execute() - Final chatOptions with tools
                console.log('🔍 [TOOL-FLOW] ExecutionService.execute() - ChatOptions prepared for provider:', {
                    model: chatOptions.model,
                    hasTools: !!chatOptions.tools,
                    toolsCount: chatOptions.tools?.length || 0,
                    toolNames: chatOptions.tools?.map((t: any) => t.name) || []
                });

                // Emit assistant message start event for each thinking phase
                console.log(`🔄 [ROUND-DEBUG] Agent ${rootId} Round ${currentRound} - About to emit assistant_message_start`);
                if (this.eventService && !(this.eventService instanceof SilentEventService)) {
                    this.eventService.emit(EXECUTION_EVENTS.ASSISTANT_MESSAGE_START, {
                        sourceType: 'agent',
                        sourceId: rootId,
                        timestamp: new Date(),
                        parameters: {
                            round: currentRound,
                            messageCount: conversationMessages.length
                        },
                        // Hierarchical tracking information
                        rootExecutionId: rootId,
                        parentExecutionId: executionId, // Parent is execution node
                        executionLevel: 1, // Assistant message is Level 1
                        executionPath: [rootId],
                        metadata: {
                            executionId,
                            round: currentRound,
                            conversationId: fullContext.conversationId,
                            // Use consistent reserved thinking node ID (Ghost Connection eliminated)
                            thinkingNodeId: thinkingNodeId
                        }
                    });
                }

                const response = await (provider as any).chat(conversationMessages, chatOptions);

                this.logger.debug(`🤖 [ROUND-${currentRound}] Provider response completed`, {
                    executionId,
                    conversationId: fullContext.conversationId,
                    round: currentRound,
                    responseLength: response.content?.length || 0,
                    hasToolCalls: !!(response as any).toolCalls && (response as any).toolCalls.length > 0,
                    toolCallsCount: (response as any).toolCalls?.length || 0
                });

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
                this.logger.debug(`[MAIN-AGENT-DEBUG] Round ${currentRound} for sourceId: ${fullContext.conversationId}`, {
                    round: currentRound,
                    conversationId: fullContext.conversationId,
                    toolCallsFound: assistantResponse.toolCalls?.length || 0,
                    responseLength: assistantResponse.content?.length || 0,
                    isMainAgent: !fullContext.conversationId?.includes('copy')
                });

                this.logger.debug(`[RULE-9-DEBUG] Round ${currentRound} response check: toolCalls=${assistantResponse.toolCalls?.length || 0}`, {
                    round: currentRound,
                    hasToolCalls: !!assistantResponse.toolCalls,
                    toolCallsLength: assistantResponse.toolCalls?.length || 0,
                    responseContent: assistantResponse.content?.substring(0, 100) + '...'
                });

                // 🎯 [ROUND2-DEBUG] Round 2에서 AI 응답 상세 분석
                if (currentRound === 2) {
                    this.logger.info(`🔍 [ROUND2-DEBUG] Round 2 AI Response for agent ${fullContext.conversationId}:`);
                    this.logger.info(`🔍 [ROUND2-DEBUG] - Content: ${assistantResponse.content?.substring(0, 200)}...`);
                    this.logger.info(`🔍 [ROUND2-DEBUG] - Tool Calls: ${assistantResponse.toolCalls?.length || 0}`);
                    if (assistantResponse.toolCalls && assistantResponse.toolCalls.length > 0) {
                        this.logger.info(`🔍 [ROUND2-DEBUG] - Tool Call Details: ${JSON.stringify(assistantResponse.toolCalls.map(tc => ({ id: tc.id, name: tc.function?.name })))}`);
                    }
                }

                if (!assistantResponse.toolCalls || assistantResponse.toolCalls.length === 0) {
                    // No tools to execute, we're done
                    this.logger.info(`🔄 [ROUND-DEBUG] Round ${currentRound} ENDING - no tool calls for agent ${fullContext.conversationId}`);
                    this.logger.debug(`[AGENT-FLOW-CONTROL] Round ${currentRound} completed - no tool calls, execution finished for agent ${fullContext.conversationId}`);

                    // 🎯 [VERIFICATION] ExecutionService 흐름 제어 로직 검증
                    this.logger.info(`🔍 [EXECUTION-VERIFICATION] Agent ${fullContext.conversationId} - Round ${currentRound} - No tool calls detected`);
                    this.logger.info(`🔍 [EXECUTION-VERIFICATION] ExecutionContext exists: ${!!this.executionContext}`);
                    if (this.executionContext) {
                        this.logger.info(`🔍 [EXECUTION-VERIFICATION] Parent ID: ${this.executionContext.parentExecutionId || 'none'}`);
                        this.logger.info(`🔍 [EXECUTION-VERIFICATION] Execution Level: ${this.executionContext.executionLevel || 'none'}`);
                    }

                    // 🎯 [CONTEXT-AWARE-CONTROL] Parent context를 고려한 실행 제어
                    const isSubAgent = this.executionContext && this.executionContext.parentExecutionId;
                    if (isSubAgent) {
                        this.logger.info(`🎯 [AGENT-FLOW-CONTROL] Agent ${fullContext.conversationId} is a child agent (parent: ${this.executionContext?.parentExecutionId}) - ending at Round ${currentRound} without tool calls`);
                    } else {
                        this.logger.info(`🎯 [AGENT-FLOW-CONTROL] Agent ${fullContext.conversationId} is a root agent - ending at Round ${currentRound} without tool calls`);
                    }

                    // 🎯 [EVENT-ORTHODOXY] 이벤트는 정석으로 발생 - 조건부 억제 없음
                    // ExecutionService는 assistant response 완료 시 무조건 이벤트 발생
                    // 핸들러에서 context를 보고 처리 여부 결정
                    if (this.eventService && !(this.eventService instanceof SilentEventService)) {
                        this.logger.info(`🔧 [EVENT-ORTHODOXY] Emitting assistant_message_complete for Round ${currentRound} completion (no tool calls)`);

                        // 🎯 [RICH-DATA] Collect detailed response information
                        const responseContent = assistantResponse.content || 'No response';
                        const responseStartTime = assistantResponse.timestamp || new Date();
                        const responseDuration = new Date().getTime() - responseStartTime.getTime();

                        this.eventService.emit(EXECUTION_EVENTS.ASSISTANT_MESSAGE_COMPLETE, {
                            sourceType: 'agent',
                            sourceId: fullContext.conversationId || executionId,
                            timestamp: new Date(),
                            parameters: {
                                // 🎯 [RICH-DATA] Enhanced response data
                                assistantMessage: responseContent,
                                responseLength: responseContent.length,
                                wordCount: responseContent.split(/\s+/).filter(word => word.length > 0).length,
                                responseTime: responseDuration,
                                contentPreview: responseContent.length > 200
                                    ? responseContent.substring(0, 200) + '...'
                                    : responseContent
                            },
                            result: {
                                success: true,
                                data: responseContent.substring(0, 100) + '...' || 'Round completed',
                                // 🎯 [RICH-DATA] Additional result data
                                fullResponse: responseContent,
                                responseMetrics: {
                                    length: responseContent.length,
                                    estimatedReadTime: Math.ceil(responseContent.split(/\s+/).length / 200), // words per minute
                                    hasCodeBlocks: /```/.test(responseContent),
                                    hasLinks: /https?:\/\//.test(responseContent),
                                    complexity: responseContent.length > 1000 ? 'high' : responseContent.length > 300 ? 'medium' : 'low'
                                }
                            },
                            // Hierarchical tracking information
                            rootExecutionId: fullContext.conversationId || executionId,
                            parentExecutionId: executionId, // Parent is execution node for this round
                            executionLevel: 1, // Assistant message completion is Level 1
                            executionPath: [fullContext.conversationId || executionId],
                            metadata: {
                                executionId,
                                round: currentRound,
                                completed: true,
                                reason: 'no_tool_calls',
                                // 🎯 [RICH-DATA] Additional metadata
                                responseCharacteristics: {
                                    hasQuestions: responseContent.includes('?'),
                                    isError: /error|fail|wrong/i.test(responseContent),
                                    isComplete: /complete|done|finish/i.test(responseContent),
                                    containsNumbers: /\d/.test(responseContent)
                                }
                            }
                        });
                    }

                    this.logger.info(`🔍 [EXECUTION-VERIFICATION] Breaking execution loop - should prevent Round ${currentRound + 1}`);
                    break;
                } else {
                    // Emit assistant_message_complete for this assistant turn that triggered tool calls
                    if (this.eventService && !(this.eventService instanceof SilentEventService)) {
                        const rootId = fullContext.conversationId || executionId;
                        const responseContent = assistantResponse.content || '';
                        this.eventService.emit(EXECUTION_EVENTS.ASSISTANT_MESSAGE_COMPLETE, {
                            sourceType: 'agent',
                            sourceId: rootId,
                            timestamp: new Date(),
                            parameters: {
                                assistantMessage: responseContent,
                                responseLength: responseContent.length
                            },
                            result: {
                                success: true,
                                data: responseContent.substring(0, 100) + '...'
                            },
                            rootExecutionId: rootId,
                            parentExecutionId: executionId,
                            executionLevel: 1,
                            executionPath: [rootId],
                            metadata: {
                                executionId,
                                round: currentRound,
                                completed: true,
                                reason: 'tool_calls_triggered'
                            }
                        });
                    }
                }

                // 🎯 [ROUND-DEBUG] Round 계속 - tool calls 있음
                this.logger.info(`🔄 [ROUND-DEBUG] Round ${currentRound} CONTINUING - ${assistantResponse.toolCalls.length} tool calls for agent ${fullContext.conversationId}`);
                this.logger.info(`🔄 [ROUND-DEBUG] Main Agent check: isMainAgent=${!fullContext.conversationId?.includes('copy')}, conversationId=${fullContext.conversationId}`);
                this.logger.debug('Tool calls detected, executing tools', {
                    toolCallCount: assistantResponse.toolCalls.length,
                    round: currentRound,
                    toolCalls: assistantResponse.toolCalls.map((tc: ToolCall) => ({ id: tc.id, name: tc.function?.name }))
                });

                // Execute tools
                // Ensure proper ID hierarchy for tool execution
                const toolRootId = fullContext.conversationId;
                const toolParentId = executionId;

                const toolRequests = this.toolExecutionService.createExecutionRequestsWithContext(
                    assistantResponse.toolCalls,
                    {
                        parentExecutionId: thinkingNodeId, // 🎯 Use thinkingNodeId as parentExecutionId
                        rootExecutionId: toolRootId || executionId,
                        executionLevel: 2, // Tool level (Team=0, Agent=1, Tool=2)
                        executionPath: [toolRootId || executionId, toolParentId],
                        conversationId: toolRootId // Pass conversationId explicitly
                    }
                );
                const toolContext: ToolExecutionBatchContext = {
                    requests: toolRequests,
                    mode: 'parallel',
                    maxConcurrency: 5,
                    continueOnError: true
                };

                // Emit tool_call_start events for each tool with direct parent provision
                if (this.eventService && !(this.eventService instanceof SilentEventService)) {
                    // 🎯 ActionTrackingEventService에 hierarchy 등록
                    if ('trackExecution' in this.eventService) {
                        (this.eventService as any).trackExecution(thinkingNodeId, fullContext.conversationId || executionId, 1);
                    }

                    // 🎯 Batch metadata for aggregation-after-all-tools
                    const expectedCountForBatch = assistantResponse.toolCalls.length;
                    const batchId = `${thinkingNodeId}`;

                    for (const toolCall of assistantResponse.toolCalls) {
                        // 🎯 각 tool call을 hierarchy에 등록
                        if ('trackExecution' in this.eventService) {
                            (this.eventService as any).trackExecution(toolCall.id, thinkingNodeId, 2);
                        }

                        this.eventService.emit(TOOL_EVENTS.CALL_START, {
                            sourceType: 'agent',
                            sourceId: fullContext.conversationId || executionId,
                            executionId: toolCall.id, // 🎯 tool call ID를 executionId로 설정
                            toolName: toolCall.function?.name,
                            timestamp: new Date(),
                            parameters: JSON.parse(toolCall.function?.arguments || '{}'),
                            rootExecutionId: fullContext.conversationId || executionId,
                            executionLevel: 2, // Tool level
                            executionPath: [fullContext.conversationId || executionId, executionId],
                            // Parent is the execution node (round owner)
                            parentExecutionId: executionId,
                            metadata: {
                                toolCallId: toolCall.id,
                                executionId: executionId,
                                round: currentRound,
                                // Direct thinking node reference for immediate connection
                                directParentId: thinkingNodeId,
                                // 🎯 Batch aggregation metadata
                                batchId,
                                expectedCount: expectedCountForBatch
                            }
                        });
                    }
                }

                const toolSummary = await this.toolExecutionService.executeTools(toolContext);

                // 🎯 [EVENT-ORDER-FIX] tool.call_complete는 이제 "도구 호출만 완료된 상태"를 의미
                // tool_call_response 노드는 실제 도구 결과가 준비된 시점에서 생성
                if (this.eventService && !(this.eventService instanceof SilentEventService)) {
                    for (const result of toolSummary.results) {
                        // 🔧 [PHASE-1] 도구 호출 완료 이벤트 - 아직 결과 노드 생성하지 않음
                        this.eventService.emit(TOOL_EVENTS.CALL_COMPLETE, {
                            sourceType: 'agent',
                            sourceId: fullContext.conversationId || executionId,
                            toolName: result.toolName,
                            timestamp: new Date(),
                            result: {
                                success: result.success,
                                data: result.success ? result.result : undefined,
                                error: result.success ? undefined : (result.error ?? 'Unknown error')
                            },
                            rootExecutionId: fullContext.conversationId || executionId,
                            executionLevel: 2, // Tool level
                            executionPath: [fullContext.conversationId || executionId, executionId],
                            metadata: {
                                executionId: result.executionId,
                                success: result.success,
                                round: currentRound,
                                phase: 'tool_call_only' // 🎯 도구 호출만 완료, 결과 노드는 아직 미생성
                            }
                        });
                    }
                }

                toolsExecuted.push(...toolSummary.results.map(r => r.toolName || 'unknown'));

                // Add tool results to history in the order they were called
                // This ensures proper conversation flow and prevents any duplicate entries
                for (const toolCall of assistantResponse.toolCalls) {
                    if (!toolCall.id) {
                        throw new Error(`Tool call missing ID: ${JSON.stringify(toolCall)}`);
                    }

                    // Find the corresponding result for this tool call
                    const result = toolSummary.results.find(r => r.executionId === toolCall.id);
                    const error = toolSummary.errors.find(e => isExecutionError(e) && e.executionId === toolCall.id);

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
                        const execError = error as ExecutionError;
                        content = `Error: ${execError.error?.message || execError.message || 'Unknown error'}`;
                        metadata['success'] = false;
                        metadata['error'] = execError.error?.message || execError.message || 'Unknown error';
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

                // Emit tool results to LLM event
                if (this.eventService && !(this.eventService instanceof SilentEventService)) {
                    const rootId = fullContext.conversationId || executionId;
                    this.eventService.emit(EXECUTION_EVENTS.TOOL_RESULTS_TO_LLM, {
                        sourceType: 'agent',
                        sourceId: rootId,
                        timestamp: new Date(),
                        parameters: {
                            toolsExecuted: toolsExecuted.length,
                            round: currentRound
                        },
                        // Hierarchical tracking information
                        rootExecutionId: rootId,
                        executionLevel: 1, // Tool results presentation is Level 1
                        executionPath: [rootId],
                        metadata: {
                            executionId,
                            toolsExecuted: toolSummary.results.map(r => r.toolName || 'unknown'),
                            round: currentRound,
                            conversationId: fullContext.conversationId
                        }
                    });
                }

                // Continue to next round - let the AI decide if more tools are needed
                // The AI will see the tool results and can either:
                // 1. Call more tools if needed
                // 2. Provide a final response without tool calls
                this.logger.info(`🔄 [ROUND-DEBUG] Round ${currentRound} COMPLETED - continuing to Round ${currentRound + 1} for agent ${fullContext.conversationId}`);
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

            // Emit assistant message complete event
            const rootId = fullContext.conversationId || executionId;
            this.logger.debug(`[MAIN-AGENT-DEBUG] Ensuring execution.assistant_message_complete for: ${rootId}`, {
                rounds: currentRound,
                responseLength: result.response.length,
                isMainAgent: !rootId?.includes('copy'),
                eventServiceAvailable: !!(this.eventService && !(this.eventService instanceof SilentEventService))
            });

            this.logger.debug(`[RULE-9-DEBUG] Emitting execution.assistant_message_complete event for sourceId: ${rootId}`, {
                rounds: currentRound,
                responseLength: result.response.length,
                eventServiceType: this.eventService?.constructor.name
            });

            // 🎯 [DUPLICATE-EMIT-FIX] Remove duplicate assistant_message_complete emission
            // The round-specific emit (Line 519) already handles assistant completion
            // This global completion emit was causing duplicate response nodes
            this.logger.info(`🔧 [DUPLICATE-EMIT-FIX] Skipping duplicate assistant_message_complete emission - already emitted per round`);

            // Emit execution complete event
            if (this.eventService && !(this.eventService instanceof SilentEventService)) {
                const rootId = fullContext.conversationId || executionId;
                this.eventService.emit(EXECUTION_EVENTS.COMPLETE, {
                    sourceType: 'agent',
                    sourceId: rootId,
                    timestamp: new Date(),
                    result: {
                        success: true,
                        data: result.response.substring(0, 100) + '...'
                    },
                    // Hierarchical tracking information
                    rootExecutionId: rootId,
                    executionLevel: 1, // Agent level execution
                    executionPath: [rootId],
                    metadata: {
                        executionId,
                        method: 'execute',
                        success: true,
                        duration,
                        tokensUsed: result.tokensUsed,
                        toolsExecuted: result.toolsExecuted,
                        conversationId: fullContext.conversationId
                    }
                });
            }

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

            // Emit execution error event
            if (this.eventService && !(this.eventService instanceof SilentEventService)) {
                const rootId = fullContext.conversationId || executionId;
                this.eventService.emit(EXECUTION_EVENTS.ERROR, {
                    sourceType: 'agent',
                    sourceId: rootId,
                    timestamp: new Date(),
                    error: error instanceof Error ? error.message : String(error),
                    // Hierarchical tracking information
                    rootExecutionId: rootId,
                    executionLevel: 1, // Agent level execution
                    executionPath: [rootId],
                    metadata: {
                        executionId,
                        method: 'execute',
                        success: false,
                        duration,
                        conversationId: fullContext.conversationId
                    }
                });
            }

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
        this.logger.debug('ExecutionService.executeStream called');

        const executionId = this.generateExecutionId();
        const startTime = Date.now();

        try {
            // Create conversation session for this execution
            const conversationSession = this.conversationHistory.getConversationSession(context?.conversationId || 'default');

            // Add user input to conversation
            if (input) {
                conversationSession.addUserMessage(input, { executionId });
            }

            // Call beforeRun hook on all plugins
            await this.callPluginHook('beforeRun', {
                input,
                metadata: (context?.metadata || {}) as Metadata
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

            // Ensure provider has chatStream method (duck typing check)
            if (typeof (provider as any).chatStream !== 'function') {
                throw new Error('Provider must have chatStream method to support streaming execution');
            }

            this.logger.debug('ExecutionService calling provider.chatStream');

            // Get conversation messages for provider
            const conversationMessages = conversationSession.getMessages();

            // Create chat options
            this.logger.debug('🔍 [EXECUTION-SERVICE] config.tools:', { length: config.tools?.length || 0 });
            const toolSchemas = this.tools.getTools();
            this.logger.debug('🔍 [EXECUTION-SERVICE] this.tools.getTools():', { length: toolSchemas?.length || 0 });
            this.logger.debug('🔍 [EXECUTION-SERVICE] config.tools exists:', { exists: !!config.tools });
            this.logger.debug('🔍 [EXECUTION-SERVICE] config.tools.length > 0:', { hasTools: config.tools && config.tools.length > 0 });

            // 🔍 [TOOL-FLOW] ExecutionService.executeStream() - Tool schemas from ToolManager
            console.log('🔍 [TOOL-FLOW] ExecutionService.executeStream() - Retrieved tool schemas:', {
                count: toolSchemas.length,
                schemas: toolSchemas.map(s => ({
                    name: s.name,
                    description: s.description,
                    hasParameters: !!s.parameters,
                    parameterKeys: s.parameters?.properties ? Object.keys(s.parameters.properties) : []
                }))
            });

            const chatOptions: ChatOptions = {
                model: config.defaultModel.model,
                ...(config.tools && config.tools.length > 0 && { tools: this.tools.getTools() })
            };

            // 🔍 [TOOL-FLOW] ExecutionService.executeStream() - Final chatOptions with tools
            console.log('🔍 [TOOL-FLOW] ExecutionService.executeStream() - ChatOptions prepared for provider:', {
                model: chatOptions.model,
                hasTools: !!chatOptions.tools,
                toolsCount: chatOptions.tools?.length || 0,
                toolNames: chatOptions.tools?.map((t: any) => t.name) || []
            });

            this.logger.debug('🔍 [EXECUTION-SERVICE] Final chatOptions has tools:', { hasTools: !!chatOptions.tools });
            this.logger.debug('🔍 [EXECUTION-SERVICE] Final chatOptions.tools length:', { length: chatOptions.tools?.length || 0 });

            // Use provider's streaming capability
            if (!(provider as any).chatStream) {
                throw new Error('Provider does not support streaming');
            }

            const stream = (provider as any).chatStream(conversationMessages, chatOptions);
            let fullResponse = '';
            let toolCalls: ToolCall[] = [];
            let currentToolCallIndex = -1; // 현재 작업중인 도구 호출 인덱스

            // Collect streaming chunks and tool calls
            for await (const chunk of stream) {
                console.log('🔍 [EXECUTION-SERVICE-CHUNK]', JSON.stringify(chunk));
                if (chunk.content) {
                    fullResponse += chunk.content;
                    yield { chunk: chunk.content, isComplete: false };
                }

                // Collect tool calls from streaming chunks (type assertion for AssistantMessage)
                if (chunk.role === 'assistant') {
                    const assistantChunk = chunk as any; // Type assertion to handle toolCalls
                    if (assistantChunk.toolCalls && assistantChunk.toolCalls.length > 0) {
                        // 스트림 도구 호출 상태 관리
                        for (const chunkToolCall of assistantChunk.toolCalls) {
                            if (chunkToolCall.id && chunkToolCall.id !== '') {
                                // ✅ ID 있음 = 새 도구 호출 시작
                                currentToolCallIndex = toolCalls.length;
                                toolCalls.push({
                                    id: chunkToolCall.id,
                                    type: chunkToolCall.type || 'function',
                                    function: {
                                        name: chunkToolCall.function?.name || '',
                                        arguments: chunkToolCall.function?.arguments || ''
                                    }
                                });
                                this.logger.debug(`🆕 [TOOL-STREAM] New tool call started: ${chunkToolCall.id} (${chunkToolCall.function?.name})`);
                            } else if (currentToolCallIndex >= 0) {
                                // ✅ ID 없음 = 현재 도구 호출에 조각 추가
                                if (chunkToolCall.function?.name) {
                                    toolCalls[currentToolCallIndex].function.name += chunkToolCall.function.name;
                                }
                                if (chunkToolCall.function?.arguments) {
                                    toolCalls[currentToolCallIndex].function.arguments += chunkToolCall.function.arguments;
                                }
                                this.logger.debug(`📝 [TOOL-STREAM] Adding fragment to tool ${toolCalls[currentToolCallIndex].id}: "${chunkToolCall.function?.arguments || chunkToolCall.function?.name || ''}"`);
                            }
                        }
                    }
                }
            }

            this.logger.debug('🔥 [EXECUTION-SERVICE-STREAM] Stream completed, toolCalls detected:', { count: toolCalls.length });

            // Add assistant response to conversation (with tool calls if any)
            conversationSession.addAssistantMessage(
                fullResponse || null,
                toolCalls.length > 0 ? toolCalls : undefined,
                { executionId }
            );

            // Execute tools if detected
            if (toolCalls.length > 0) {
                this.logger.debug('🔥 [EXECUTION-SERVICE-STREAM] Executing tools:', { tools: toolCalls.map(tc => tc.function.name) });

                // Execute tools with hierarchical context
                const toolRequests = this.toolExecutionService.createExecutionRequestsWithContext(
                    toolCalls,
                    {
                        parentExecutionId: executionId,
                        rootExecutionId: context?.conversationId || executionId,
                        executionLevel: 2, // Tool level (Team=0, Agent=1, Tool=2)
                        executionPath: [context?.conversationId || executionId, executionId]
                    }
                );
                const toolContext: ToolExecutionBatchContext = {
                    requests: toolRequests,
                    mode: 'parallel',
                    maxConcurrency: 5,
                    continueOnError: true
                };

                // Generate thinking node ID for streaming mode (direct provision)
                const streamingThinkingNodeId = `thinking_agent_${Date.now()}_${executionId}`;

                // Emit tool_call_start events for each tool (streaming) with direct parent provision
                if (this.eventService && !(this.eventService instanceof SilentEventService)) {
                    for (const toolCall of toolCalls) {
                        const eventData = {
                            sourceType: 'agent' as const,
                            sourceId: context?.conversationId || executionId,
                            toolName: toolCall.function?.name,
                            timestamp: new Date(),
                            parameters: JSON.parse(toolCall.function?.arguments || '{}'),
                            rootExecutionId: context?.conversationId || executionId,
                            executionLevel: 2, // Tool level
                            executionPath: [context?.conversationId || executionId, executionId],
                            // Direct parent ID provision (no mapping/inference needed)
                            parentExecutionId: streamingThinkingNodeId,
                            metadata: {
                                toolCallId: toolCall.id,
                                executionId: executionId,
                                streamMode: true,
                                // Direct thinking node reference for immediate connection
                                directParentId: streamingThinkingNodeId
                            }
                        };
                        this.eventService.emit(TOOL_EVENTS.CALL_START, eventData);
                    }
                }

                const toolSummary = await this.toolExecutionService.executeTools(toolContext);

                // Emit tool_call_complete events for each completed tool (streaming)
                if (this.eventService && !(this.eventService instanceof SilentEventService)) {
                    for (const result of toolSummary.results) {
                        this.eventService.emit(TOOL_EVENTS.CALL_COMPLETE, {
                            sourceType: 'agent',
                            sourceId: context?.conversationId || executionId,
                            toolName: result.toolName,
                            timestamp: new Date(),
                            result: {
                                success: result.success,
                                data: result.success ? result.result : undefined,
                                error: result.success ? undefined : (result.error ?? 'Unknown error')
                            },
                            rootExecutionId: context?.conversationId || executionId,
                            executionLevel: 2, // Tool level
                            executionPath: [context?.conversationId || executionId, executionId],
                            metadata: {
                                executionId: result.executionId,
                                success: result.success,
                                streamMode: true
                            }
                        });
                    }
                }

                // Add tool results to conversation in the order they were called
                for (const toolCall of toolCalls) {
                    if (!toolCall.id) {
                        continue;
                    }

                    // Find the corresponding result for this tool call
                    const result = toolSummary.results.find(r => r.executionId === toolCall.id);
                    const error = toolSummary.errors.find(e => isExecutionError(e) && e.executionId === toolCall.id);

                    let content: string;
                    let metadata: Record<string, string | number | boolean> = { executionId };

                    if (result && result.success) {
                        // Successful tool execution
                        content = typeof result.result === 'string'
                            ? result.result
                            : JSON.stringify(result.result || 'Tool executed successfully');
                        metadata['success'] = true;
                        if (result.toolName) {
                            metadata['toolName'] = result.toolName;
                        }

                        // Yield tool result as streaming chunk
                        yield { chunk: `\n[Tool: ${toolCall.function.name} executed successfully]`, isComplete: false };
                    } else if (error) {
                        // Tool execution failed
                        const execError = error as ExecutionError;
                        content = `Error: ${execError.error?.message || execError.message || 'Unknown error'}`;
                        metadata['success'] = false;
                        metadata['error'] = execError.error?.message || execError.message || 'Unknown error';
                        if (execError.toolName) {
                            metadata['toolName'] = execError.toolName;
                        }

                        // Yield error as streaming chunk
                        yield { chunk: `\n[Tool: ${toolCall.function.name} failed: ${execError.error?.message || execError.message || 'Unknown error'}]`, isComplete: false };
                    } else {
                        // Unknown state
                        content = 'Tool execution completed with unknown result';
                        metadata['success'] = false;

                        // Yield unknown state as streaming chunk  
                        yield { chunk: `\n[Tool: ${toolCall.function.name} completed with unknown result]`, isComplete: false };
                    }

                    // Add tool result to conversation history
                    conversationSession.addToolMessageWithId(
                        content,
                        toolCall.id,
                        toolCall.function.name,
                        metadata
                    );
                }
            }

            // Call afterRun hook
            await this.callPluginHook('afterRun', {
                input,
                response: fullResponse,
                metadata: (context?.metadata || {}) as Metadata
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
                metadata: (context?.metadata || {}) as Metadata
            });

            throw error;
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
