import { EXECUTION_EVENT_PREFIX } from './execution-constants';
import { TOOL_EVENT_PREFIX } from './tool-execution-service';

import type { TExecutionEventCallback, TExecutionEventData } from '../interfaces/agent';
import type { IEventContext, IOwnerPathSegment } from '../interfaces/event-service';
import type { TUniversalMessage } from '../interfaces/messages';

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

/**
 * Announce the message just appended to the conversation store — CORE-033.
 *
 * `history_mutation` is a REQUIRED family (`agent-core/docs/SPEC.md`), and `agent-session` builds
 * its session log from it: a consumer replays the appends to reconstruct the conversation. Three
 * sites appended without announcing — the forced summary, the hard-capacity diagnostic, and the
 * provider-failure record — so a replay diverged from the store at exactly the abnormal moments a
 * reader most needs it to agree.
 *
 * It reads the appended message back out of the store rather than taking it as an argument, because
 * the store is what a replay must reproduce: an event built from what the CALLER meant to append
 * could disagree with what the store holds, which is the class of defect this exists to close.
 */
export function announceAppend(
  store: { getMessages(): TUniversalMessage[] },
  context: { onExecutionEvent?: TExecutionEventCallback },
  executionId: string,
  // `string | undefined`, matching every sibling emit in this engine: a turn without one emits the
  // field absent rather than as a fabricated empty string, which a consumer would read as an id.
  conversationId: string | undefined,
  extra: TExecutionEventData = {},
): void {
  if (context.onExecutionEvent === undefined) return;
  const messages = store.getMessages();
  const appended = messages.at(-1);
  if (appended === undefined) return;
  context.onExecutionEvent('history_mutation', {
    executionId,
    conversationId,
    ...extra,
    mutation: 'append_message',
    index: messages.length - 1,
    message: appended,
  } as TExecutionEventData);
}
