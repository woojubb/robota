import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { Server } from 'http';

export interface PlaygroundWebSocketMessage {
    type: 'playground_update' | 'auth' | 'ping' | 'pong';
    timestamp: string;
    data?: any;
    userId?: string;
    sessionId?: string;
}

export interface PlaygroundClient {
    id: string;
    userId?: string;
    sessionId?: string;
    ws: WebSocket;
    lastActivity: Date;
    isAuthenticated: boolean;
}

/**
 * WebSocket Server for Playground real-time communication
 * Handles authentication, message routing, and connection management
 */
export class PlaygroundWebSocketServer {
    private wss: WebSocketServer;
    private clients = new Map<string, PlaygroundClient>();
    private userSessions = new Map<string, Set<string>>(); // userId -> Set<clientId>

    constructor(server: Server) {
        this.wss = new WebSocketServer({
            server,
            path: '/ws/playground'
        });

        this.wss.on('connection', this.handleConnection.bind(this));

        // Cleanup inactive connections every 30 seconds
        setInterval(this.cleanupInactiveConnections.bind(this), 30000);

        console.log('🔌 PlaygroundWebSocketServer initialized on /ws/playground');
    }

    private handleConnection(ws: WebSocket, req: IncomingMessage): void {
        const clientId = this.generateClientId();
        const client: PlaygroundClient = {
            id: clientId,
            ws,
            lastActivity: new Date(),
            isAuthenticated: false
        };

        this.clients.set(clientId, client);
        console.log(`🔗 New WebSocket connection: ${clientId}`);

        // Set up message handling
        ws.on('message', (data: Buffer) => {
            try {
                const message: PlaygroundWebSocketMessage = JSON.parse(data.toString());
                this.handleMessage(clientId, message);
            } catch (error) {
                console.error(`❌ Invalid message from ${clientId}:`, error);
                this.sendError(clientId, 'Invalid message format');
            }
        });

        // Handle connection close
        ws.on('close', () => {
            this.handleDisconnection(clientId);
        });

        // Handle errors
        ws.on('error', (error) => {
            console.error(`❌ WebSocket error for ${clientId}:`, error);
            this.handleDisconnection(clientId);
        });

        // Send welcome message
        this.sendMessage(clientId, {
            type: 'auth',
            timestamp: new Date().toISOString(),
            data: {
                message: 'Connected to Playground WebSocket. Please authenticate.',
                clientId
            }
        });
    }

    private handleMessage(clientId: string, message: PlaygroundWebSocketMessage): void {
        const client = this.clients.get(clientId);
        if (!client) return;

        client.lastActivity = new Date();

        switch (message.type) {
            case 'auth':
                this.handleAuthentication(clientId, message);
                break;

            case 'ping':
                this.sendMessage(clientId, {
                    type: 'pong',
                    timestamp: new Date().toISOString()
                });
                break;

            case 'playground_update':
                if (client.isAuthenticated) {
                    // Broadcast to other clients in the same session
                    this.broadcastToSession(client.sessionId!, message, clientId);
                } else {
                    this.sendError(clientId, 'Authentication required');
                }
                break;

            default:
                this.sendError(clientId, `Unknown message type: ${message.type}`);
        }
    }

    private handleAuthentication(clientId: string, message: PlaygroundWebSocketMessage): void {
        const client = this.clients.get(clientId);
        if (!client) return;

        const { userId, sessionId, token } = message.data || {};

        if (!userId || !sessionId) {
            this.sendError(clientId, 'Missing userId or sessionId');
            return;
        }

        // TODO: Validate JWT token here
        // For now, we'll accept any non-empty token
        if (!token) {
            this.sendError(clientId, 'Missing authentication token');
            return;
        }

        // Update client info
        client.userId = userId;
        client.sessionId = sessionId;
        client.isAuthenticated = true;

        // Track user sessions
        if (!this.userSessions.has(userId)) {
            this.userSessions.set(userId, new Set());
        }
        this.userSessions.get(userId)!.add(clientId);

        // Send authentication success
        this.sendMessage(clientId, {
            type: 'auth',
            timestamp: new Date().toISOString(),
            data: {
                success: true,
                message: 'Authentication successful',
                userId,
                sessionId
            }
        });

        console.log(`✅ Client ${clientId} authenticated as user ${userId}, session ${sessionId}`);
    }

    private handleDisconnection(clientId: string): void {
        const client = this.clients.get(clientId);
        if (client) {
            // Remove from user sessions
            if (client.userId && this.userSessions.has(client.userId)) {
                const userSessions = this.userSessions.get(client.userId)!;
                userSessions.delete(clientId);
                if (userSessions.size === 0) {
                    this.userSessions.delete(client.userId);
                }
            }

            this.clients.delete(clientId);
            console.log(`🔌 Client ${clientId} disconnected`);
        }
    }

    private sendMessage(clientId: string, message: PlaygroundWebSocketMessage): void {
        const client = this.clients.get(clientId);
        if (client && client.ws.readyState === WebSocket.OPEN) {
            try {
                client.ws.send(JSON.stringify(message));
            } catch (error) {
                console.error(`❌ Failed to send message to ${clientId}:`, error);
                this.handleDisconnection(clientId);
            }
        }
    }

    private sendError(clientId: string, error: string): void {
        this.sendMessage(clientId, {
            type: 'auth',
            timestamp: new Date().toISOString(),
            data: {
                success: false,
                error
            }
        });
    }

    private broadcastToSession(sessionId: string, message: PlaygroundWebSocketMessage, excludeClientId?: string): void {
        let broadcastCount = 0;

        for (const [clientId, client] of this.clients) {
            if (client.sessionId === sessionId &&
                client.isAuthenticated &&
                clientId !== excludeClientId &&
                client.ws.readyState === WebSocket.OPEN) {

                this.sendMessage(clientId, message);
                broadcastCount++;
            }
        }

        console.log(`📡 Broadcasted to ${broadcastCount} clients in session ${sessionId}`);
    }

    private cleanupInactiveConnections(): void {
        const now = new Date();
        const timeout = 5 * 60 * 1000; // 5 minutes

        for (const [clientId, client] of this.clients) {
            if (now.getTime() - client.lastActivity.getTime() > timeout) {
                console.log(`🧹 Cleaning up inactive client: ${clientId}`);
                client.ws.close();
                this.handleDisconnection(clientId);
            }
        }
    }

    private generateClientId(): string {
        return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Public API for external integration

    /**
     * Broadcast a message to all clients of a specific user
     */
    public broadcastToUser(userId: string, message: Omit<PlaygroundWebSocketMessage, 'timestamp'>): void {
        const userSessions = this.userSessions.get(userId);
        if (!userSessions) return;

        const messageWithTimestamp = {
            ...message,
            timestamp: new Date().toISOString()
        };

        for (const clientId of userSessions) {
            this.sendMessage(clientId, messageWithTimestamp);
        }
    }

    /**
     * Get connection statistics
     */
    public getStats(): {
        totalConnections: number;
        authenticatedConnections: number;
        uniqueUsers: number;
        uniqueSessions: number;
    } {
        const authenticatedClients = Array.from(this.clients.values()).filter(c => c.isAuthenticated);
        const uniqueSessions = new Set(authenticatedClients.map(c => c.sessionId).filter(Boolean));

        return {
            totalConnections: this.clients.size,
            authenticatedConnections: authenticatedClients.length,
            uniqueUsers: this.userSessions.size,
            uniqueSessions: uniqueSessions.size
        };
    }

    /**
     * Close all connections and cleanup
     */
    public close(): void {
        for (const client of this.clients.values()) {
            client.ws.close();
        }
        this.clients.clear();
        this.userSessions.clear();
        this.wss.close();
        console.log('🔌 PlaygroundWebSocketServer closed');
    }
} 