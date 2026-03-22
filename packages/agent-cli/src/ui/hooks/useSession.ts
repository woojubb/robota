/**
 * Hook: create a Session instance once and provide a stable permission handler,
 * streaming text, and real-time tool execution state.
 */

import { useState, useCallback, useRef } from 'react';
import { createSession, FileSessionLogger, projectPaths } from '@robota-sdk/agent-sdk';
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
      setStreamingText((prev) => prev + delta);
    };

    const onToolExecution = (event: {
      type: 'start' | 'end';
      toolName: string;
      toolArgs?: Record<string, unknown>;
      success?: boolean;
      denied?: boolean;
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
          { toolName: event.toolName, firstArg, isRunning: true },
        ]);
      } else {
        const result = event.denied ? 'denied' : event.success === false ? 'error' : 'success';
        setActiveTools((prev) =>
          prev.map((t) =>
            t.toolName === event.toolName && t.isRunning
              ? { ...t, isRunning: false, result: result as 'success' | 'error' | 'denied' }
              : t,
          ),
        );
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
    setActiveTools([]);
  }, []);

  return {
    session: sessionRef.current,
    permissionRequest,
    streamingText,
    clearStreamingText,
    activeTools,
  };
}
