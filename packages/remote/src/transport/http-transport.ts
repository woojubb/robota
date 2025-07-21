import type {
    Transport,
    TransportCapabilities,
    TransportConfig
} from './transport-interface';
import { TransportError } from './transport-interface';
import type { TransportRequest, TransportResponse } from '../shared/types';

/**
 * HTTP Transport implementation
 * Works in both browser and Node.js environments
 */
export class HttpTransport implements Transport {
    private connected = false;
    private readonly config: Required<TransportConfig>;

    constructor(config: TransportConfig) {
        this.config = {
            timeout: 30000,
            retryCount: 3,
            headers: {},
            compression: false,
            ...config
        };
    }

    async connect(): Promise<void> {
        // HTTP is connectionless, but we can do a health check
        try {
            const healthRequest: TransportRequest = {
                id: 'health-check',
                url: `${this.config.baseUrl}/health`,
                method: 'GET',
                headers: { ...this.config.headers }
            };

            await this.send(healthRequest);
            this.connected = true;
        } catch (error) {
            this.connected = false;
            throw new TransportError(
                'Failed to connect to HTTP endpoint',
                'CONNECTION_FAILED',
                undefined,
                error
            );
        }
    }

    async disconnect(): Promise<void> {
        this.connected = false;
    }

    isConnected(): boolean {
        return this.connected;
    }

    getCapabilities(): TransportCapabilities {
        return {
            streaming: false, // HTTP doesn't support true streaming
            bidirectional: false,
            compression: this.config.compression,
            maxPayloadSize: 100 * 1024 * 1024, // 100MB
            protocols: ['http', 'https']
        };
    }

    async send<T>(request: TransportRequest): Promise<TransportResponse<T>> {
        const url = this.buildUrl(request.url);
        const requestInit: RequestInit = {
            method: request.method,
            headers: {
                'Content-Type': 'application/json',
                ...this.config.headers,
                ...request.headers
            },
            signal: AbortSignal.timeout(request.timeout || this.config.timeout)
        };

        if (request.body && request.method !== 'GET') {
            requestInit.body = JSON.stringify(request.body);
        }

        try {
            const response = await fetch(url, requestInit);

            if (!response.ok) {
                throw new TransportError(
                    `HTTP ${response.status}: ${response.statusText}`,
                    'HTTP_ERROR',
                    response.status,
                    await response.text()
                );
            }

            const data = await response.json();

            return {
                id: request.id,
                status: response.status,
                headers: this.parseHeaders(response.headers),
                data,
                timestamp: new Date()
            };
        } catch (error) {
            if (error instanceof TransportError) {
                throw error;
            }

            throw new TransportError(
                `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                'NETWORK_ERROR',
                undefined,
                error
            );
        }
    }

    async *sendStream<T>(request: TransportRequest): AsyncIterable<T> {
        // HTTP streaming using Server-Sent Events
        const url = this.buildUrl(request.url);
        const requestInit: RequestInit = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream',
                'Cache-Control': 'no-cache',
                ...this.config.headers,
                ...request.headers
            },
            body: JSON.stringify(request.body)
        };

        try {
            const response = await fetch(url, requestInit);

            if (!response.ok) {
                throw new TransportError(
                    `HTTP ${response.status}: ${response.statusText}`,
                    'HTTP_ERROR',
                    response.status
                );
            }

            if (!response.body) {
                throw new TransportError(
                    'No response body for streaming',
                    'NO_STREAM_BODY'
                );
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            try {
                while (true) {
                    const { done, value } = await reader.read();

                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.trim() === '') continue;

                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === '[DONE]') break;

                            try {
                                yield JSON.parse(data) as T;
                            } catch (parseError) {
                                console.warn('Failed to parse SSE data:', data);
                            }
                        }
                    }
                }
            } finally {
                reader.releaseLock();
            }
        } catch (error) {
            if (error instanceof TransportError) {
                throw error;
            }

            throw new TransportError(
                `Streaming error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                'STREAM_ERROR',
                undefined,
                error
            );
        }
    }

    private buildUrl(path: string): string {
        const baseUrl = this.config.baseUrl.replace(/\/$/, '');
        const cleanPath = path.startsWith('/') ? path : `/${path}`;
        return `${baseUrl}${cleanPath}`;
    }

    private parseHeaders(headers: Headers): Record<string, string> {
        const result: Record<string, string> = {};
        headers.forEach((value, key) => {
            result[key] = value;
        });
        return result;
    }
} 