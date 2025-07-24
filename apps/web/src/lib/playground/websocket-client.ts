/**
 * PlaygroundWebSocketClient - Handles real-time communication for Playground
 * 
 * This client manages WebSocket connections specifically for the Playground interface,
 * handling authentication, reconnection, and message routing for real-time updates.
 */

export interface PlaygroundWebSocketMessage {
    type: 'playground_update' | 'auth' | 'ping' | 'pong';
    timestamp: string;
    data?: any;
    userId?: string;
    sessionId?: string;
}

export interface PlaygroundConnectionStatus {
    connected: boolean;
    authenticated: boolean;
    connectionId?: string;
    lastActivity?: Date;
    error?: string;
}

export type PlaygroundWebSocketEventHandler = (message: PlaygroundWebSocketMessage) => void;

/**
 * WebSocket client for Playground real-time communication
 */
export class PlaygroundWebSocketClient {
    private ws: WebSocket | null = null;
    private status: PlaygroundConnectionStatus = { connected: false, authenticated: false };
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private pingInterval: NodeJS.Timeout | null = null;
    private eventHandlers = new Map<string, Set<PlaygroundWebSocketEventHandler>>();

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
                        const authHandler = (event: any) => {
                            if (event.data.success) {
                                this.off('authenticated', authHandler);
                                connectionResolve(true);
                            } else {
                                this.off('authenticated', authHandler);
                                connectionReject(new Error(event.data.error || 'Authentication failed'));
                            }
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
                        const message: PlaygroundWebSocketMessage = JSON.parse(event.data);
                        this.handleMessage(message);
                    } catch (error) {
                        console.error('Invalid WebSocket message:', error);
                    }
                };

                this.ws.onclose = (event) => {
                    this.status.connected = false;
                    this.status.authenticated = false;
                    this.stopPingPong();

                    console.log('🔌 Playground WebSocket disconnected', event.code, event.reason);
                    this.emit('connection', { connected: false });

                    // Attempt reconnection if not intentional
                    if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
                        this.scheduleReconnect();
                    }
                };

                this.ws.onerror = (error) => {
                    console.error('🔌 Playground WebSocket error:', error);
                    this.status.error = 'Connection error';
                    this.emit('error', { error: 'Connection failed' });
                    reject(error);
                };

            } catch (error) {
                console.error('Failed to create WebSocket:', error);
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
            console.warn('Missing authentication credentials');
            return;
        }

        const authData: Omit<PlaygroundWebSocketMessage, "timestamp"> = {
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
    sendMessage(message: Omit<PlaygroundWebSocketMessage, 'timestamp'>): boolean {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('WebSocket not connected, cannot send message');
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
            console.error('Failed to send WebSocket message:', error);
            return false;
        }
    }

    /**
     * Broadcast playground update
     */
    broadcastUpdate(data: any): boolean {
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
    on(event: string, handler: PlaygroundWebSocketEventHandler): void {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, new Set());
        }
        this.eventHandlers.get(event)!.add(handler);
    }

    /**
     * Remove event listener
     */
    off(event: string, handler: PlaygroundWebSocketEventHandler): void {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            handlers.delete(handler);
        }
    }

    /**
     * Get current connection status
     */
    getStatus(): PlaygroundConnectionStatus {
        return { ...this.status };
    }

    // Private methods

    private handleMessage(message: PlaygroundWebSocketMessage): void {
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
                console.warn('Unknown message type:', message.type);
        }
    }

    private handleAuthResponse(message: PlaygroundWebSocketMessage): void {
        const { success, error, userId, sessionId, clientId, message: welcomeMessage } = message.data || {};

        // Check if this is a welcome message (not an auth response)
        if (welcomeMessage && !('success' in (message.data || {}))) {
            return; // Just ignore welcome messages
        }

        if (success) {
            this.status.authenticated = true;
            this.status.connectionId = clientId;
            this.status.error = undefined;
            console.log('✅ Playground WebSocket authenticated', { userId, sessionId });
            this.emit('authenticated', { success: true, userId, sessionId });
        } else {
            this.status.authenticated = false;
            this.status.error = error || 'Authentication failed';
            console.error('❌ Playground WebSocket authentication failed:', error);
            this.emit('authenticated', { success: false, error });
        }
    }

    private emit(event: string, data: any): void {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    handler({ type: event as any, timestamp: new Date().toISOString(), data });
                } catch (error) {
                    console.error('Error in WebSocket event handler:', error);
                }
            }
        }
    }

    private scheduleReconnect(): void {
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);

        console.log(`🔄 Scheduling WebSocket reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);

        this.reconnectTimeout = setTimeout(() => {
            this.connect().catch(error => {
                console.error('Reconnect attempt failed:', error);
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