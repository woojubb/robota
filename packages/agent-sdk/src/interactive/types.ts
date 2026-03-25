/**
 * Types for InteractiveSession — event-driven session wrapper.
 */

import type { TUniversalMessage, IContextWindowState, TToolArgs } from '@robota-sdk/agent-core';

/** Permission handler result — SDK-owned type (mirrors agent-sessions TPermissionResult).
 *  true = allow, false = deny, 'allow-session' = allow and remember for this session. */
export type TPermissionResultValue = boolean | 'allow-session';

/** Tool execution state visible to clients. */
export interface IToolState {
  toolName: string;
  firstArg: string;
  isRunning: boolean;
  result?: 'success' | 'error' | 'denied';
  diffLines?: IDiffLine[];
  diffFile?: string;
}

/** A single diff line for Edit tool display. */
export interface IDiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  lineNumber?: number;
}

/** Result of a completed prompt execution. */
export interface IExecutionResult {
  response: string;
  messages: TUniversalMessage[];
  toolSummaries: IToolSummary[];
  contextState: IContextWindowState;
}

/** Summary of a tool call extracted from history. */
export interface IToolSummary {
  name: string;
  args: string;
}

/** Permission handler delegate — clients provide their own UI. */
export type TInteractivePermissionHandler = (
  toolName: string,
  toolArgs: TToolArgs,
) => Promise<TPermissionResultValue>;

/** Events emitted by InteractiveSession. */
export interface IInteractiveSessionEvents {
  text_delta: (delta: string) => void;
  tool_start: (state: IToolState) => void;
  tool_end: (state: IToolState) => void;
  thinking: (isThinking: boolean) => void;
  complete: (result: IExecutionResult) => void;
  error: (error: Error) => void;
  context_update: (state: IContextWindowState) => void;
  interrupted: (result: IExecutionResult) => void;
}

export type TInteractiveEventName = keyof IInteractiveSessionEvents;
