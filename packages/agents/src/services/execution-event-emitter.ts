import type { IExecutionContextInjection } from '../interfaces/agent';
import type { ILogger } from '../utils/logger';
import {
    type IEventService,
    isDefaultEventService,
    type IEventContext,
    type IOwnerPathSegment,
    type IExecutionEventData,
    type IToolEventData,
    bindWithOwnerPath,
    type IBaseEventData
} from './event-service';
import { TOOL_EVENT_PREFIX } from './tool-execution-service';
import { EXECUTION_EVENT_PREFIX, EXECUTION_EVENTS } from './execution-constants';
import {
    countWords,
    PREVIEW_LENGTH,
    CONTENT_PREVIEW_LENGTH,
    WORDS_PER_MINUTE,
    HIGH_COMPLEXITY_THRESHOLD,
    MEDIUM_COMPLEXITY_THRESHOLD,
    HIGH_INPUT_COMPLEXITY_THRESHOLD,
    MEDIUM_INPUT_COMPLEXITY_THRESHOLD,
} from './execution-types';
import type { IAgentConfig } from '../interfaces/agent';
import type { TUniversalMessage } from '../interfaces/messages';
import type { IResolvedProviderInfo } from './execution-types';

/**
 * Encapsulates all event emission logic for ExecutionService.
 * Manages owner path construction and event service scoping.
 */
export class ExecutionEventEmitter {
    private readonly baseEventService: IEventService;
    private readonly logger: ILogger;
    private readonly ownerPathBase: IOwnerPathSegment[];
    private readonly toolEventServices: Map<string, IEventService>;
    private agentOwnerPathBase: IOwnerPathSegment[];

    constructor(
        baseEventService: IEventService,
        logger: ILogger,
        executionContext?: IExecutionContextInjection
    ) {
        this.baseEventService = baseEventService;
        this.logger = logger;
        this.ownerPathBase = this.buildBaseOwnerPath(executionContext);
        this.toolEventServices = new Map();
        this.agentOwnerPathBase = [];
    }

    /**
     * Prepare owner path bases for a conversation
     */
    prepareOwnerPathBases(conversationId: string): void {
        this.toolEventServices.clear();
        const ownerPath = [
            ...this.ownerPathBase,
            { type: 'agent', id: conversationId },
        ];
        this.agentOwnerPathBase = ownerPath;
    }

    /**
     * Reset owner path bases after execution
     */
    resetOwnerPathBases(): void {
        this.toolEventServices.clear();
        this.agentOwnerPathBase = [];
    }

    /**
     * Ensure a scoped event service exists for a tool
     */
    ensureToolEventService(
        ownerId: string | undefined,
        ownerPath: IOwnerPathSegment[] | undefined
    ): IEventService {
        if (isDefaultEventService(this.baseEventService)) {
            return this.baseEventService;
        }
        if (!ownerId) {
            throw new Error(
                '[EVENT-SERVICE] Missing ownerId for tool event context'
            );
        }
        if (!ownerPath || ownerPath.length === 0) {
            throw new Error(
                '[EVENT-SERVICE] Missing ownerPath for tool event context'
            );
        }
        if (this.toolEventServices.has(ownerId)) {
            return this.toolEventServices.get(ownerId)!;
        }
        const scoped = bindWithOwnerPath(this.baseEventService, {
            ownerType: TOOL_EVENT_PREFIX,
            ownerId,
            ownerPath: ownerPath.map((segment) => ({ ...segment })),
        });
        this.toolEventServices.set(ownerId, scoped);
        return scoped;
    }

    /**
     * Clear tool event services (e.g., between rounds)
     */
    clearToolEventServices(): void {
        this.toolEventServices.clear();
    }

    /**
     * Get the base event service
     */
    getBaseEventService(): IEventService {
        return this.baseEventService;
    }

    // --- Owner context builders ---

    buildBaseOwnerPath(
        executionContext?: IExecutionContextInjection
    ): IOwnerPathSegment[] {
        if (!executionContext?.ownerPath?.length) {
            return [];
        }
        return executionContext.ownerPath.map((segment) => ({ ...segment }));
    }

    buildExecutionOwnerContext(
        rootId: string,
        executionId: string
    ): IEventContext {
        if (!rootId || rootId.length === 0) {
            throw new Error(
                '[EXECUTION] Missing rootId for execution owner context'
            );
        }
        if (!executionId || executionId.length === 0) {
            throw new Error(
                '[EXECUTION] Missing executionId for execution owner context'
            );
        }
        const basePath = this.agentOwnerPathBase.length
            ? this.agentOwnerPathBase
            : this.ownerPathBase;
        const path: IOwnerPathSegment[] = [...basePath];
        if (
            rootId &&
            !path.some(
                (segment) =>
                    segment.type === 'agent' && segment.id === rootId
            )
        ) {
            path.push({ type: 'agent', id: rootId });
        }
        path.push({ type: 'execution', id: executionId });
        return {
            ownerType: EXECUTION_EVENT_PREFIX,
            ownerId: executionId,
            ownerPath: path,
        };
    }

    buildThinkingOwnerContext(
        rootId: string,
        executionId: string,
        thinkingNodeId: string,
        previousThinkingNodeId?: string
    ): IEventContext {
        if (!thinkingNodeId || thinkingNodeId.length === 0) {
            throw new Error(
                '[EXECUTION] Missing thinkingNodeId for thinking owner context'
            );
        }
        const base = this.buildExecutionOwnerContext(
            rootId,
            executionId
        ).ownerPath;
        const path: IOwnerPathSegment[] = [...base];
        if (previousThinkingNodeId) {
            path.push({ type: 'thinking', id: previousThinkingNodeId });
            path.push({
                type: 'tool_result',
                id: `tool_result_${previousThinkingNodeId}`,
            });
        }
        path.push({ type: 'thinking', id: thinkingNodeId });
        return {
            ownerType: EXECUTION_EVENT_PREFIX,
            ownerId: executionId,
            ownerPath: path,
        };
    }

    buildToolOwnerContext(
        rootId: string,
        executionId: string,
        toolCallId: string
    ): IEventContext {
        if (!toolCallId || toolCallId.length === 0) {
            throw new Error(
                '[EXECUTION] Missing toolCallId for tool owner context'
            );
        }
        const base = this.buildExecutionOwnerContext(
            rootId,
            executionId
        ).ownerPath;
        const path = [...base, { type: 'tool', id: toolCallId }];
        return {
            ownerType: TOOL_EVENT_PREFIX,
            ownerId: toolCallId,
            ownerPath: path,
        };
    }

    buildResponseOwnerContext(
        rootId: string,
        executionId: string,
        thinkingNodeId: string,
        previousThinkingNodeId?: string
    ): IEventContext {
        const thinkingPath = this.buildThinkingOwnerContext(
            rootId,
            executionId,
            thinkingNodeId,
            previousThinkingNodeId
        ).ownerPath;
        const responseNodeId = `response_${thinkingNodeId}`;
        const path: IOwnerPathSegment[] = [
            ...thinkingPath,
            { type: 'response', id: responseNodeId },
        ];
        return {
            ownerType: EXECUTION_EVENT_PREFIX,
            ownerId: executionId,
            ownerPath: path,
        };
    }

    // --- Emit helpers ---

    emitExecution(
        eventType: string,
        data: Omit<IExecutionEventData, 'timestamp'>,
        rootId: string,
        executionId: string
    ): void {
        this.emitWithContext(
            eventType,
            data,
            () => this.buildExecutionOwnerContext(rootId, executionId),
            (context) => {
                if (!context.ownerType || !context.ownerId) {
                    throw new Error(
                        '[EXECUTION] Missing owner context for execution event'
                    );
                }
                return bindWithOwnerPath(this.baseEventService, {
                    ownerType: context.ownerType,
                    ownerId: context.ownerId,
                    ownerPath: context.ownerPath,
                });
            }
        );
    }

    emitTool(
        eventType: string,
        data: Omit<IToolEventData, 'timestamp'>,
        rootId: string,
        executionId: string,
        toolCallId: string
    ): void {
        this.emitWithContext(
            eventType,
            data,
            () => this.buildToolOwnerContext(rootId, executionId, toolCallId),
            (context) =>
                this.ensureToolEventService(context.ownerId, context.ownerPath)
        );
    }

    emitWithContext<TEvent extends IBaseEventData>(
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

    // --- High-level event emitters ---

    emitExecutionStartEvent(
        input: string,
        config: IAgentConfig,
        messages: TUniversalMessage[],
        resolved: IResolvedProviderInfo,
        conversationId: string,
        executionId: string
    ): void {
        this.emitExecution(
            EXECUTION_EVENTS.START,
            {
                parameters: {
                    input,
                    agentConfiguration: resolved.aiProviderInfo,
                    availableTools: resolved.toolsInfo,
                    toolCount: resolved.toolsInfo.length,
                    hasTools: resolved.toolsInfo.length > 0,
                    systemMessage: config.defaultModel.systemMessage,
                    provider: config.defaultModel.provider,
                    model: config.defaultModel.model,
                    temperature: config.defaultModel.temperature,
                    maxTokens: config.defaultModel.maxTokens,
                },
                metadata: {
                    method: 'execute',
                    inputLength: input.length,
                    messageCount: messages.length,
                    aiProvider: resolved.aiProviderInfo.providerName,
                    model: resolved.aiProviderInfo.model,
                    toolsAvailable: resolved.toolsInfo.map((t) => t.name),
                    agentCapabilities: {
                        canUseTools: resolved.toolsInfo.length > 0,
                        supportedActions: resolved.toolsInfo.map(
                            (t) => t.name
                        ),
                    },
                },
            },
            conversationId,
            executionId
        );
    }

    emitUserMessageEvent(
        input: string,
        conversationId: string,
        executionId: string
    ): void {
        this.emitExecution(
            EXECUTION_EVENTS.USER_MESSAGE,
            {
                parameters: {
                    input,
                    userPrompt: input,
                    userMessageContent: input,
                    messageLength: input.length,
                    wordCount: countWords(input),
                    characterCount: input.length,
                },
                metadata: {
                    messageRole: 'user',
                    inputLength: input.length,
                    messageType: 'user_message',
                    hasQuestions: input.includes('?'),
                    containsUrgency:
                        /urgent|asap|critical|emergency/i.test(input),
                    estimatedComplexity:
                        input.length > HIGH_INPUT_COMPLEXITY_THRESHOLD
                            ? 'high'
                            : input.length > MEDIUM_INPUT_COMPLEXITY_THRESHOLD
                              ? 'medium'
                              : 'low',
                },
            },
            conversationId,
            executionId
        );
    }

    emitAssistantMessageComplete(
        assistantResponse: { content?: string | null; timestamp?: Date },
        executionId: string,
        currentRound: number,
        conversationId: string,
        thinkingNodeId: string,
        previousThinkingNodeId: string | undefined
    ): void {
        if (
            typeof assistantResponse.content !== 'string' ||
            assistantResponse.content.length === 0
        ) {
            throw new Error(
                '[EXECUTION] assistant response must have content or tool calls'
            );
        }
        if (!(assistantResponse.timestamp instanceof Date)) {
            throw new Error(
                '[EXECUTION] assistant response timestamp is required'
            );
        }
        const responseContent = assistantResponse.content;
        const responseStartTime = assistantResponse.timestamp;
        const responseDuration =
            new Date().getTime() - responseStartTime.getTime();

        this.emitWithContext(
            EXECUTION_EVENTS.ASSISTANT_MESSAGE_COMPLETE,
            {
                parameters: {
                    assistantMessage: responseContent,
                    responseLength: responseContent.length,
                    wordCount: countWords(responseContent),
                    responseTime: responseDuration,
                    contentPreview:
                        responseContent.length > CONTENT_PREVIEW_LENGTH
                            ? responseContent.substring(
                                  0,
                                  CONTENT_PREVIEW_LENGTH
                              ) + '...'
                            : responseContent,
                },
                result: {
                    success: true,
                    data:
                        responseContent.substring(0, PREVIEW_LENGTH) + '...',
                    fullResponse: responseContent,
                    responseMetrics: {
                        length: responseContent.length,
                        estimatedReadTime: Math.ceil(
                            countWords(responseContent) / WORDS_PER_MINUTE
                        ),
                        hasCodeBlocks: /```/.test(responseContent),
                        hasLinks: /https?:\/\//.test(responseContent),
                        complexity:
                            responseContent.length > HIGH_COMPLEXITY_THRESHOLD
                                ? 'high'
                                : responseContent.length >
                                    MEDIUM_COMPLEXITY_THRESHOLD
                                  ? 'medium'
                                  : 'low',
                    },
                },
                metadata: {
                    executionId,
                    round: currentRound,
                    completed: true,
                    reason: 'no_tool_calls',
                    responseCharacteristics: {
                        hasQuestions: responseContent.includes('?'),
                        isError: /error|fail|wrong/i.test(responseContent),
                        isComplete: /complete|done|finish/i.test(
                            responseContent
                        ),
                        containsNumbers: /\d/.test(responseContent),
                    },
                },
            },
            () =>
                this.buildResponseOwnerContext(
                    conversationId,
                    executionId,
                    thinkingNodeId,
                    previousThinkingNodeId
                ),
            (ctx) => {
                if (!ctx.ownerType || !ctx.ownerId) {
                    throw new Error(
                        '[EXECUTION] Missing owner context for response event'
                    );
                }
                return bindWithOwnerPath(this.baseEventService, {
                    ownerType: ctx.ownerType,
                    ownerId: ctx.ownerId,
                    ownerPath: ctx.ownerPath,
                });
            }
        );
    }

    emitToolResultsEvents(
        assistantToolCalls: Array<{ id?: string }>,
        toolSummary: { results: Array<{ toolName?: string }> },
        toolsExecuted: string[],
        conversationId: string,
        executionId: string,
        currentRound: number,
        thinkingNodeId: string,
        previousThinkingNodeId: string | undefined
    ): void {
        const toolCallIds = assistantToolCalls.map((toolCall) => {
            if (!toolCall.id || toolCall.id.length === 0) {
                throw new Error(
                    '[EXECUTION] Tool call missing id for tool results ready payload'
                );
            }
            return toolCall.id;
        });
        if (toolCallIds.length === 0) {
            throw new Error(
                '[EXECUTION] Tool results ready requires toolCallIds'
            );
        }

        const buildCtx = () =>
            this.buildThinkingOwnerContext(
                conversationId,
                executionId,
                thinkingNodeId,
                previousThinkingNodeId
            );
        const resolveService = (ctx: IEventContext) => {
            if (!ctx.ownerType || !ctx.ownerId) {
                throw new Error(
                    '[EXECUTION] Missing owner context for tool results event'
                );
            }
            return bindWithOwnerPath(this.baseEventService, {
                ownerType: ctx.ownerType,
                ownerId: ctx.ownerId,
                ownerPath: ctx.ownerPath,
            });
        };

        this.emitWithContext(
            EXECUTION_EVENTS.TOOL_RESULTS_READY,
            {
                parameters: { toolCallIds, round: currentRound },
                metadata: { round: currentRound },
            },
            buildCtx,
            resolveService
        );

        this.emitWithContext(
            EXECUTION_EVENTS.TOOL_RESULTS_TO_LLM,
            {
                parameters: {
                    toolsExecuted: toolsExecuted.length,
                    round: currentRound,
                },
                metadata: {
                    toolsExecuted: toolSummary.results.map((r) => {
                        if (
                            !r.toolName ||
                            (r.toolName as string).length === 0
                        ) {
                            throw new Error(
                                '[EXECUTION] Tool result missing toolName'
                            );
                        }
                        return r.toolName;
                    }),
                    round: currentRound,
                },
            },
            buildCtx,
            resolveService
        );
    }
}
