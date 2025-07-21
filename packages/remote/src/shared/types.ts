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

// Import for extension
import type {
    ChatExecutionRequest as BaseChatExecutionRequest,
    StreamExecutionRequest as BaseStreamExecutionRequest
} from '@robota-sdk/agents';

export type { UniversalMessage, AssistantMessage } from '@robota-sdk/agents';

// Import for extension
import type { AssistantMessage as BaseAssistantMessage } from '@robota-sdk/agents';

// Extended AssistantMessage with provider info
export interface ExtendedAssistantMessage extends BaseAssistantMessage {
    provider?: string;
    model?: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    tools?: Array<Record<string, string>>;
}

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
export interface ChatRequestBody {
    messages: Array<{ role: string; content: string }>;
    provider: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    tools?: Array<Record<string, string>>;
    stream?: boolean;
}

// Extend the base execution requests with additional fields
export interface ExtendedChatExecutionRequest extends BaseChatExecutionRequest {
    temperature?: number;
    maxTokens?: number;
}

export interface ExtendedStreamExecutionRequest extends BaseStreamExecutionRequest {
    temperature?: number;
    maxTokens?: number;
}

export interface TransportRequest<TBody = ChatRequestBody> {
    id: string;
    url: string;
    endpoint: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers: Record<string, string>;
    body?: TBody;
    data?: TBody;
    timeout?: number;
}

/**
 * Transport layer response format
 */
export interface ChatResponseData {
    content: string;
    provider?: string;
    model?: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    tools?: Array<Record<string, string>>;
}

export interface TransportResponse<TData = ChatResponseData> {
    id: string;
    status: number;
    headers: Record<string, string>;
    data: TData;
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