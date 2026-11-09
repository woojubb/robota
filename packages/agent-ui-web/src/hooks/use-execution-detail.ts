import { useCallback, useEffect, useRef, useState } from 'react';

import type { TClientMessage } from '../client/ws-session-client.js';
import type {
  IBackgroundTaskLogUnreadable,
  IExecutionDetailCursor,
  IExecutionDetailRecord,
  IExecutionWorkspaceSnapshot,
} from '@robota-sdk/agent-interface/execution';
import type { TServerMessage } from '@robota-sdk/agent-transport';

export type TExecutionDetailStatus = 'idle' | 'loading' | 'ready' | 'error';
type TDetailMode = 'live' | 'transcript';

export interface IExecutionDetailState {
  openEntryId: string | null;
  executionDetailStatus: TExecutionDetailStatus;
  executionDetailRecords: readonly IExecutionDetailRecord[];
  executionDetailError: string | null;
  executionDetailComplete: boolean;
  executionDetailMode: TDetailMode;
  executionDetailUnreadable: IBackgroundTaskLogUnreadable | undefined;
  openExecutionDetail: (entryId: string) => void;
  loadMoreExecutionDetail: () => void;
  showEarlierExecutionDetail: () => void;
  showLiveExecutionDetail: () => void;
  closeExecutionDetail: () => void;
}

let requestCounter = 0;
function nextRequestId(): string {
  requestCounter += 1;
  return `execdetail_${requestCounter}_${Date.now()}`;
}

export function useExecutionDetailState(
  send: (msg: TClientMessage) => void,
): IExecutionDetailState & {
  handleExecutionDetailMessage: (msg: TServerMessage) => boolean;
  handleExecutionWorkspace: (snapshot: IExecutionWorkspaceSnapshot) => void;
} {
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [status, setStatus] = useState<TExecutionDetailStatus>('idle');
  const [records, setRecords] = useState<readonly IExecutionDetailRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [mode, setMode] = useState<TDetailMode>('live');
  const [unreadable, setUnreadable] = useState<IBackgroundTaskLogUnreadable>();
  const requestIdRef = useRef<string | null>(null);
  const entryIdRef = useRef<string | null>(null);
  const modeRef = useRef<TDetailMode>('live');
  const nextCursorRef = useRef<IExecutionDetailCursor | undefined>(undefined);
  const queuedRef = useRef<{ cursor?: IExecutionDetailCursor; refresh: boolean } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastReadAtRef = useRef(0);

  const readPage = useCallback(
    (entryId: string, cursor?: IExecutionDetailCursor, refresh = false): void => {
      if (requestIdRef.current !== null) {
        if (!refresh || queuedRef.current === null || queuedRef.current.refresh) {
          queuedRef.current = { cursor, refresh };
        }
        return;
      }
      const requestId = nextRequestId();
      requestIdRef.current = requestId;
      lastReadAtRef.current = Date.now();
      if (!refresh) setStatus('loading');
      setError(null);
      send({ type: 'read-execution-detail', requestId, entryId, cursor });
    },
    [send],
  );

  const clearPending = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    queuedRef.current = null;
  }, []);
  useEffect(() => clearPending, [clearPending]);

  const openExecutionDetail = useCallback(
    (entryId: string): void => {
      clearPending();
      requestIdRef.current = null;
      entryIdRef.current = entryId;
      modeRef.current = 'live';
      setMode('live');
      setOpenEntryId(entryId);
      setRecords([]);
      setUnreadable(undefined);
      setComplete(false);
      nextCursorRef.current = undefined;
      readPage(entryId);
    },
    [clearPending, readPage],
  );

  const loadMoreExecutionDetail = useCallback((): void => {
    if (!openEntryId || status === 'loading' || complete) return;
    readPage(openEntryId, nextCursorRef.current);
  }, [openEntryId, status, complete, readPage]);

  const changeMode = useCallback(
    (next: TDetailMode): void => {
      const entryId = entryIdRef.current;
      if (!entryId) return;
      clearPending();
      modeRef.current = next;
      setMode(next);
      setRecords([]);
      setUnreadable(undefined);
      setComplete(false);
      setStatus('loading');
      nextCursorRef.current = undefined;
      readPage(entryId, next === 'transcript' ? { offset: 0 } : undefined);
    },
    [clearPending, readPage],
  );

  const showEarlierExecutionDetail = useCallback(() => changeMode('transcript'), [changeMode]);
  const showLiveExecutionDetail = useCallback(() => changeMode('live'), [changeMode]);

  const closeExecutionDetail = useCallback((): void => {
    clearPending();
    setOpenEntryId(null);
    requestIdRef.current = null;
    entryIdRef.current = null;
    setRecords([]);
    setUnreadable(undefined);
    setStatus('idle');
    setError(null);
    setComplete(false);
  }, [clearPending]);

  const scheduleRefresh = useCallback(
    (entryId: string): void => {
      if (timerRef.current !== null) return;
      const delay = Math.max(0, 250 - (Date.now() - lastReadAtRef.current));
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (entryIdRef.current === entryId && modeRef.current === 'live') {
          readPage(entryId, undefined, true);
        }
      }, delay);
    },
    [readPage],
  );

  const handleExecutionWorkspace = useCallback(
    (snapshot: IExecutionWorkspaceSnapshot): void => {
      const entryId = entryIdRef.current;
      if (!entryId || modeRef.current !== 'live') return;
      const entry = snapshot.entries.find((item) => item.id === entryId);
      if (entry?.resumeSessionId && entry.controls.includes('attach')) scheduleRefresh(entryId);
    },
    [scheduleRefresh],
  );

  const handleExecutionDetailMessage = useCallback(
    (msg: TServerMessage): boolean => {
      if (msg.type !== 'execution_detail' && msg.type !== 'execution_detail_error') return false;
      if (requestIdRef.current !== msg.requestId) return true;
      requestIdRef.current = null;
      const queued = queuedRef.current;
      queuedRef.current = null;
      if (!queued || queued.refresh) {
        if (msg.type === 'execution_detail_error') {
          setStatus('error');
          setError(msg.message);
        } else {
          setRecords((previous) =>
            msg.page.cursor === undefined || msg.page.cursor.offset === 0
              ? msg.page.records
              : [...previous, ...msg.page.records],
          );
          setUnreadable((previous) => {
            const current = msg.page.unreadable;
            if (msg.page.cursor === undefined || msg.page.cursor.offset === 0) return current;
            if (!previous) return current;
            if (!current) return previous;
            return {
              locked: previous.locked + current.locked,
              noKeys: previous.noKeys + current.noKeys,
              doesNotOpen: previous.doesNotOpen + current.doesNotOpen,
            };
          });
          nextCursorRef.current = msg.page.nextCursor;
          setComplete(msg.page.nextCursor === undefined);
          setStatus('ready');
        }
      }
      if (queued && entryIdRef.current) {
        if (queued.refresh) scheduleRefresh(entryIdRef.current);
        else readPage(entryIdRef.current, queued.cursor);
      }
      return true;
    },
    [readPage, scheduleRefresh],
  );

  return {
    openEntryId,
    executionDetailStatus: status,
    executionDetailRecords: records,
    executionDetailError: error,
    executionDetailComplete: complete,
    executionDetailMode: mode,
    executionDetailUnreadable: unreadable,
    openExecutionDetail,
    loadMoreExecutionDetail,
    showEarlierExecutionDetail,
    showLiveExecutionDetail,
    closeExecutionDetail,
    handleExecutionDetailMessage,
    handleExecutionWorkspace,
  };
}
