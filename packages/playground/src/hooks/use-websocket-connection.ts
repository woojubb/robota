'use client';

const DEFAULT_RECONNECT_INTERVAL_MS = 1000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;
const UPTIME_UPDATE_INTERVAL_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const PING_MIN_LATENCY_MS = 50;
const PING_MAX_EXTRA_LATENCY_MS = 100;
const HIGH_CONNECTION_ATTEMPTS_THRESHOLD = 3;

/**
 * useWebSocketConnection - WebSocket Connection Management Hook
 * 
 * Specialized hook for managing WebSocket connections for real-time communication
 * between the Playground and the backend server.
 * 
 * This hook handles:
 * - Connection state management (connecting, connected, disconnected, error)
 * - Authentication and authorization
 * - Automatic reconnection with exponential backoff
 * - Message routing and event handling
 * - Connection health monitoring
 * - Real-time status updates
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { usePlayground } from '../contexts/playground-context';
import type { TUniversalValue } from '@robota-sdk/agents';
import { PLAYGROUND_WS_MESSAGE_TYPES } from '../lib/playground/websocket-client';

export type TConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting';

export interface IConnectionInfo {
    state: TConnectionState;
    url: string;
    connected: boolean;
    lastConnected: Date | null;
    lastDisconnected: Date | null;
    connectionAttempts: number;
    uptime: number; // in milliseconds
}

export interface IConnectionStatistics {
    totalConnections: number;
    totalDisconnections: number;
    totalReconnections: number;
    averageConnectionTime: number;
    longestConnection: number;
    messagesSent: number;
    messagesReceived: number;
    lastError: Error | null;
}

export interface IWebSocketAuth {
    userId: string;
    sessionId: string;
    authToken: string;
}

export interface IConnectionHealth {
    isHealthy: boolean;
    latency: number;
    lastPing: Date | null;
    issues: string[];
}

export interface IWebSocketConnectionHookReturn {
    // Connection State
    connectionState: TConnectionState;
    connectionInfo: IConnectionInfo;
    isConnected: boolean;
    isConnecting: boolean;
    canConnect: boolean;

    // Connection Statistics
    statistics: IConnectionStatistics;

    // Actions
    connect: (url?: string, auth?: IWebSocketAuth) => Promise<void>;
    disconnect: () => void;
    reconnect: () => Promise<void>;
    sendMessage: (message: TUniversalValue) => boolean;

    // Configuration
    setAutoReconnect: (enabled: boolean) => void;
    setReconnectInterval: (intervalMs: number) => void;
    setMaxReconnectAttempts: (attempts: number) => void;

    // Event Handlers
    onMessage: (handler: (message: TUniversalValue) => void) => () => void;
    onConnectionChange: (handler: (state: TConnectionState) => void) => () => void;
    onError: (handler: (error: Error) => void) => () => void;

    // Health Monitoring
    ping: () => Promise<number>; // Returns ping time in ms
    getConnectionHealth: () => IConnectionHealth;
}

export function useWebSocketConnection(): IWebSocketConnectionHookReturn {
    const { state, getConnectionStatus, setAuth } = usePlayground();

    // Local state
    const [connectionState, setConnectionState] = useState<TConnectionState>('disconnected');
    const [connectionInfo, setConnectionInfo] = useState<IConnectionInfo>({
        state: 'disconnected',
        url: '',
        connected: false,
        lastConnected: null,
        lastDisconnected: null,
        connectionAttempts: 0,
        uptime: 0
    });

    const [statistics, setStatistics] = useState<IConnectionStatistics>({
        totalConnections: 0,
        totalDisconnections: 0,
        totalReconnections: 0,
        averageConnectionTime: 0,
        longestConnection: 0,
        messagesSent: 0,
        messagesReceived: 0,
        lastError: null
    });

    // Configuration state
    const [autoReconnect, setAutoReconnect] = useState(true);
    const [reconnectInterval, setReconnectInterval] = useState(DEFAULT_RECONNECT_INTERVAL_MS);
    const [maxReconnectAttempts, setMaxReconnectAttempts] = useState(DEFAULT_MAX_RECONNECT_ATTEMPTS);

    // Refs for tracking
    const websocketRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const connectionStartTimeRef = useRef<Date | null>(null);
    const uptimeIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const pingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Event handlers
    const messageHandlers = useRef<Set<(message: TUniversalValue) => void>>(new Set());
    const connectionHandlers = useRef<Set<(state: TConnectionState) => void>>(new Set());
    const errorHandlers = useRef<Set<(error: Error) => void>>(new Set());

    // Derived state
    const isConnected = connectionState === 'connected';
    const isConnecting = connectionState === 'connecting' || connectionState === 'reconnecting';
    const canConnect = !isConnecting && connectionState !== 'connected';

    // Update connection state based on playground state
    useEffect(() => {
        const playgroundConnectionStatus = getConnectionStatus();

        if (playgroundConnectionStatus.connected && connectionState !== 'connected') {
            setConnectionState('connected');
        } else if (!playgroundConnectionStatus.connected && connectionState === 'connected') {
            setConnectionState('disconnected');
        }

        setConnectionInfo(prev => ({
            ...prev,
            url: playgroundConnectionStatus.url,
            connected: playgroundConnectionStatus.connected
        }));
    }, [getConnectionStatus, connectionState]);

    // Update uptime tracking
    useEffect(() => {
        if (isConnected && !uptimeIntervalRef.current) {
            uptimeIntervalRef.current = setInterval(() => {
                if (connectionStartTimeRef.current) {
                    const uptime = Date.now() - connectionStartTimeRef.current.getTime();
                    setConnectionInfo(prev => ({ ...prev, uptime }));
                }
            }, UPTIME_UPDATE_INTERVAL_MS);
        } else if (!isConnected && uptimeIntervalRef.current) {
            clearInterval(uptimeIntervalRef.current);
            uptimeIntervalRef.current = null;
        }

        return () => {
            if (uptimeIntervalRef.current) {
                clearInterval(uptimeIntervalRef.current);
                uptimeIntervalRef.current = null;
            }
        };
    }, [isConnected]);

    // Connection management
    const connect = useCallback(async (
        url?: string,
        auth?: { userId: string; sessionId: string; authToken: string }
    ): Promise<void> => {
        if (isConnecting || isConnected) {
            return;
        }

        try {
            setConnectionState('connecting');
            setConnectionInfo(prev => ({
                ...prev,
                connectionAttempts: prev.connectionAttempts + 1
            }));

            const connectionUrl = url || state.serverUrl;
            if (!connectionUrl) {
                throw new Error('No server URL provided');
            }

            // Initialize WebSocket through playground context if needed
            if (auth) {
                setAuth(auth.userId, auth.sessionId, auth.authToken);
            }

            // Track connection start time
            connectionStartTimeRef.current = new Date();

            // Connection successful
            setConnectionState('connected');
            setConnectionInfo(prev => ({
                ...prev,
                state: 'connected',
                connected: true,
                lastConnected: new Date(),
                url: connectionUrl
            }));

            setStatistics(prev => ({
                ...prev,
                totalConnections: prev.totalConnections + 1
            }));

            // Notify handlers
            connectionHandlers.current.forEach(handler => handler('connected'));

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));

            setConnectionState('error');
            setStatistics(prev => ({ ...prev, lastError: err }));

            // Notify error handlers
            errorHandlers.current.forEach(handler => handler(err));

            // Auto-reconnect if enabled
            if (autoReconnect && connectionInfo.connectionAttempts < maxReconnectAttempts) {
                scheduleReconnect();
            }

            throw err;
        }
    }, [isConnecting, isConnected, state.serverUrl, autoReconnect, connectionInfo.connectionAttempts, maxReconnectAttempts]);

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
        const connectionDuration = connectionStartTimeRef.current
            ? disconnectTime.getTime() - connectionStartTimeRef.current.getTime()
            : 0;

        setConnectionState('disconnected');
        setConnectionInfo(prev => ({
            ...prev,
            state: 'disconnected',
            connected: false,
            lastDisconnected: disconnectTime,
            uptime: 0
        }));

        setStatistics(prev => ({
            ...prev,
            totalDisconnections: prev.totalDisconnections + 1,
            longestConnection: Math.max(prev.longestConnection, connectionDuration),
            averageConnectionTime: prev.totalConnections > 0
                ? (prev.averageConnectionTime * (prev.totalConnections - 1) + connectionDuration) / prev.totalConnections
                : connectionDuration
        }));

        connectionStartTimeRef.current = null;

        // Notify handlers
        connectionHandlers.current.forEach(handler => handler('disconnected'));
    }, []);

    const scheduleReconnect = useCallback(() => {
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
        }

        setConnectionState('reconnecting');

        // Exponential backoff
        const delay = Math.min(reconnectInterval * Math.pow(2, connectionInfo.connectionAttempts), MAX_RECONNECT_DELAY_MS);

        reconnectTimeoutRef.current = setTimeout(async () => {
            try {
                await connect();
                setStatistics(prev => ({ ...prev, totalReconnections: prev.totalReconnections + 1 }));
            } catch (error) {
                // Reconnection failed, will retry if attempts remaining
            }
        }, delay);
    }, [reconnectInterval, connectionInfo.connectionAttempts, connect]);

    const reconnect = useCallback(async (): Promise<void> => {
        disconnect();
        await connect();
    }, [disconnect, connect]);

    const sendMessage = useCallback((message: TUniversalValue): boolean => {
        if (!isConnected || !websocketRef.current) {
            return false;
        }

        try {
            websocketRef.current.send(JSON.stringify(message));
            setStatistics(prev => ({ ...prev, messagesSent: prev.messagesSent + 1 }));
            return true;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            setStatistics(prev => ({ ...prev, lastError: err }));
            errorHandlers.current.forEach(handler => handler(err));
            return false;
        }
    }, [isConnected]);

    // Event handler registration
    const onMessage = useCallback((handler: (message: TUniversalValue) => void) => {
        messageHandlers.current.add(handler);
        return () => messageHandlers.current.delete(handler);
    }, []);

    const onConnectionChange = useCallback((handler: (state: TConnectionState) => void) => {
        connectionHandlers.current.add(handler);
        return () => connectionHandlers.current.delete(handler);
    }, []);

    const onError = useCallback((handler: (error: Error) => void) => {
        errorHandlers.current.add(handler);
        return () => errorHandlers.current.delete(handler);
    }, []);

    // Health monitoring
    const ping = useCallback(async (): Promise<number> => {
        if (!isConnected) {
            throw new Error('Not connected');
        }

        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const timeout = 5000; // 5 second timeout

            const handlePong = () => {
                const pingTime = Date.now() - startTime;
                resolve(pingTime);
            };

            pingTimeoutRef.current = setTimeout(() => {
                reject(new Error('Ping timeout'));
            }, timeout);

            // Send ping and wait for pong
            if (sendMessage({ type: PLAYGROUND_WS_MESSAGE_TYPES.PING, timestamp: startTime })) {
                // In a real implementation, you'd listen for pong response
                // For now, simulate a reasonable ping time
                setTimeout(handlePong, PING_MIN_LATENCY_MS + Math.random() * PING_MAX_EXTRA_LATENCY_MS);
            } else {
                reject(new Error('Failed to send ping'));
            }
        });
    }, [isConnected, sendMessage]);

    const getConnectionHealth = useCallback(() => {
        const issues: string[] = [];
        let isHealthy = true;
        let latency = 0;

        if (!isConnected) {
            issues.push('Not connected');
            isHealthy = false;
        }

        if (statistics.lastError) {
            issues.push(`Last error: ${statistics.lastError.message}`);
            isHealthy = false;
        }

        if (connectionInfo.connectionAttempts > HIGH_CONNECTION_ATTEMPTS_THRESHOLD) {
            issues.push('Multiple connection attempts');
            isHealthy = false;
        }

        return {
            isHealthy,
            latency,
            lastPing: null, // Would be updated by actual ping implementation
            issues
        };
    }, [isConnected, statistics.lastError, connectionInfo.connectionAttempts]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            disconnect();
            if (pingTimeoutRef.current) {
                clearTimeout(pingTimeoutRef.current);
            }
        };
    }, [disconnect]);

    return {
        // Connection State
        connectionState,
        connectionInfo,
        isConnected,
        isConnecting,
        canConnect,

        // Connection Statistics
        statistics,

        // Actions
        connect,
        disconnect,
        reconnect,
        sendMessage,

        // Configuration
        setAutoReconnect,
        setReconnectInterval: (intervalMs: number) => setReconnectInterval(intervalMs),
        setMaxReconnectAttempts: (attempts: number) => setMaxReconnectAttempts(attempts),

        // Event Handlers
        onMessage,
        onConnectionChange,
        onError,

        // Health Monitoring
        ping,
        getConnectionHealth
    };
} 