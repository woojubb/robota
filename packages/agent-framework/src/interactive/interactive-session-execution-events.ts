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
  callbacks: IExecutionControllerCallbacks,
  commitActiveTools: (tools: IToolState[]) => void,
  event: {
    type: 'start' | 'end';
    toolName: string;
    toolArgs?: TToolArgs;
    success?: boolean;
    denied?: boolean;
    toolResultData?: string;
    executionId?: string;
  },
  startLabel?: string,
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
    callbacks.emit('tool_start', toolState);
  } else {
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
