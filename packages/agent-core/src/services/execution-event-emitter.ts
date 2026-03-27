import type { IExecutionContextInjection } from '../interfaces/agent';
import type { ILogger } from '../utils/logger';
import type {
  IEventService,
  IEventContext,
  IOwnerPathSegment,
  IExecutionEventData,
  IToolEventData,
  IBaseEventData,
} from '../interfaces/event-service';
import { isDefaultEventService, bindWithOwnerPath } from '../event-service/index';
import { TOOL_EVENT_PREFIX } from './tool-execution-service';
import type { IAgentConfig } from '../interfaces/agent';
import type { TUniversalMessage } from '../interfaces/messages';
import type { IResolvedProviderInfo } from './execution-types';
import {
  buildBaseOwnerPath,
  buildExecutionOwnerContext,
  buildThinkingOwnerContext,
  buildToolOwnerContext,
  buildResponseOwnerContext,
} from './execution-event-helpers';
import {
  emitAssistantMessageComplete as emitAssistantMessageCompleteHelper,
  emitToolResultsEvents as emitToolResultsEventsHelper,
  emitExecutionStartEvent as emitExecutionStartEventHelper,
  emitUserMessageEvent as emitUserMessageEventHelper,
} from './execution-event-emitter-high-level';

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
    executionContext?: IExecutionContextInjection,
  ) {
    this.baseEventService = baseEventService;
    this.logger = logger;
    this.ownerPathBase = buildBaseOwnerPath(executionContext);
    this.toolEventServices = new Map();
    this.agentOwnerPathBase = [];
  }

  /**
   * Prepare owner path bases for a conversation
   */
  prepareOwnerPathBases(conversationId: string): void {
    this.toolEventServices.clear();
    const ownerPath = [...this.ownerPathBase, { type: 'agent', id: conversationId }];
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
    ownerPath: IOwnerPathSegment[] | undefined,
  ): IEventService {
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

  // --- Owner context builders (delegating to pure helpers) ---

  buildExecutionOwnerContext(rootId: string, executionId: string): IEventContext {
    return buildExecutionOwnerContext(
      this.agentOwnerPathBase,
      this.ownerPathBase,
      rootId,
      executionId,
    );
  }

  buildThinkingOwnerContext(
    rootId: string,
    executionId: string,
    thinkingNodeId: string,
    previousThinkingNodeId?: string,
  ): IEventContext {
    return buildThinkingOwnerContext(
      this.agentOwnerPathBase,
      this.ownerPathBase,
      rootId,
      executionId,
      thinkingNodeId,
      previousThinkingNodeId,
    );
  }

  buildToolOwnerContext(rootId: string, executionId: string, toolCallId: string): IEventContext {
    return buildToolOwnerContext(
      this.agentOwnerPathBase,
      this.ownerPathBase,
      rootId,
      executionId,
      toolCallId,
    );
  }

  buildResponseOwnerContext(
    rootId: string,
    executionId: string,
    thinkingNodeId: string,
    previousThinkingNodeId?: string,
  ): IEventContext {
    return buildResponseOwnerContext(
      this.agentOwnerPathBase,
      this.ownerPathBase,
      rootId,
      executionId,
      thinkingNodeId,
      previousThinkingNodeId,
    );
  }

  // --- Emit helpers ---

  emitExecution(
    eventType: string,
    data: Omit<IExecutionEventData, 'timestamp'>,
    rootId: string,
    executionId: string,
  ): void {
    this.emitWithContext(
      eventType,
      data,
      () => this.buildExecutionOwnerContext(rootId, executionId),
      (context) => {
        if (!context.ownerType || !context.ownerId) {
          throw new Error('[EXECUTION] Missing owner context for execution event');
        }
        return bindWithOwnerPath(this.baseEventService, {
          ownerType: context.ownerType,
          ownerId: context.ownerId,
          ownerPath: context.ownerPath,
        });
      },
    );
  }

  emitTool(
    eventType: string,
    data: Omit<IToolEventData, 'timestamp'>,
    rootId: string,
    executionId: string,
    toolCallId: string,
  ): void {
    this.emitWithContext(
      eventType,
      data,
      () => this.buildToolOwnerContext(rootId, executionId, toolCallId),
      (context) => this.ensureToolEventService(context.ownerId, context.ownerPath),
    );
  }

  emitWithContext<TEvent extends IBaseEventData>(
    eventType: string,
    data: Omit<TEvent, 'timestamp'>,
    buildContext: () => IEventContext,
    resolveService: (context: IEventContext) => IEventService,
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
    executionId: string,
  ): void {
    emitExecutionStartEventHelper(
      this,
      input,
      config,
      messages,
      resolved,
      conversationId,
      executionId,
    );
  }

  emitUserMessageEvent(input: string, conversationId: string, executionId: string): void {
    emitUserMessageEventHelper(this, input, conversationId, executionId);
  }

  emitAssistantMessageComplete(
    assistantResponse: { content?: string | null; timestamp?: Date },
    executionId: string,
    currentRound: number,
    conversationId: string,
    thinkingNodeId: string,
    previousThinkingNodeId: string | undefined,
  ): void {
    emitAssistantMessageCompleteHelper(
      this,
      this.baseEventService,
      assistantResponse,
      executionId,
      currentRound,
      conversationId,
      thinkingNodeId,
      previousThinkingNodeId,
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
    previousThinkingNodeId: string | undefined,
  ): void {
    emitToolResultsEventsHelper(
      this,
      this.baseEventService,
      assistantToolCalls,
      toolSummary,
      toolsExecuted,
      conversationId,
      executionId,
      currentRound,
      thinkingNodeId,
      previousThinkingNodeId,
    );
  }
}
