import { useRef } from 'react';

import type { IPlaygroundState } from '../playground-reducer';
import type { IPlaygroundRefs } from './types';

export function usePlaygroundRefs(state: IPlaygroundState): IPlaygroundRefs {
  const executorRef = useRef(state.executor);
  const isInitializedRef = useRef(state.isInitialized);
  const modeRef = useRef(state.mode);
  const wsConnectedRef = useRef(state.isWebSocketConnected);
  const visualizationDataRef = useRef(state.visualizationData);
  const connectionStatusRef = useRef({
    connected: state.isWebSocketConnected,
    url: state.serverUrl,
  });

  isInitializedRef.current = state.isInitialized;
  modeRef.current = state.mode;
  wsConnectedRef.current = state.isWebSocketConnected;
  visualizationDataRef.current = state.visualizationData;
  connectionStatusRef.current = {
    connected: state.isWebSocketConnected,
    url: state.serverUrl,
  };

  return {
    executorRef,
    isInitializedRef,
    modeRef,
    wsConnectedRef,
    visualizationDataRef,
    connectionStatusRef,
  };
}
