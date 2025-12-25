/**
 * Simplified WebSocket Transport - Zero Any/Unknown Types
 * 
 * Uses pure functions and explicit type definitions
 */

import type { ITransport, ITransportCapabilities, ITransportConfig } from './transport-interface';
import type { IChatResponseData, ITransportRequest, ITransportResponse } from '../shared/types';
import {
    createRequestMessage,
    createPongMessage,
    validateWebSocketMessage,
    serializeMessage,
    generateMessageId,
    isResponseMessage,
    isErrorMessage,
    isPingMessage
} from './websocket-utils';

export interface ISimpleWebSocketConfig extends ITransportConfig {
    reconnectDelay?: number;
    maxReconnectAttempts?: number;
    pingInterval?: number;
}

interface IPendingRequest {
    resolve: (value: ITransportResponse<IChatResponseData>) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
}

/**
 * Simplified WebSocket Transport with Type Safety
 */
export class SimpleWebSocketTransport implements ITransport {
    private ws: WebSocket | null = null;
    private config: Required<ISimpleWebSocketConfig>;
    private pendingRequests = new Map<string, IPendingRequest>();
    private reconnectAttempts = 0;
    private isReconnecting = false;

    constructor(config: ISimpleWebSocketConfig) {
        this.config = {
            baseUrl: config.baseUrl,
            timeout: config.timeout || 30000,
            retryCount: config.retryCount || 3,
            headers: config.headers || {},
            compression: config.compression || false,
            reconnectDelay: config.reconnectDelay || 1000,
            maxReconnectAttempts: config.maxReconnectAttempts || 5,
            pingInterval: config.pingInterval || 30000
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
                    this.handleMessage(event.data as string);
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
                this.ws.close(1000, 'Normal closure');
            }
            this.ws = null;
        }
    }

    async send<TData>(request: ITransportRequest): Promise<ITransportResponse<TData>> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            await this.connect();
        }

        const messageId = generateMessageId();
        const message = createRequestMessage(messageId, request);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(messageId);
                reject(new Error('Request timeout'));
            }, this.config.timeout);

            this.pendingRequests.set(messageId, {
                resolve: resolve as (value: ITransportResponse<IChatResponseData>) => void,
                reject,
                timeout
            });

            try {
                this.ws!.send(serializeMessage(message));
            } catch (error) {
                this.pendingRequests.delete(messageId);
                clearTimeout(timeout);
                reject(error instanceof Error ? error : new Error('Send failed'));
            }
        }) as Promise<ITransportResponse<TData>>;
    }

    async *sendStream<TData>(request: ITransportRequest): AsyncIterable<TData> {
        // Simple implementation - yield single response
        const response = await this.send<TData>(request);
        yield response.data;
    }

    isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    getCapabilities(): ITransportCapabilities {
        return {
            streaming: true,
            bidirectional: true,
            compression: this.config.compression,
            maxPayloadSize: 1024 * 1024,
            protocols: ['websocket']
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

    private handleResponse(messageId: string, data: IChatResponseData): void {
        const pending = this.pendingRequests.get(messageId);
        if (pending) {
            this.pendingRequests.delete(messageId);
            clearTimeout(pending.timeout);

            pending.resolve({
                id: messageId,
                status: 200,
                headers: {},
                data,
                timestamp: new Date()
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
        if (code !== 1000 && !this.isReconnecting && this.reconnectAttempts < this.config.maxReconnectAttempts) {
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