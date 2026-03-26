/**
 * Types for InteractiveSession — event-driven session wrapper.
 */

import type {
  TUniversalMessage,
  IContextWindowState,
  TToolArgs,
  IHistoryEntry,
} from '@robota-sdk/agent-core';

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
  text: string;
  lineNumber: number;
}

/** Result of a completed prompt execution. */
export interface IExecutionResult {
  response: string;
  history: IHistoryEntry[];
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

/**
 * Common interface for all transport adapters.
 * Each transport exposes InteractiveSession over a specific protocol.
 */
export interface ITransportAdapter {
  /** Human-readable transport name (e.g., 'http', 'ws', 'mcp', 'headless') */
  readonly name: string;

  /** Attach an InteractiveSession to this transport. */
  attach(session: InteractiveSession): void;

  /** Start serving. What this means depends on the transport. */
  start(): Promise<void>;

  /** Stop serving and clean up resources. */
  stop(): Promise<void>;
}

// Forward reference — InteractiveSession is in the same package but separate file.
// Import the class type for the interface without circular dependency.
import type { InteractiveSession } from '../interactive/interactive-session.js';
