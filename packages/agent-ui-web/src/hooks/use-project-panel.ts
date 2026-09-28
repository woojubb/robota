import { useCallback, useRef, useState } from 'react';

import type { IWsSessionState } from './session-client-types.js';
import type { TClientMessage } from '../client/ws-session-client.js';
import type { TServerMessage } from '@robota-sdk/agent-transport';

type TProjectPanelState = Pick<
  IWsSessionState,
  | 'projectStatusState'
  | 'projectStatus'
  | 'requestProjectStatus'
  | 'projectDiffState'
  | 'projectDiffPath'
  | 'projectDiff'
  | 'requestProjectDiff'
  | 'projectMemoryState'
  | 'projectMemory'
  | 'requestProjectMemory'
>;

let requestCounter = 0;
function nextRequestId(prefix: string): string {
  requestCounter += 1;
  return `${prefix}_${requestCounter}_${Date.now()}`;
}

/**
 * #3282 §4c — the Project panel's correlated request/response state (status, one file's diff, project
 * memory), independent from chat state. Mirrors `usePersonalUsageState`'s shape: a status per read, a
 * `requestId` ref that drops a stale reply (a diff request superseded by clicking another file before
 * the first answered), and a request function per read.
 */
export function useProjectPanelState(
  send: (msg: TClientMessage) => void,
): TProjectPanelState & { handleProjectMessage: (msg: TServerMessage) => boolean } {
  const [projectStatusState, setProjectStatusState] =
    useState<IWsSessionState['projectStatusState']>('idle');
  const [projectStatus, setProjectStatus] = useState<IWsSessionState['projectStatus']>(null);
  const [projectDiffState, setProjectDiffState] =
    useState<IWsSessionState['projectDiffState']>('idle');
  const [projectDiffPath, setProjectDiffPath] = useState<string | null>(null);
  const [projectDiff, setProjectDiff] = useState<IWsSessionState['projectDiff']>(null);
  const [projectMemoryState, setProjectMemoryState] =
    useState<IWsSessionState['projectMemoryState']>('idle');
  const [projectMemory, setProjectMemory] = useState<IWsSessionState['projectMemory']>(null);

  const statusRequestRef = useRef<string | null>(null);
  const diffRequestRef = useRef<string | null>(null);
  const memoryRequestRef = useRef<string | null>(null);

  const handleProjectMessage = useCallback((msg: TServerMessage): boolean => {
    if (msg.type === 'project_status') {
      if (statusRequestRef.current !== msg.requestId) return true;
      setProjectStatus(msg.result);
      setProjectStatusState('ready');
      return true;
    }
    if (msg.type === 'project_diff') {
      if (diffRequestRef.current !== msg.requestId) return true;
      setProjectDiff(msg.result);
      setProjectDiffState('ready');
      return true;
    }
    if (msg.type === 'project_memory') {
      if (memoryRequestRef.current !== msg.requestId) return true;
      setProjectMemory(msg.result);
      setProjectMemoryState('ready');
      return true;
    }
    if (msg.type === 'protocol_error' && msg.requestId !== undefined) {
      if (statusRequestRef.current === msg.requestId) setProjectStatusState('error');
      if (diffRequestRef.current === msg.requestId) setProjectDiffState('error');
      if (memoryRequestRef.current === msg.requestId) setProjectMemoryState('error');
    }
    return false;
  }, []);

  const requestProjectStatus = useCallback((): void => {
    const requestId = nextRequestId('project_status');
    statusRequestRef.current = requestId;
    setProjectStatusState('loading');
    send({ type: 'project-status', requestId });
  }, [send]);

  const requestProjectDiff = useCallback(
    (path: string): void => {
      const requestId = nextRequestId('project_diff');
      diffRequestRef.current = requestId;
      setProjectDiffPath(path);
      setProjectDiffState('loading');
      setProjectDiff(null);
      send({ type: 'project-diff', requestId, path });
    },
    [send],
  );

  const requestProjectMemory = useCallback((): void => {
    const requestId = nextRequestId('project_memory');
    memoryRequestRef.current = requestId;
    setProjectMemoryState('loading');
    send({ type: 'project-memory', requestId });
  }, [send]);

  return {
    projectStatusState,
    projectStatus,
    requestProjectStatus,
    projectDiffState,
    projectDiffPath,
    projectDiff,
    requestProjectDiff,
    projectMemoryState,
    projectMemory,
    requestProjectMemory,
    handleProjectMessage,
  };
}
