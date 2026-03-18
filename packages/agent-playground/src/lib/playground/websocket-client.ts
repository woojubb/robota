/**
 * PlaygroundWebSocketClient - Handles real-time communication for Playground
 *
 * This client manages WebSocket connections specifically for the Playground interface,
 * handling authentication, reconnection, and message routing for real-time updates.
 */

import { WebLogger } from '../web-logger';
import type { TUniversalValue } from '@robota-sdk/agent-core';
import type {
  IPlaygroundWebSocketMessage,
  TPlaygroundWebSocketMessageKind,
} from '@robota-sdk/agent-remote';
export type {
  IPlaygroundWebSocketMessage,
  TPlaygroundWebSocketMessageKind,
} from '@robota-sdk/agent-remote';

export const PLAYGROUND_WS_MESSAGE_TYPES = {
  PLAYGROUND_UPDATE: 'playground_update',
  AUTH: 'auth',
  PING: 'ping',
  PONG: 'pong',
} as const;

export const PLAYGROUND_WS_CLIENT_EVENTS = {
  AUTHENTICATED: 'authenticated',
  CONNECTION: 'connection',
  ERROR: 'error',
  PLAYGROUND_UPDATE: 'playground_update',
} as const;

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
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

function isPlaygroundWebSocketMessage(
  value: TUniversalValue,
): value is IPlaygroundWebSocketMessage {
  if (!isUniversalObjectValue(value)) return false;
  const type = value.type;
  const timestamp = value.timestamp;
  if (typeof type !== 'string') return false;
  if (typeof timestamp !== 'string') return false;
  return (
    type === PLAYGROUND_WS_MESSAGE_TYPES.PLAYGROUND_UPDATE ||
    type === PLAYGROUND_WS_MESSAGE_TYPES.AUTH ||
    type === PLAYGROUND_WS_MESSAGE_TYPES.PING ||
    type === PLAYGROUND_WS_MESSAGE_TYPES.PONG
  );
}

/**
 * WebSocket client for Playground real-time communication
 */
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const PING_INTERVAL_MS = 30000;
const NORMAL_CLOSE_CODE = 1000;

export class PlaygroundWebSocketClient {
  private ws?: WebSocket;
  private status: IPlaygroundConnectionStatus = { connected: false, authenticated: false };
  private reconnectAttempts = 0;
  private maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS;
  private reconnectTimeout?: NodeJS.Timeout;
  private pingInterval?: NodeJS.Timeout;
  private eventHandlers = new Map<string, Set<TPlaygroundWebSocketEventHandler>>();

  constructor(
    private serverUrl: string,
    private userId?: string,
    private sessionId?: string,
    private authToken?: string,
  ) {}

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
              this.off(PLAYGROUND_WS_CLIENT_EVENTS.AUTHENTICATED, authHandler);
              if (payload.success) {
                connectionResolve(true);
                return;
              }
              connectionReject(new Error(payload.error || 'Authentication failed'));
            };
            this.on(PLAYGROUND_WS_CLIENT_EVENTS.AUTHENTICATED, authHandler);
          } else {
            // No authentication needed
            connectionResolve(true);
          }

          this.emit(PLAYGROUND_WS_CLIENT_EVENTS.CONNECTION, { connected: true });
        };

        this.ws.onmessage = (event) => {
          try {
            const parsed: TUniversalValue = JSON.parse(event.data) as TUniversalValue;
            if (!isPlaygroundWebSocketMessage(parsed)) {
              WebLogger.error('Invalid WebSocket message', {
                error: 'Message shape validation failed',
              });
              return;
            }
            this.handleMessage(parsed);
          } catch (error) {
            WebLogger.error('Invalid WebSocket message', {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        };

        this.ws.onclose = (event) => {
          this.status.connected = false;
          this.status.authenticated = false;
          this.stopPingPong();

          WebLogger.info('Playground WebSocket disconnected', {
            code: event.code,
            reason: event.reason,
          });
          this.emit(PLAYGROUND_WS_CLIENT_EVENTS.CONNECTION, { connected: false });

          // Attempt reconnection if not intentional
          if (
            event.code !== NORMAL_CLOSE_CODE &&
            this.reconnectAttempts < this.maxReconnectAttempts
          ) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          WebLogger.error('Playground WebSocket error', {
            error: error instanceof Error ? error.message : String(error),
          });
          this.status.error = 'Connection error';
          this.emit(PLAYGROUND_WS_CLIENT_EVENTS.ERROR, { error: 'Connection failed' });
          reject(error);
        };
      } catch (error) {
        WebLogger.error('Failed to create WebSocket', {
          error: error instanceof Error ? error.message : String(error),
        });
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
      this.reconnectTimeout = undefined;
    }

    this.stopPingPong();

    if (this.ws) {
      this.ws.close(NORMAL_CLOSE_CODE, 'Client disconnect');
      this.ws = undefined;
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

    const authData: Omit<IPlaygroundWebSocketMessage, 'timestamp'> = {
      type: PLAYGROUND_WS_MESSAGE_TYPES.AUTH,
      data: {
        userId: this.userId,
        sessionId: this.sessionId,
        token: this.authToken,
      },
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
      timestamp: new Date().toISOString(),
    };

    try {
      this.ws.send(JSON.stringify(messageWithTimestamp));
      return true;
    } catch (error) {
      WebLogger.error('Failed to send WebSocket message', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Broadcast playground update
   */
  broadcastUpdate(data: TUniversalValue): boolean {
    return this.sendMessage({
      type: PLAYGROUND_WS_MESSAGE_TYPES.PLAYGROUND_UPDATE,
      data,
      userId: this.userId,
      sessionId: this.sessionId,
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
      case PLAYGROUND_WS_MESSAGE_TYPES.AUTH:
        this.handleAuthResponse(message);
        break;

      case PLAYGROUND_WS_MESSAGE_TYPES.PONG:
        // Pong received, connection is healthy
        break;

      case PLAYGROUND_WS_MESSAGE_TYPES.PLAYGROUND_UPDATE:
        this.emit(PLAYGROUND_WS_CLIENT_EVENTS.PLAYGROUND_UPDATE, message);
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
        sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      });
      this.emit(PLAYGROUND_WS_CLIENT_EVENTS.AUTHENTICATED, {
        success: true,
        userId: typeof userId === 'string' ? userId : undefined,
        sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      });
    } else {
      this.status.authenticated = false;
      this.status.error = typeof error === 'string' ? error : 'Authentication failed';
      WebLogger.error('Playground WebSocket authentication failed', {
        error: typeof error === 'string' ? error : 'Authentication failed',
      });
      this.emit(PLAYGROUND_WS_CLIENT_EVENTS.AUTHENTICATED, {
        success: false,
        error: typeof error === 'string' ? error : 'Authentication failed',
      });
    }
  }

  private emit(event: string, data: TPlaygroundWebSocketEventPayload): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (error) {
          WebLogger.error('Error in WebSocket event handler', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY_MS,
    );

    WebLogger.info('Scheduling WebSocket reconnect', {
      attempt: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
      delayMs: delay,
    });

    this.reconnectTimeout = setTimeout(() => {
      this.connect().catch((error) => {
        WebLogger.error('Reconnect attempt failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, delay);
  }

  private startPingPong(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendMessage({ type: PLAYGROUND_WS_MESSAGE_TYPES.PING });
      }
    }, PING_INTERVAL_MS); // Ping periodically
  }

  private stopPingPong(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
  }
}
