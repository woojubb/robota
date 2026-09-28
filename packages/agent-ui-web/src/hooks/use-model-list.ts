import { useCallback, useRef, useState } from 'react';

import type { IWsSessionState, TModelListSnapshot } from './session-client-types.js';
import type { TClientMessage } from '../client/ws-session-client.js';
import type { TServerMessage } from '@robota-sdk/agent-transport';

type TModelListState = Pick<IWsSessionState, 'modelList' | 'requestModelList'>;

let requestCounter = 0;
function nextRequestId(): string {
  requestCounter += 1;
  return `model_list_${requestCounter}_${Date.now()}`;
}

/**
 * #3282 §2 (part 2) — the model list the model control's pop-up menu is built from, requested on
 * demand (`list-models`) and correlated by `requestId` (mirrors `usePersonalUsageState`'s pattern) so
 * a reply to an older request — one already superseded by a newer one, e.g. across a reconnect — is
 * never applied over the list a still-open menu is currently showing.
 */
export function useModelListState(send: (msg: TClientMessage) => void): TModelListState & {
  handleModelListMessage: (msg: TServerMessage) => boolean;
} {
  const [modelList, setModelList] = useState<TModelListSnapshot | null>(null);
  const requestRef = useRef<string | null>(null);

  const handleModelListMessage = useCallback((msg: TServerMessage): boolean => {
    if (msg.type !== 'model_list') return false;
    if (requestRef.current !== msg.requestId) return true;
    setModelList({
      groups: msg.groups,
      currentModel: msg.currentModel,
      ...(msg.currentProfile !== undefined ? { currentProfile: msg.currentProfile } : {}),
    });
    return true;
  }, []);

  const requestModelList = useCallback((): void => {
    const requestId = nextRequestId();
    requestRef.current = requestId;
    send({ type: 'list-models', requestId });
  }, [send]);

  return { modelList, requestModelList, handleModelListMessage };
}
