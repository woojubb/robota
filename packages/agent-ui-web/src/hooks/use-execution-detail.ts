/**
 * #3288 §1: the detail sheet's own correlated request/response state — which entry is open, its
 * accumulated transcript records, and whether more can be loaded. Owned independently from chat
 * state, the same way `use-personal-usage.ts` owns the usage-report protocol: one `requestId` per
 * outstanding read, so a stale reply for an entry the operator already closed (or a page they moved
 * past) is dropped rather than clobbering what is now on screen.
 */

import { useCallback, useRef, useState } from 'react';

import type { TClientMessage } from '../client/ws-session-client.js';
import type {
  IExecutionDetailCursor,
  IExecutionDetailRecord,
} from '@robota-sdk/agent-interface-execution';
import type { TServerMessage } from '@robota-sdk/agent-transport';

export type TExecutionDetailStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface IExecutionDetailState {
  /** The entry currently open in the detail sheet, or null when it is closed. */
  openEntryId: string | null;
  executionDetailStatus: TExecutionDetailStatus;
  /** Every record read so far for the open entry, oldest first — pages accumulate via loadMoreExecutionDetail. */
  executionDetailRecords: readonly IExecutionDetailRecord[];
  executionDetailError: string | null;
  /** True once a page came back with no `nextCursor` — nothing more to load. */
  executionDetailComplete: boolean;
  openExecutionDetail: (entryId: string) => void;
  loadMoreExecutionDetail: () => void;
  closeExecutionDetail: () => void;
}

let requestCounter = 0;
function nextRequestId(): string {
  requestCounter += 1;
  return `execdetail_${requestCounter}_${Date.now()}`;
}

export function useExecutionDetailState(
  send: (msg: TClientMessage) => void,
): IExecutionDetailState & { handleExecutionDetailMessage: (msg: TServerMessage) => boolean } {
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [status, setStatus] = useState<TExecutionDetailStatus>('idle');
  const [records, setRecords] = useState<readonly IExecutionDetailRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const requestIdRef = useRef<string | null>(null);
  const entryIdRef = useRef<string | null>(null);
  const nextCursorRef = useRef<IExecutionDetailCursor | undefined>(undefined);

  const readPage = useCallback(
    (entryId: string, cursor?: IExecutionDetailCursor): void => {
      const requestId = nextRequestId();
      requestIdRef.current = requestId;
      entryIdRef.current = entryId;
      setStatus('loading');
      setError(null);
      send({ type: 'read-execution-detail', requestId, entryId, cursor });
    },
    [send],
  );

  const openExecutionDetail = useCallback(
    (entryId: string): void => {
      setOpenEntryId(entryId);
      setRecords([]);
      setComplete(false);
      nextCursorRef.current = undefined;
      readPage(entryId);
    },
    [readPage],
  );

  const loadMoreExecutionDetail = useCallback((): void => {
    if (!openEntryId || status === 'loading' || complete) return;
    readPage(openEntryId, nextCursorRef.current);
  }, [openEntryId, status, complete, readPage]);

  const closeExecutionDetail = useCallback((): void => {
    setOpenEntryId(null);
    requestIdRef.current = null;
    entryIdRef.current = null;
    setRecords([]);
    setStatus('idle');
    setError(null);
    setComplete(false);
  }, []);

  const handleExecutionDetailMessage = useCallback((msg: TServerMessage): boolean => {
    if (msg.type !== 'execution_detail' && msg.type !== 'execution_detail_error') return false;
    if (requestIdRef.current !== msg.requestId) return true; // A stale/superseded read — ignored.
    if (msg.type === 'execution_detail_error') {
      setStatus('error');
      setError(msg.message);
      return true;
    }
    setRecords((previous) =>
      msg.page.cursor === undefined ? msg.page.records : [...previous, ...msg.page.records],
    );
    nextCursorRef.current = msg.page.nextCursor;
    setComplete(msg.page.nextCursor === undefined);
    setStatus('ready');
    return true;
  }, []);

  return {
    openEntryId,
    executionDetailStatus: status,
    executionDetailRecords: records,
    executionDetailError: error,
    executionDetailComplete: complete,
    openExecutionDetail,
    loadMoreExecutionDetail,
    closeExecutionDetail,
    handleExecutionDetailMessage,
  };
}
