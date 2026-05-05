import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWebSocketConnection } from '../use-websocket-connection';

const playgroundContext = vi.hoisted(() => ({
  state: {
    serverUrl: 'https://playground.example.test',
  },
  connectionStatus: {
    connected: false,
    url: 'https://playground.example.test',
  },
  getConnectionStatus: vi.fn(),
  setAuth: vi.fn(),
}));

vi.mock('../../contexts/playground-context', () => ({
  usePlaygroundState: () => playgroundContext.state,
  usePlaygroundActions: () => ({
    getConnectionStatus: playgroundContext.getConnectionStatus,
    setAuth: playgroundContext.setAuth,
  }),
}));

describe('useWebSocketConnection', () => {
  beforeEach(() => {
    playgroundContext.state.serverUrl = 'https://playground.example.test';
    playgroundContext.connectionStatus = {
      connected: false,
      url: 'https://playground.example.test',
    };
    playgroundContext.getConnectionStatus.mockImplementation(() => ({
      ...playgroundContext.connectionStatus,
    }));
    playgroundContext.setAuth.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects with the playground server URL and notifies connection handlers', async () => {
    const connectionHandler = vi.fn();
    const { result } = renderHook(() => useWebSocketConnection());

    act(() => {
      result.current.onConnectionChange(connectionHandler);
      playgroundContext.connectionStatus = {
        connected: true,
        url: 'https://playground.example.test',
      };
    });

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.connectionState).toBe('connected');
    expect(result.current.connectionInfo).toMatchObject({
      state: 'connected',
      connected: true,
      url: 'https://playground.example.test',
      connectionAttempts: 1,
    });
    expect(result.current.statistics.totalConnections).toBe(1);
    expect(connectionHandler).toHaveBeenCalledWith('connected');
  });

  it('applies explicit auth and URL during connect', async () => {
    const { result } = renderHook(() => useWebSocketConnection());

    act(() => {
      playgroundContext.connectionStatus = {
        connected: true,
        url: 'https://custom.example.test',
      };
    });

    await act(async () => {
      await result.current.connect('https://custom.example.test', {
        userId: 'user-1',
        sessionId: 'session-1',
        authToken: 'token-1',
      });
    });

    expect(playgroundContext.setAuth).toHaveBeenCalledWith('user-1', 'session-1', 'token-1');
    expect(result.current.connectionInfo.url).toBe('https://custom.example.test');
  });

  it('records disconnect statistics from the active connection duration', async () => {
    vi.useFakeTimers();
    const startTime = new Date('2026-05-05T00:00:00.000Z');
    const disconnectTime = new Date(startTime.getTime() + 2500);
    vi.setSystemTime(startTime);

    const { result } = renderHook(() => useWebSocketConnection());

    await act(async () => {
      await result.current.connect();
    });

    vi.setSystemTime(disconnectTime);

    act(() => {
      result.current.disconnect();
    });

    expect(result.current.connectionState).toBe('disconnected');
    expect(result.current.connectionInfo).toMatchObject({
      state: 'disconnected',
      connected: false,
      uptime: 0,
    });
    expect(result.current.statistics).toMatchObject({
      totalConnections: 1,
      totalDisconnections: 1,
      longestConnection: 2500,
      averageConnectionTime: 2500,
    });
  });

  it('keeps logical connection state separate from WebSocket send availability', async () => {
    const { result } = renderHook(() => useWebSocketConnection());

    act(() => {
      playgroundContext.connectionStatus = {
        connected: true,
        url: 'https://playground.example.test',
      };
    });

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.sendMessage({ type: 'example' })).toBe(false);
    expect(result.current.statistics.messagesSent).toBe(0);
  });

  it('surfaces connection errors when no server URL exists', async () => {
    playgroundContext.state.serverUrl = '';
    playgroundContext.connectionStatus = {
      connected: false,
      url: '',
    };
    const errorHandler = vi.fn();
    const { result } = renderHook(() => useWebSocketConnection());

    act(() => {
      result.current.setAutoReconnect(false);
      result.current.onError(errorHandler);
    });

    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.connect();
      } catch (error) {
        thrown = error;
      }
    });

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('No server URL provided');
    expect(result.current.connectionState).toBe('error');
    expect(result.current.statistics.lastError?.message).toBe('No server URL provided');
    expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
  });

  it('reports health from current connection state and errors', async () => {
    const { result } = renderHook(() => useWebSocketConnection());

    expect(result.current.getConnectionHealth()).toEqual({
      isHealthy: false,
      latency: 0,
      lastPing: null,
      issues: ['Not connected'],
    });

    act(() => {
      playgroundContext.connectionStatus = {
        connected: true,
        url: 'https://playground.example.test',
      };
    });

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.getConnectionHealth()).toEqual({
      isHealthy: true,
      latency: 0,
      lastPing: null,
      issues: [],
    });
  });

  it('rejects ping while disconnected', async () => {
    const { result } = renderHook(() => useWebSocketConnection());

    await expect(result.current.ping()).rejects.toThrow('Not connected');
  });

  it('unregisters connection handlers', async () => {
    const connectionHandler = vi.fn();
    const { result } = renderHook(() => useWebSocketConnection());

    let unregister = () => false;
    act(() => {
      unregister = result.current.onConnectionChange(connectionHandler);
      unregister();
    });

    await act(async () => {
      await result.current.connect();
    });

    expect(connectionHandler).not.toHaveBeenCalled();
  });
});
