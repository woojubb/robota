/**
 * Hook: create a Session instance once and provide a stable permission handler,
 * streaming text, and real-time tool execution state.
 */

import { useState, useCallback, useRef } from 'react';
import { createSession, FileSessionLogger, projectPaths } from '@robota-sdk/agent-sdk';
import { extractEditDiff } from '../../utils/edit-diff.js';
import type { Session } from '@robota-sdk/agent-sdk';
import type {
  IResolvedConfig,
  ILoadedContext,
  IProjectInfo,
  SessionStore,
} from '@robota-sdk/agent-sdk';
import type { TPermissionMode, TToolArgs } from '@robota-sdk/agent-core';
import type { ITerminalOutput, ISpinner } from '../../types.js';
import type { IPermissionRequest, TPermissionResult } from '../types.js';
import type { IToolExecutionState } from '../StreamingIndicator.js';

const TOOL_ARG_DISPLAY_MAX = 80;
const TAIL_KEEP = 30;
/** Max completed tools to keep in the activeTools array during a single response */
const MAX_COMPLETED_TOOLS = 50;

/** No-op ITerminalOutput for Ink mode (permissions handled via permissionHandler) */
const NOOP_TERMINAL: ITerminalOutput = {
  write: () => {},
  writeLine: () => {},
  writeMarkdown: () => {},
  writeError: () => {},
  prompt: () => Promise.resolve(''),
  select: () => Promise.resolve(0),
  spinner: (): ISpinner => ({ stop: () => {}, update: () => {} }),
};

export interface ISessionProps {
  config: IResolvedConfig;
  context: ILoadedContext;
  projectInfo?: IProjectInfo;
  sessionStore?: SessionStore;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  cwd?: string;
}

export function useSession(props: ISessionProps): {
  session: Session;
  permissionRequest: IPermissionRequest | null;
  streamingText: string;
  clearStreamingText: () => void;
  activeTools: IToolExecutionState[];
} {
  const [permissionRequest, setPermissionRequest] = useState<IPermissionRequest | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const streamingTextRef = useRef('');
  const [activeTools, setActiveTools] = useState<IToolExecutionState[]>([]);

  // Permission queue — handles concurrent tool permission requests sequentially
  const permissionQueueRef = useRef<
    Array<{
      toolName: string;
      toolArgs: TToolArgs;
      resolve: (result: TPermissionResult) => void;
    }>
  >([]);
  const processingRef = useRef(false);

  const processNextPermission = useCallback(() => {
    if (processingRef.current) return;
    const next = permissionQueueRef.current[0];
    if (!next) {
      setPermissionRequest(null);
      return;
    }
    processingRef.current = true;
    setPermissionRequest({
      toolName: next.toolName,
      toolArgs: next.toolArgs,
      resolve: (result: TPermissionResult) => {
        permissionQueueRef.current.shift();
        processingRef.current = false;
        setPermissionRequest(null);
        next.resolve(result);
        setTimeout(() => processNextPermission(), 0);
      },
    });
  }, []);

  const sessionRef = useRef<Session | null>(null);
  if (sessionRef.current === null) {
    const permissionHandler = (
      toolName: string,
      toolArgs: TToolArgs,
    ): Promise<TPermissionResult> => {
      return new Promise<TPermissionResult>((resolve) => {
        permissionQueueRef.current.push({ toolName, toolArgs, resolve });
        processNextPermission();
      });
    };

    const onTextDelta = (delta: string): void => {
      setStreamingText((prev) => {
        const next = prev + delta;
        streamingTextRef.current = next;
        return next;
      });
    };

    const onToolExecution = (event: {
      type: 'start' | 'end';
      toolName: string;
      toolArgs?: Record<string, unknown>;
      success?: boolean;
      denied?: boolean;
      toolResultData?: string;
    }): void => {
      if (event.type === 'start') {
        let firstArg = '';
        if (event.toolArgs) {
          const firstVal = Object.values(event.toolArgs)[0];
          const raw = typeof firstVal === 'string' ? firstVal : JSON.stringify(firstVal ?? '');
          firstArg =
            raw.length > TOOL_ARG_DISPLAY_MAX
              ? raw.slice(0, TOOL_ARG_DISPLAY_MAX - TAIL_KEEP - 3) + '...' + raw.slice(-TAIL_KEEP)
              : raw;
        }
        setActiveTools((prev) => [
          ...prev,
          { toolName: event.toolName, firstArg, isRunning: true, _toolArgs: event.toolArgs },
        ]);
      } else {
        const toolResult = event.denied ? 'denied' : event.success === false ? 'error' : 'success';
        setActiveTools((prev) => {
          const updated = prev.map((t) => {
            if (!(t.toolName === event.toolName && t.isRunning)) return t;

            // Extract diff for Edit tool — parse startLine from tool result
            let startLine: number | undefined;
            if (event.toolResultData && event.toolName === 'Edit') {
              try {
                const parsed = JSON.parse(event.toolResultData) as Record<string, unknown>;
                if (typeof parsed.startLine === 'number') {
                  startLine = parsed.startLine;
                }
              } catch {
                /* ignore parse errors */
              }
            }
            const editDiff = extractEditDiff(
              event.toolName,
              (t as Record<string, unknown>)._toolArgs as Record<string, unknown>,
              startLine,
            );

            const finished: typeof t = {
              ...t,
              isRunning: false,
              result: toolResult as 'success' | 'error' | 'denied',
            };
            if (editDiff) {
              finished.diffLines = editDiff.lines;
              finished.diffFile = editDiff.file;
            }
            // Clear toolArgs ref to free memory
            delete (finished as Record<string, unknown>)._toolArgs;
            return finished;
          });
          // Trim old completed tools to prevent unbounded growth
          const completed = updated.filter((t) => !t.isRunning);
          if (completed.length > MAX_COMPLETED_TOOLS) {
            const excess = completed.length - MAX_COMPLETED_TOOLS;
            let removed = 0;
            return updated.filter((t) => {
              if (!t.isRunning && removed < excess) {
                removed++;
                return false;
              }
              return true;
            });
          }
          return updated;
        });
      }
    };

    const paths = projectPaths(props.cwd ?? process.cwd());
    sessionRef.current = createSession({
      config: props.config,
      context: props.context,
      terminal: NOOP_TERMINAL,
      sessionLogger: new FileSessionLogger(paths.logs),
      projectInfo: props.projectInfo,
      sessionStore: props.sessionStore,
      permissionMode: props.permissionMode,
      maxTurns: props.maxTurns,
      permissionHandler,
      onTextDelta,
      onToolExecution,
    });
  }

  const clearStreamingText = useCallback(() => {
    setStreamingText('');
    streamingTextRef.current = '';
    setActiveTools([]);
  }, []);

  const getStreamingText = useCallback(() => streamingTextRef.current, []);

  return {
    session: sessionRef.current,
    permissionRequest,
    streamingText,
    clearStreamingText,
    getStreamingText,
    activeTools,
  };
}
