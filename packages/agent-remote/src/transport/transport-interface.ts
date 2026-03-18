import type { ITransportRequest, ITransportResponse } from '../shared/types';

/**
 * Transport interface for network communication
 * Both client and server can use different transport implementations
 */
export interface ITransport {
  /**
   * Send a single request and wait for response
   */
  send<TData>(request: ITransportRequest): Promise<ITransportResponse<TData>>;

  /**
   * Send a streaming request and get async iterator
   */
  sendStream<TData>(request: ITransportRequest): AsyncIterable<TData>;

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
  getCapabilities(): ITransportCapabilities;
}

/**
 * Transport capabilities
 */
export interface ITransportCapabilities {
  streaming: boolean;
  bidirectional: boolean;
  compression: boolean;
  maxPayloadSize: number;
  protocols: string[];
}

/**
 * Transport configuration
 */
export interface ITransportConfig {
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
    public readonly details?: Record<string, string | number | boolean>,
  ) {
    super(message);
    this.name = 'TransportError';
  }
}
