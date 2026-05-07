'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TUniversalValue } from '@robota-sdk/agent-core';
import { usePlaygroundActions, usePlaygroundState } from '../../contexts/playground-context';
import { PLAYGROUND_WS_MESSAGE_TYPES } from '../../lib/playground/websocket-client';
import {
  DEFAULT_MAX_RECONNECT_ATTEMPTS,
  DEFAULT_RECONNECT_INTERVAL_MS,
  PING_MAX_EXTRA_LATENCY_MS,
  PING_MIN_LATENCY_MS,
  PING_TIMEOUT_MS,
} from './constants';
import {
  buildConnectionHealth,
  calculateAverageConnectionTime,
  calculateConnectionDuration,
  calculateReconnectDelay,
  createInitialConnectionInfo,
  createInitialConnectionStatistics,
} from './connection-state';
import { notifyHandlers, registerHandler } from './handler-registry';
import { useConnectionUptime } from './use-connection-uptime';
import type {
  IConnectionInfo,
  IConnectionStatistics,
  IWebSocketAuth,
  IWebSocketConnectionHookReturn,
  TConnectionState,
} from './types';

export function useWebSocketConnection(): IWebSocketConnectionHookReturn {
  const state = usePlaygroundState();
  const { getConnectionStatus, setAuth } = usePlaygroundActions();

  const [connectionState, setConnectionState] = useState<TConnectionState>('disconnected');
  const [connectionInfo, setConnectionInfo] = useState<IConnectionInfo>(
    createInitialConnectionInfo,
  );
  const [statistics, setStatistics] = useState<IConnectionStatistics>(
    createInitialConnectionStatistics,
  );
  const [autoReconnect, setAutoReconnect] = useState(true);
  const [reconnectInterval, setReconnectInterval] = useState(DEFAULT_RECONNECT_INTERVAL_MS);
  const [maxReconnectAttempts, setMaxReconnectAttempts] = useState(DEFAULT_MAX_RECONNECT_ATTEMPTS);

  const websocketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectionStartTimeRef = useRef<Date | null>(null);
  const uptimeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const scheduleReconnectRef = useRef<() => void>(() => undefined);

  const messageHandlers = useRef<Set<(message: TUniversalValue) => void>>(new Set());
  const connectionHandlers = useRef<Set<(state: TConnectionState) => void>>(new Set());
  const errorHandlers = useRef<Set<(error: Error) => void>>(new Set());

  const isConnected = connectionState === 'connected';
  const isConnecting = connectionState === 'connecting' || connectionState === 'reconnecting';
  const canConnect = !isConnecting && connectionState !== 'connected';

  useEffect(() => {
    const playgroundConnectionStatus = getConnectionStatus();

    if (playgroundConnectionStatus.connected && connectionState !== 'connected') {
      setConnectionState('connected');
    } else if (!playgroundConnectionStatus.connected && connectionState === 'connected') {
      setConnectionState('disconnected');
    }

    setConnectionInfo((prev) => ({
      ...prev,
      url: playgroundConnectionStatus.url,
      connected: playgroundConnectionStatus.connected,
    }));
  }, [getConnectionStatus, connectionState]);

  useConnectionUptime({
    isConnected,
    connectionStartTimeRef,
    uptimeIntervalRef,
    setConnectionInfo,
  });

  const connect = useCallback(
    async (url?: string, auth?: IWebSocketAuth): Promise<void> => {
      if (isConnecting || isConnected) {
        return;
      }

      try {
        setConnectionState('connecting');
        setConnectionInfo((prev) => ({
          ...prev,
          connectionAttempts: prev.connectionAttempts + 1,
        }));

        const connectionUrl = url || state.serverUrl;
        if (!connectionUrl) {
          throw new Error('No server URL provided');
        }

        if (auth) {
          setAuth(auth.userId, auth.sessionId, auth.authToken);
        }

        connectionStartTimeRef.current = new Date();
        setConnectionState('connected');
        setConnectionInfo((prev) => ({
          ...prev,
          state: 'connected',
          connected: true,
          lastConnected: new Date(),
          url: connectionUrl,
        }));
        setStatistics((prev) => ({
          ...prev,
          totalConnections: prev.totalConnections + 1,
        }));
        notifyHandlers(connectionHandlers.current, 'connected');
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        setConnectionState('error');
        setStatistics((prev) => ({ ...prev, lastError: err }));
        notifyHandlers(errorHandlers.current, err);

        if (autoReconnect && connectionInfo.connectionAttempts < maxReconnectAttempts) {
          scheduleReconnectRef.current();
        }

        throw err;
      }
    },
    [
      autoReconnect,
      connectionInfo.connectionAttempts,
      isConnected,
      isConnecting,
      maxReconnectAttempts,
      setAuth,
      state.serverUrl,
    ],
  );

  const disconnect = useCallback(() => {
    if (websocketRef.current) {
      websocketRef.current.close();
      websocketRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const disconnectTime = new Date();
    const connectionDuration = calculateConnectionDuration(
      connectionStartTimeRef.current,
      disconnectTime,
    );

    setConnectionState('disconnected');
    setConnectionInfo((prev) => ({
      ...prev,
      state: 'disconnected',
      connected: false,
      lastDisconnected: disconnectTime,
      uptime: 0,
    }));
    setStatistics((prev) => ({
      ...prev,
      totalDisconnections: prev.totalDisconnections + 1,
      longestConnection: Math.max(prev.longestConnection, connectionDuration),
      averageConnectionTime: calculateAverageConnectionTime(prev, connectionDuration),
    }));
    connectionStartTimeRef.current = null;
    notifyHandlers(connectionHandlers.current, 'disconnected');
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    setConnectionState('reconnecting');
    reconnectTimeoutRef.current = setTimeout(
      async () => {
        try {
          await connect();
          setStatistics((prev) => ({
            ...prev,
            totalReconnections: prev.totalReconnections + 1,
          }));
        } catch (error) {
          // Reconnection failed, will retry if attempts remaining.
        }
      },
      calculateReconnectDelay(reconnectInterval, connectionInfo.connectionAttempts),
    );
  }, [connect, connectionInfo.connectionAttempts, reconnectInterval]);

  scheduleReconnectRef.current = scheduleReconnect;

  const reconnect = useCallback(async (): Promise<void> => {
    disconnect();
    await connect();
  }, [connect, disconnect]);

  const sendMessage = useCallback(
    (message: TUniversalValue): boolean => {
      if (!isConnected || !websocketRef.current) {
        return false;
      }

      try {
        websocketRef.current.send(JSON.stringify(message));
        setStatistics((prev) => ({ ...prev, messagesSent: prev.messagesSent + 1 }));
        return true;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        setStatistics((prev) => ({ ...prev, lastError: err }));
        notifyHandlers(errorHandlers.current, err);
        return false;
      }
    },
    [isConnected],
  );

  const onMessage = useCallback((handler: (message: TUniversalValue) => void) => {
    return registerHandler(messageHandlers.current, handler);
  }, []);

  const onConnectionChange = useCallback((handler: (state: TConnectionState) => void) => {
    return registerHandler(connectionHandlers.current, handler);
  }, []);

  const onError = useCallback((handler: (error: Error) => void) => {
    return registerHandler(errorHandlers.current, handler);
  }, []);

  const ping = useCallback(async (): Promise<number> => {
    if (!isConnected) {
      throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const handlePong = () => {
        resolve(Date.now() - startTime);
      };

      pingTimeoutRef.current = setTimeout(() => {
        reject(new Error('Ping timeout'));
      }, PING_TIMEOUT_MS);

      if (sendMessage({ type: PLAYGROUND_WS_MESSAGE_TYPES.PING, timestamp: startTime })) {
        setTimeout(handlePong, PING_MIN_LATENCY_MS + Math.random() * PING_MAX_EXTRA_LATENCY_MS);
      } else {
        reject(new Error('Failed to send ping'));
      }
    });
  }, [isConnected, sendMessage]);

  const getConnectionHealth = useCallback(() => {
    return buildConnectionHealth(isConnected, statistics, connectionInfo);
  }, [connectionInfo, isConnected, statistics]);

  useEffect(() => {
    return () => {
      disconnect();
      if (pingTimeoutRef.current) {
        clearTimeout(pingTimeoutRef.current);
      }
    };
  }, [disconnect]);

  return {
    connectionState,
    connectionInfo,
    isConnected,
    isConnecting,
    canConnect,
    statistics,
    connect,
    disconnect,
    reconnect,
    sendMessage,
    setAutoReconnect,
    setReconnectInterval: (intervalMs: number) => setReconnectInterval(intervalMs),
    setMaxReconnectAttempts: (attempts: number) => setMaxReconnectAttempts(attempts),
    onMessage,
    onConnectionChange,
    onError,
    ping,
    getConnectionHealth,
  };
}
