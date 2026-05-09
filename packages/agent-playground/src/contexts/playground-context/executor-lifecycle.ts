import type { ILogger } from '@robota-sdk/agent-core';
import { DefaultEventService } from '@robota-sdk/agent-event-service';
import { useEffect } from 'react';

import { PlaygroundExecutor } from '../../lib/playground/robota-executor';
import { WS_CHECK_INTERVAL_MS } from './constants';
import type { IPlaygroundRefs, TPlaygroundDispatch } from './types';

interface IExecutorInitializationOptions {
  defaultServerUrl: string;
  stateExecutor: PlaygroundExecutor | null;
  dispatch: TPlaygroundDispatch;
  executorRef: IPlaygroundRefs['executorRef'];
  logger: ILogger;
}

export function useExecutorInitialization({
  defaultServerUrl,
  stateExecutor,
  dispatch,
  executorRef,
  logger,
}: IExecutorInitializationOptions): void {
  useEffect(() => {
    if (stateExecutor || !defaultServerUrl) return;
    try {
      const eventService = new DefaultEventService();
      const executor = new PlaygroundExecutor(defaultServerUrl, 'dev.playground.token', {
        logger,
        eventService,
      });
      dispatch({ type: 'SET_INITIALIZED', payload: true });
      dispatch({ type: 'SET_EXECUTOR', payload: executor });
      executorRef.current = executor;
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        payload: error instanceof Error ? error.message : 'Failed to create executor',
      });
    }
  }, [defaultServerUrl, dispatch, executorRef, logger, stateExecutor]);
}

export function useWebSocketConnectionMonitor(
  stateExecutor: PlaygroundExecutor | null,
  wsConnectedRef: IPlaygroundRefs['wsConnectedRef'],
  dispatch: TPlaygroundDispatch,
): void {
  useEffect(() => {
    if (!stateExecutor) return;
    const checkConnection = () => {
      const isConnected = stateExecutor.isWebSocketConnected();
      if (isConnected !== wsConnectedRef.current) {
        dispatch({ type: 'SET_WEBSOCKET_CONNECTED', payload: isConnected });
      }
    };
    const interval = setInterval(checkConnection, WS_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [dispatch, stateExecutor, wsConnectedRef]);
}

export function useExecutorDisposal(
  executorRef: IPlaygroundRefs['executorRef'],
  logger: ILogger,
): void {
  useEffect(() => {
    return () => {
      if (!executorRef.current) return;
      executorRef.current.dispose().catch((error) => {
        logger.error('Executor dispose failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    };
  }, [executorRef, logger]);
}
