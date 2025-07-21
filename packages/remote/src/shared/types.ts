/**
 * Shared types for Remote System
 * Used by both client and server components
 */

// Re-export core interfaces from @robota-sdk/agents
export type {
    ExecutorInterface,
    ChatExecutionRequest,
    StreamExecutionRequest,
    LocalExecutorConfig,
    RemoteExecutorConfig
} from '@robota-sdk/agents';

export type { UniversalMessage, AssistantMessage } from '@robota-sdk/agents';

/**
 * Communication protocols supported by the remote system
 */
export enum CommunicationProtocol {
    HTTP_REST = 'http-rest',
    WEBSOCKET = 'websocket',
    GRPC = 'grpc'
}

/**
 * Transport layer request format
 */
export interface TransportRequest {
    id: string;
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers: Record<string, string>;
    body?: any;
    timeout?: number;
}

/**
 * Transport layer response format
 */
export interface TransportResponse<T = any> {
    id: string;
    status: number;
    headers: Record<string, string>;
    data: T;
    timestamp: Date;
}

/**
 * Remote configuration
 */
export interface RemoteConfig {
    serverUrl: string;
    apiKey?: string;
    protocol?: CommunicationProtocol;
    timeout?: number;
    retryCount?: number;
    enableWebSocket?: boolean;
}

/**
 * Health check response
 */
export interface HealthStatus {
    status: 'healthy' | 'unhealthy' | 'degraded';
    timestamp: Date;
    version: string;
    uptime: number;
    services: {
        transport: boolean;
        providers: Record<string, boolean>;
    };
}

/**
 * User context for authentication
 */
export interface UserContext {
    id: string;
    email?: string;
    permissions: string[];
    quota: {
        daily: number;
        used: number;
    };
}

/**
 * Provider availability info
 */
export interface ProviderStatus {
    name: string;
    available: boolean;
    models: string[];
    latency?: number;
    errorRate?: number;
} 