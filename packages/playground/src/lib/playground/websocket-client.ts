/**
 * PlaygroundWebSocketClient - Handles real-time communication for Playground
 * 
 * This client manages WebSocket connections specifically for the Playground interface,
 * handling authentication, reconnection, and message routing for real-time updates.
 */

import { WebLogger } from '../web-logger';
import type { TUniversalValue } from '@robota-sdk/agents';
import type { IPlaygroundWebSocketMessage, TPlaygroundWebSocketMessageKind } from '@robota-sdk/remote';
export type { IPlaygroundWebSocketMessage, TPlaygroundWebSocketMessageKind } from '@robota-sdk/remote';

export interface IPlaygroundConnectionStatus {
    connected: boolean;
    authenticated: boolean;
    connectionId?: string;
    lastActivity?: Date;
    error?: string;
}

export interface IPlaygroundWebSocketAuthenticatedEvent {
    success: boolean;
    userId?: string;
    sessionId?: string;
    error?: string;
}

export interface IPlaygroundWebSocketConnectionEvent {
    connected: boolean;
}

export interface IPlaygroundWebSocketErrorEvent {
    error: string;
}

export type TPlaygroundWebSocketEventPayload =
    | IPlaygroundWebSocketMessage
    | IPlaygroundWebSocketAuthenticatedEvent
    | IPlaygroundWebSocketConnectionEvent
    | IPlaygroundWebSocketErrorEvent;

export type TPlaygroundWebSocketEventHandler = (payload: TPlaygroundWebSocketEventPayload) => void;

function isUniversalObjectValue(value: TUniversalValue): value is Record<string, TUniversalValue> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function isPlaygroundWebSocketMessage(value: TUniversalValue): value is IPlaygroundWebSocketMessage {
    if (!isUniversalObjectValue(value)) return false;
    const type = value.type;
    const timestamp = value.timestamp;
    if (typeof type !== 'string') return false;
    if (typeof timestamp !== 'string') return false;
    return type === 'playground_update' || type === 'auth' || type === 'ping' || type === 'pong';
}

/**
 * WebSocket client for Playground real-time communication
 */
export class PlaygroundWebSocketClient {
    private ws: WebSocket | null = null;
    private status: IPlaygroundConnectionStatus = { connected: false, authenticated: false };
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private pingInterval: NodeJS.Timeout | null = null;
    private eventHandlers = new Map<string, Set<TPlaygroundWebSocketEventHandler>>();

    constructor(
        private serverUrl: string,
        private userId?: string,
        private sessionId?: string,
        private authToken?: string
    ) { }

    /**
     * Connect to the WebSocket server
     */
    async connect(): Promise<boolean> {
        if (this.ws?.readyState === WebSocket.OPEN) {
            return true;
        }

        return new Promise((resolve, reject) => {
            try {
                const wsUrl = this.serverUrl.replace(/^http/, 'ws') + '/ws/playground';
                this.ws = new WebSocket(wsUrl);

                // Store resolve/reject for authentication completion
                const connectionResolve = resolve;
                const connectionReject = reject;

                this.ws.onopen = () => {
                    this.status.connected = true;
                    this.status.error = undefined;
                    this.reconnectAttempts = 0;

                    // Start ping/pong for connection health
                    this.startPingPong();

                    // Authenticate if credentials are available
                    if (this.userId && this.sessionId && this.authToken) {
                        this.authenticate();
                        // Don't resolve yet - wait for authentication

                        // Set up one-time authentication handler
                        const authHandler: TPlaygroundWebSocketEventHandler = (payload) => {
                            if ('type' in payload) return;
                            if (!('success' in payload) || typeof payload.success !== 'boolean') return;
                            this.off('authenticated', authHandler);
                            if (payload.success) {
                                connectionResolve(true);
                                return;
                            }
                            connectionReject(new Error(payload.error || 'Authentication failed'));
                        };
                        this.on('authenticated', authHandler);
                    } else {
                        // No authentication needed
                        connectionResolve(true);
                    }

                    this.emit('connection', { connected: true });
                };

                this.ws.onmessage = (event) => {
                    try {
                        const parsed: TUniversalValue = JSON.parse(event.data) as TUniversalValue;
                        if (!isPlaygroundWebSocketMessage(parsed)) {
                            WebLogger.error('Invalid WebSocket message', { error: 'Message shape validation failed' });
                            return;
                        }
                        this.handleMessage(parsed);
                    } catch (error) {
                        WebLogger.error('Invalid WebSocket message', { error: error instanceof Error ? error.message : String(error) });
                    }
                };

                this.ws.onclose = (event) => {
                    this.status.connected = false;
                    this.status.authenticated = false;
                    this.stopPingPong();

                    WebLogger.info('Playground WebSocket disconnected', { code: event.code, reason: event.reason });
                    this.emit('connection', { connected: false });

                    // Attempt reconnection if not intentional
                    if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
                        this.scheduleReconnect();
                    }
                };

                this.ws.onerror = (error) => {
                    WebLogger.error('Playground WebSocket error', { error: error instanceof Error ? error.message : String(error) });
                    this.status.error = 'Connection error';
                    this.emit('error', { error: 'Connection failed' });
                    reject(error);
                };

            } catch (error) {
                WebLogger.error('Failed to create WebSocket', { error: error instanceof Error ? error.message : String(error) });
                reject(error);
            }
        });
    }

    /**
     * Disconnect from the WebSocket server
     */
    disconnect(): void {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        this.stopPingPong();

        if (this.ws) {
            this.ws.close(1000, 'Client disconnect');
            this.ws = null;
        }

        this.status = { connected: false, authenticated: false };
    }

    /**
     * Send authentication message
     */
    private authenticate(): void {
        if (!this.userId || !this.sessionId || !this.authToken) {
            WebLogger.warn('Missing authentication credentials');
            return;
        }

        const authData: Omit<IPlaygroundWebSocketMessage, "timestamp"> = {
            type: 'auth',
            data: {
                userId: this.userId,
                sessionId: this.sessionId,
                token: this.authToken
            }
        };

        this.sendMessage(authData);
    }

    /**
     * Update authentication credentials
     */
    updateAuth(userId: string, sessionId: string, authToken: string): void {
        this.userId = userId;
        this.sessionId = sessionId;
        this.authToken = authToken;

        // Re-authenticate if connected
        if (this.status.connected) {
            this.authenticate();
        }
    }

    /**
     * Send a message through the WebSocket
     */
    sendMessage(message: Omit<IPlaygroundWebSocketMessage, 'timestamp'>): boolean {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            WebLogger.warn('WebSocket not connected, cannot send message');
            return false;
        }

        const messageWithTimestamp = {
            ...message,
            timestamp: new Date().toISOString()
        };

        try {
            this.ws.send(JSON.stringify(messageWithTimestamp));
            return true;
        } catch (error) {
            WebLogger.error('Failed to send WebSocket message', { error: error instanceof Error ? error.message : String(error) });
            return false;
        }
    }

    /**
     * Broadcast playground update
     */
    broadcastUpdate(data: TUniversalValue): boolean {
        return this.sendMessage({
            type: 'playground_update',
            data,
            userId: this.userId,
            sessionId: this.sessionId
        });
    }

    /**
     * Add event listener
     */
    on(event: string, handler: TPlaygroundWebSocketEventHandler): void {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, new Set());
        }
        this.eventHandlers.get(event)!.add(handler);
    }

    /**
     * Remove event listener
     */
    off(event: string, handler: TPlaygroundWebSocketEventHandler): void {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            handlers.delete(handler);
        }
    }

    /**
     * Get current connection status
     */
    getStatus(): IPlaygroundConnectionStatus {
        return { ...this.status };
    }

    // Private methods

    private handleMessage(message: IPlaygroundWebSocketMessage): void {
        this.status.lastActivity = new Date();

        switch (message.type) {
            case 'auth':
                this.handleAuthResponse(message);
                break;

            case 'pong':
                // Pong received, connection is healthy
                break;

            case 'playground_update':
                this.emit('playground_update', message);
                break;

            default:
                WebLogger.warn('Unknown WebSocket message type', { type: message.type });
        }
    }

    private handleAuthResponse(message: IPlaygroundWebSocketMessage): void {
        const data = message.data;
        if (!data || !isUniversalObjectValue(data)) {
            return;
        }

        const success = data.success;
        const error = data.error;
        const userId = data.userId;
        const sessionId = data.sessionId;
        const clientId = data.clientId;
        const welcomeMessage = data.message;

        // Check if this is a welcome message (not an auth response)
        if (welcomeMessage && typeof success !== 'boolean') {
            return; // Just ignore welcome messages
        }

        if (success === true) {
            this.status.authenticated = true;
            this.status.connectionId = typeof clientId === 'string' ? clientId : undefined;
            this.status.error = undefined;
            WebLogger.info('Playground WebSocket authenticated', {
                userId: typeof userId === 'string' ? userId : undefined,
                sessionId: typeof sessionId === 'string' ? sessionId : undefined
            });
            this.emit('authenticated', {
                success: true,
                userId: typeof userId === 'string' ? userId : undefined,
                sessionId: typeof sessionId === 'string' ? sessionId : undefined
            });
        } else {
            this.status.authenticated = false;
            this.status.error = typeof error === 'string' ? error : 'Authentication failed';
            WebLogger.error('Playground WebSocket authentication failed', { error: typeof error === 'string' ? error : 'Authentication failed' });
            this.emit('authenticated', { success: false, error: typeof error === 'string' ? error : 'Authentication failed' });
        }
    }

    private emit(event: string, data: TPlaygroundWebSocketEventPayload): void {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    handler(data);
                } catch (error) {
                    WebLogger.error('Error in WebSocket event handler', { error: error instanceof Error ? error.message : String(error) });
                }
            }
        }
    }

    private scheduleReconnect(): void {
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);

        WebLogger.info('Scheduling WebSocket reconnect', {
            attempt: this.reconnectAttempts,
            maxAttempts: this.maxReconnectAttempts,
            delayMs: delay
        });

        this.reconnectTimeout = setTimeout(() => {
            this.connect().catch(error => {
                WebLogger.error('Reconnect attempt failed', { error: error instanceof Error ? error.message : String(error) });
            });
        }, delay);
    }

    private startPingPong(): void {
        this.pingInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.sendMessage({ type: 'ping' });
            }
        }, 30000); // Ping every 30 seconds
    }

    private stopPingPong(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }
} 