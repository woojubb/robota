import type { TransportRequest, TransportResponse } from '../shared/types';

/**
 * Transport interface for network communication
 * Both client and server can use different transport implementations
 */
export interface Transport {
    /**
     * Send a single request and wait for response
     */
    send<T>(request: TransportRequest): Promise<TransportResponse<T>>;

    /**
     * Send a streaming request and get async iterator
     */
    sendStream<T>(request: TransportRequest): AsyncIterable<T>;

    /**
     * Connect to the transport (for connection-based protocols)
     */
    connect(): Promise<void>;

    /**
     * Disconnect from the transport
     */
    disconnect(): Promise<void>;

    /**
     * Check if transport is connected
     */
    isConnected(): boolean;

    /**
     * Get transport capabilities
     */
    getCapabilities(): TransportCapabilities;
}

/**
 * Transport capabilities
 */
export interface TransportCapabilities {
    streaming: boolean;
    bidirectional: boolean;
    compression: boolean;
    maxPayloadSize: number;
    protocols: string[];
}

/**
 * Transport configuration
 */
export interface TransportConfig {
    baseUrl: string;
    timeout?: number;
    retryCount?: number;
    headers?: Record<string, string>;
    compression?: boolean;
}

/**
 * Transport error
 */
export class TransportError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly status?: number,
        public readonly details?: any
    ) {
        super(message);
        this.name = 'TransportError';
    }
} 