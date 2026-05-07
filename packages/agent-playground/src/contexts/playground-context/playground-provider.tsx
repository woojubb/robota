'use client';

import { SilentLogger } from '@robota-sdk/agent-core';
import { useReducer } from 'react';

import { initialState, playgroundReducer } from '../playground-reducer';
import {
  useExecutorDisposal,
  useExecutorInitialization,
  useWebSocketConnectionMonitor,
} from './executor-lifecycle';
import { usePlaygroundRefs } from './playground-refs';
import { PlaygroundActionsContext, PlaygroundStateContext } from './react-contexts';
import { usePlaygroundContextActions } from './use-playground-context-actions';
import type { IPlaygroundProviderProps } from './types';

export function PlaygroundProvider({ children, defaultServerUrl = '' }: IPlaygroundProviderProps) {
  const logger = SilentLogger;
  const [state, dispatch] = useReducer(playgroundReducer, defaultServerUrl, (url) => ({
    ...initialState,
    serverUrl: url,
  }));
  const refs = usePlaygroundRefs(state);

  useExecutorInitialization({
    defaultServerUrl,
    stateExecutor: state.executor,
    dispatch,
    executorRef: refs.executorRef,
    logger,
  });
  useWebSocketConnectionMonitor(state.executor, refs.wsConnectedRef, dispatch);
  useExecutorDisposal(refs.executorRef, logger);

  const actionsValue = usePlaygroundContextActions(refs, dispatch, logger);

  return (
    <PlaygroundStateContext.Provider value={state}>
      <PlaygroundActionsContext.Provider value={actionsValue}>
        {children}
      </PlaygroundActionsContext.Provider>
    </PlaygroundStateContext.Provider>
  );
}
