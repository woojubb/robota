/**
 * Simplified WebSocket Transport - Zero Any/Unknown Types
 *
 * Uses pure functions and explicit type definitions
 */

import type { ITransport, ITransportCapabilities, ITransportConfig } from './transport-interface';
import type { ITransportRequest, ITransportResponse } from '../shared/types';
import {
  createRequestMessage,
  createPongMessage,
  validateWebSocketMessage,
  serializeMessage,
  generateMessageId,
  isResponseMessage,
  isErrorMessage,
  isPingMessage,
} from './websocket-utils';

/** Configuration for SimpleWebSocketTransport with reconnection and keep-alive settings. */
export interface ISimpleWebSocketConfig extends ITransportConfig {
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
  pingInterval?: number;
}

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_RECONNECT_DELAY_MS = 1000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;
const DEFAULT_PING_INTERVAL_MS = 30000;
const WS_NORMAL_CLOSURE = 1000;
const WS_MAX_PAYLOAD_SIZE_BYTES = 1048576; // 1MB

interface IPendingRequest {
  resolve: (value: ITransportResponse<unknown>) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * Simplified WebSocket Transport with Type Safety
 */
export class SimpleWebSocketTransport implements ITransport {
  private ws?: WebSocket;
  private config: Required<ISimpleWebSocketConfig>;
  private pendingRequests = new Map<string, IPendingRequest>();
  private reconnectAttempts = 0;
  private isReconnecting = false;

  constructor(config: ISimpleWebSocketConfig) {
    this.config = {
      baseUrl: config.baseUrl,
      timeout: config.timeout || DEFAULT_TIMEOUT_MS,
      retryCount: config.retryCount || DEFAULT_RETRY_COUNT,
      headers: config.headers || {},
      compression: config.compression || false,
      reconnectDelay: config.reconnectDelay || DEFAULT_RECONNECT_DELAY_MS,
      maxReconnectAttempts: config.maxReconnectAttempts || DEFAULT_MAX_RECONNECT_ATTEMPTS,
      pingInterval: config.pingInterval || DEFAULT_PING_INTERVAL_MS,
    };
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        const wsUrl = this.config.baseUrl.replace(/^https?:/, 'ws:');
        this.ws = new WebSocket(wsUrl);

        const onOpen = (): void => {
          this.reconnectAttempts = 0;
          this.isReconnecting = false;
          resolve();
        };

        const onError = (): void => {
          reject(new Error('WebSocket connection failed'));
        };

        const onMessage = (event: MessageEvent): void => {
          if (typeof event.data !== 'string') {
            return; // Only handle string messages
          }
          this.handleMessage(event.data);
        };

        const onClose = (event: CloseEvent): void => {
          this.handleClose(event.code);
        };

        this.ws.addEventListener('open', onOpen, { once: true });
        this.ws.addEventListener('error', onError, { once: true });
        this.ws.addEventListener('message', onMessage);
        this.ws.addEventListener('close', onClose);
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Unknown connection error'));
      }
    });
  }

  async disconnect(): Promise<void> {
    // Clear pending requests
    for (const [_id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(WS_NORMAL_CLOSURE, 'Normal closure');
      }
      this.ws = undefined;
    }
  }

  async send<TData>(request: ITransportRequest): Promise<ITransportResponse<TData>> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    const messageId = generateMessageId();
    const message = createRequestMessage(messageId, request);

    // Trust boundary: the WebSocket response data is external/network data.
    // The generic TData is determined by the caller; the transport layer
    // resolves with unknown and the caller is responsible for validation.
    const response = await new Promise<ITransportResponse<unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(messageId);
        reject(new Error('Request timeout'));
      }, this.config.timeout);

      this.pendingRequests.set(messageId, {
        resolve,
        reject,
        timeout,
      });

      try {
        this.ws!.send(serializeMessage(message));
      } catch (error) {
        this.pendingRequests.delete(messageId);
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error('Send failed'));
      }
    });

    return response as ITransportResponse<TData>;
  }

  async *sendStream<TData>(request: ITransportRequest): AsyncIterable<TData> {
    // Simple implementation - yield single response
    const response = await this.send<TData>(request);
    yield response.data;
  }

  isConnected(): boolean {
    return this.ws !== undefined && this.ws.readyState === WebSocket.OPEN;
  }

  getCapabilities(): ITransportCapabilities {
    return {
      streaming: true,
      bidirectional: true,
      compression: this.config.compression,
      maxPayloadSize: WS_MAX_PAYLOAD_SIZE_BYTES,
      protocols: ['websocket'],
    };
  }

  private handleMessage(rawData: string): void {
    const validation = validateWebSocketMessage(rawData);

    if (!validation.valid || !validation.message) {
      // Skip invalid WebSocket message
      return;
    }

    const message = validation.message;

    if (isResponseMessage(message)) {
      this.handleResponse(message.id, message.data);
    } else if (isErrorMessage(message)) {
      this.handleError(message.id, message.error);
    } else if (isPingMessage(message)) {
      this.handlePing(message.id);
    }
  }

  private handleResponse(messageId: string, data: unknown): void {
    const pending = this.pendingRequests.get(messageId);
    if (pending) {
      this.pendingRequests.delete(messageId);
      clearTimeout(pending.timeout);

      pending.resolve({
        id: messageId,
        status: 200,
        headers: {},
        data,
        timestamp: new Date(),
      });
    }
  }

  private handleError(messageId: string, error: string): void {
    const pending = this.pendingRequests.get(messageId);
    if (pending) {
      this.pendingRequests.delete(messageId);
      clearTimeout(pending.timeout);
      pending.reject(new Error(error));
    }
  }

  private handlePing(messageId: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const pongMessage = createPongMessage(messageId);
      this.ws.send(serializeMessage(pongMessage));
    }
  }

  private handleClose(code: number): void {
    if (
      code !== WS_NORMAL_CLOSURE &&
      !this.isReconnecting &&
      this.reconnectAttempts < this.config.maxReconnectAttempts
    ) {
      this.attemptReconnect();
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.isReconnecting) return;

    this.isReconnecting = true;
    this.reconnectAttempts++;

    const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
          this.attemptReconnect();
        } else {
          this.isReconnecting = false;
        }
      }
    }, delay);
  }
}
