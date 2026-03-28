import type { IEventContext, IOwnerPathSegment } from '../interfaces/event-service';
import { TOOL_EVENT_PREFIX } from './tool-execution-service';
import { EXECUTION_EVENT_PREFIX } from './execution-constants';

/**
 * Build the owner path from an optional IExecutionContextInjection.
 */
export function buildBaseOwnerPath(executionContext?: {
  ownerPath?: IOwnerPathSegment[];
}): IOwnerPathSegment[] {
  if (!executionContext?.ownerPath?.length) {
    return [];
  }
  return executionContext.ownerPath.map((segment) => ({ ...segment }));
}

/**
 * Build the IEventContext for an execution-level event.
 */
export function buildExecutionOwnerContext(
  agentOwnerPathBase: IOwnerPathSegment[],
  ownerPathBase: IOwnerPathSegment[],
  rootId: string,
  executionId: string,
): IEventContext {
  if (!rootId || rootId.length === 0) {
    throw new Error('[EXECUTION] Missing rootId for execution owner context');
  }
  if (!executionId || executionId.length === 0) {
    throw new Error('[EXECUTION] Missing executionId for execution owner context');
  }
  const basePath = agentOwnerPathBase.length ? agentOwnerPathBase : ownerPathBase;
  const path: IOwnerPathSegment[] = [...basePath];
  if (rootId && !path.some((segment) => segment.type === 'agent' && segment.id === rootId)) {
    path.push({ type: 'agent', id: rootId });
  }
  path.push({ type: 'execution', id: executionId });
  return {
    ownerType: EXECUTION_EVENT_PREFIX,
    ownerId: executionId,
    ownerPath: path,
  };
}

/**
 * Build the IEventContext for a thinking-level event.
 */
export function buildThinkingOwnerContext(
  agentOwnerPathBase: IOwnerPathSegment[],
  ownerPathBase: IOwnerPathSegment[],
  rootId: string,
  executionId: string,
  thinkingNodeId: string,
  previousThinkingNodeId?: string,
): IEventContext {
  if (!thinkingNodeId || thinkingNodeId.length === 0) {
    throw new Error('[EXECUTION] Missing thinkingNodeId for thinking owner context');
  }
  const base = buildExecutionOwnerContext(
    agentOwnerPathBase,
    ownerPathBase,
    rootId,
    executionId,
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

/**
 * Build the IEventContext for a tool-level event.
 */
export function buildToolOwnerContext(
  agentOwnerPathBase: IOwnerPathSegment[],
  ownerPathBase: IOwnerPathSegment[],
  rootId: string,
  executionId: string,
  toolCallId: string,
): IEventContext {
  if (!toolCallId || toolCallId.length === 0) {
    throw new Error('[EXECUTION] Missing toolCallId for tool owner context');
  }
  const base = buildExecutionOwnerContext(
    agentOwnerPathBase,
    ownerPathBase,
    rootId,
    executionId,
  ).ownerPath;
  const path = [...base, { type: 'tool', id: toolCallId }];
  return {
    ownerType: TOOL_EVENT_PREFIX,
    ownerId: toolCallId,
    ownerPath: path,
  };
}

/**
 * Build the IEventContext for a response-level event.
 */
export function buildResponseOwnerContext(
  agentOwnerPathBase: IOwnerPathSegment[],
  ownerPathBase: IOwnerPathSegment[],
  rootId: string,
  executionId: string,
  thinkingNodeId: string,
  previousThinkingNodeId?: string,
): IEventContext {
  const thinkingPath = buildThinkingOwnerContext(
    agentOwnerPathBase,
    ownerPathBase,
    rootId,
    executionId,
    thinkingNodeId,
    previousThinkingNodeId,
  ).ownerPath;
  const responseNodeId = `response_${thinkingNodeId}`;
  const path: IOwnerPathSegment[] = [...thinkingPath, { type: 'response', id: responseNodeId }];
  return {
    ownerType: EXECUTION_EVENT_PREFIX,
    ownerId: executionId,
    ownerPath: path,
  };
}
