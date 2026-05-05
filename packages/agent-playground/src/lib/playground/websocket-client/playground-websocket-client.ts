import type { TUniversalValue } from '@robota-sdk/agent-core';
import { WebLogger } from '../../web-logger';
import type { IPlaygroundWebSocketMessage } from '../types';
import { parseAuthResponse } from './auth-response';
import {
  MAX_RECONNECT_DELAY_MS,
  NORMAL_CLOSE_CODE,
  PING_INTERVAL_MS,
  PLAYGROUND_WS_CLIENT_EVENTS,
  PLAYGROUND_WS_MESSAGE_TYPES,
  RECONNECT_BASE_DELAY_MS,
  DEFAULT_MAX_RECONNECT_ATTEMPTS,
} from './constants';
import { parsePlaygroundWebSocketMessage } from './message-guards';
import {
  buildPlaygroundWebSocketUrl,
  createAuthMessage,
  createTimestampedMessage,
} from './messages';
import type {
  IPlaygroundConnectionStatus,
  TPlaygroundWebSocketEventHandler,
  TPlaygroundWebSocketEventPayload,
} from './types';

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

  async connect(): Promise<boolean> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return true;
    }

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(buildPlaygroundWebSocketUrl(this.serverUrl));
        this.ws.onopen = () => this.handleOpen(resolve, reject);
        this.ws.onmessage = (event) => this.handleRawMessage(event.data);
        this.ws.onclose = (event) => this.handleClose(event);
        this.ws.onerror = (error) => this.handleError(error, reject);
      } catch (error) {
        WebLogger.error('Failed to create WebSocket', {
          error: error instanceof Error ? error.message : String(error),
        });
        reject(error);
      }
    });
  }

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

  updateAuth(userId: string, sessionId: string, authToken: string): void {
    this.userId = userId;
    this.sessionId = sessionId;
    this.authToken = authToken;

    if (this.status.connected) {
      this.authenticate();
    }
  }

  sendMessage(message: Omit<IPlaygroundWebSocketMessage, 'timestamp'>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      WebLogger.warn('WebSocket not connected, cannot send message');
      return false;
    }

    try {
      this.ws.send(JSON.stringify(createTimestampedMessage(message)));
      return true;
    } catch (error) {
      WebLogger.error('Failed to send WebSocket message', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  broadcastUpdate(data: TUniversalValue): boolean {
    return this.sendMessage({
      type: PLAYGROUND_WS_MESSAGE_TYPES.PLAYGROUND_UPDATE,
      data,
      userId: this.userId,
      sessionId: this.sessionId,
    });
  }

  on(event: string, handler: TPlaygroundWebSocketEventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  off(event: string, handler: TPlaygroundWebSocketEventHandler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  getStatus(): IPlaygroundConnectionStatus {
    return { ...this.status };
  }

  private handleOpen(resolve: (value: boolean) => void, reject: (reason?: Error) => void): void {
    this.status.connected = true;
    this.status.error = undefined;
    this.reconnectAttempts = 0;
    this.startPingPong();

    if (this.userId && this.sessionId && this.authToken) {
      this.authenticate();
      this.waitForAuthentication(resolve, reject);
    } else {
      resolve(true);
    }

    this.emit(PLAYGROUND_WS_CLIENT_EVENTS.CONNECTION, { connected: true });
  }

  private waitForAuthentication(
    resolve: (value: boolean) => void,
    reject: (reason?: Error) => void,
  ): void {
    const authHandler: TPlaygroundWebSocketEventHandler = (payload) => {
      if ('type' in payload) return;
      if (!('success' in payload) || typeof payload.success !== 'boolean') return;
      this.off(PLAYGROUND_WS_CLIENT_EVENTS.AUTHENTICATED, authHandler);
      if (payload.success) {
        resolve(true);
        return;
      }
      reject(new Error(payload.error || 'Authentication failed'));
    };
    this.on(PLAYGROUND_WS_CLIENT_EVENTS.AUTHENTICATED, authHandler);
  }

  private handleRawMessage(data: string): void {
    const message = parsePlaygroundWebSocketMessage(data);
    if (message) this.handleMessage(message);
  }

  private handleClose(event: CloseEvent): void {
    this.status.connected = false;
    this.status.authenticated = false;
    this.stopPingPong();

    WebLogger.info('Playground WebSocket disconnected', {
      code: event.code,
      reason: event.reason,
    });
    this.emit(PLAYGROUND_WS_CLIENT_EVENTS.CONNECTION, { connected: false });

    if (event.code !== NORMAL_CLOSE_CODE && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect();
    }
  }

  private handleError(error: Event, reject: (reason?: Event) => void): void {
    WebLogger.error('Playground WebSocket error', {
      error: error instanceof Error ? error.message : String(error),
    });
    this.status.error = 'Connection error';
    this.emit(PLAYGROUND_WS_CLIENT_EVENTS.ERROR, { error: 'Connection failed' });
    reject(error);
  }

  private authenticate(): void {
    if (!this.userId || !this.sessionId || !this.authToken) {
      WebLogger.warn('Missing authentication credentials');
      return;
    }
    this.sendMessage(createAuthMessage(this.userId, this.sessionId, this.authToken));
  }

  private handleMessage(message: IPlaygroundWebSocketMessage): void {
    this.status.lastActivity = new Date();

    switch (message.type) {
      case PLAYGROUND_WS_MESSAGE_TYPES.AUTH:
        this.handleAuthResponse(message);
        break;
      case PLAYGROUND_WS_MESSAGE_TYPES.PONG:
        break;
      case PLAYGROUND_WS_MESSAGE_TYPES.PLAYGROUND_UPDATE:
        this.emit(PLAYGROUND_WS_CLIENT_EVENTS.PLAYGROUND_UPDATE, message);
        break;
      default:
        WebLogger.warn('Unknown WebSocket message type', { type: message.type });
    }
  }

  private handleAuthResponse(message: IPlaygroundWebSocketMessage): void {
    const authResponse = parseAuthResponse(message);
    if (authResponse.kind === 'ignore') return;

    if (authResponse.kind === 'success') {
      this.status.authenticated = true;
      this.status.connectionId = authResponse.connectionId;
      this.status.error = undefined;
      WebLogger.info('Playground WebSocket authenticated', {
        userId: authResponse.event.userId,
        sessionId: authResponse.event.sessionId,
      });
    } else {
      this.status.authenticated = false;
      this.status.error = authResponse.event.error;
      WebLogger.error('Playground WebSocket authentication failed', {
        error: authResponse.event.error,
      });
    }
    this.emit(PLAYGROUND_WS_CLIENT_EVENTS.AUTHENTICATED, authResponse.event);
  }

  private emit(event: string, data: TPlaygroundWebSocketEventPayload): void {
    const handlers = this.eventHandlers.get(event);
    if (!handlers) return;

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
    }, PING_INTERVAL_MS);
  }

  private stopPingPong(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
  }
}
