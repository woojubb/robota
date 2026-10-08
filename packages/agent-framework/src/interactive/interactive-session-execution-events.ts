import type { TUniversalMessagePart } from '@robota-sdk/agent-core';
import {
  createAssistantMessage,
  createSystemMessage,
  messageToHistoryEntry,
} from '@robota-sdk/agent-core';

import { GOAL_SIGNAL_TOOL_NAME } from '../goal/index.js';

import {
  applyToolEnd,
  applyToolStart,
  pushToolSummaryToHistory,
} from './interactive-session-streaming.js';

import type { IExecutionControllerCallbacks } from './interactive-session-execution-contracts.js';
import type { SessionHistoryTracker } from './interactive-session-history-tracker.js';
import type { IToolState } from './types.js';
import type { TToolArgs } from '@robota-sdk/agent-core';
import type { ICompactEvent } from '@robota-sdk/agent-interface-session';

export function projectCompactEvent(
  histTracker: SessionHistoryTracker,
  callbacks: IExecutionControllerCallbacks,
  event: ICompactEvent,
): void {
  if (event.trigger === 'auto') {
    histTracker.append(
      messageToHistoryEntry(
        createSystemMessage(
          `Auto compacted context: ${Math.round(event.before.usedPercentage)}% -> ${Math.round(event.after.usedPercentage)}%`,
        ),
      ),
    );
  }
  callbacks.emit('compact', event);
  callbacks.emit('context_update', event.after);
}

export function projectToolExecution(
  activeTools: IToolState[],
  history: ReturnType<SessionHistoryTracker['getHistory']>,
  callbacks: Pick<IExecutionControllerCallbacks, 'getCwd' | 'emit' | 'modelCommandToolNames'>,
  commitActiveTools: (tools: IToolState[]) => void,
  event: {
    type: 'start' | 'end';
    toolName: string;
    toolArgs?: TToolArgs;
    success?: boolean;
    denied?: boolean;
    toolResultData?: string;
    toolResultParts?: TUniversalMessagePart[];
    executionId?: string;
  },
  startLabel?: string,
  beforeToolStart?: () => void,
): IToolState[] {
  const streamingState = { activeTools, history };
  const cwd = callbacks.getCwd();
  if (event.type === 'start') {
    // #3288: the framework classifies a tool call as it starts — a projected `/command` tool gets
    // its source command name, and the internal goal-signal tool is flagged so surfaces can hide it.
    // Neither is hardcoded downstream: agent-ui-web never sees the projection prefix or the constant.
    const toolState = applyToolStart(
      streamingState,
      {
        ...event,
        commandName: callbacks.modelCommandToolNames?.get(event.toolName),
        internal: event.toolName === GOAL_SIGNAL_TOOL_NAME,
      },
      startLabel,
      cwd,
    );
    commitActiveTools(streamingState.activeTools);
    beforeToolStart?.();
    callbacks.emit('tool_start', toolState);
  } else {
    // A refusal can finish before the body starts. Give its observed outcome a row without dispatch.
    const hasCall = streamingState.activeTools.some((tool) =>
      event.executionId !== undefined
        ? tool.executionId === event.executionId && tool.isRunning
        : tool.toolName === event.toolName && tool.isRunning,
    );
    if (!hasCall && event.success === false) {
      const refused = applyToolStart(
        streamingState,
        {
          ...event,
          commandName: callbacks.modelCommandToolNames?.get(event.toolName),
          internal: event.toolName === GOAL_SIGNAL_TOOL_NAME,
        },
        startLabel,
        cwd,
      );
      callbacks.emit('tool_start', refused);
    }
    const finished = applyToolEnd(streamingState, event, cwd);
    commitActiveTools(streamingState.activeTools);
    if (finished) callbacks.emit('tool_end', finished);
  }
  return streamingState.activeTools;
}

export function projectForkSkillResult(
  result: string,
  activeTools: IToolState[],
  histTracker: SessionHistoryTracker,
  callbacks: IExecutionControllerCallbacks,
  flushStreaming: () => void,
  clearStreaming: () => void,
): void {
  flushStreaming();
  pushToolSummaryToHistory({ activeTools, history: histTracker.getHistory() });
  clearStreaming();
  const executionResult = {
    response: result,
    history: histTracker.getHistory(),
    toolSummaries: [],
    contextState: callbacks.getContextState(),
  };
  histTracker.append(messageToHistoryEntry(createAssistantMessage(result)));
  callbacks.emit('complete', executionResult);
  callbacks.emit('context_update', callbacks.getContextState());
}
