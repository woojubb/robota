/**
 * Shared types for Remote System
 * Used by both client and server components
 */

// Re-export core interfaces from @robota-sdk/agents
export type {
    IExecutor,
    IChatExecutionRequest,
    IStreamExecutionRequest,
    ILocalExecutorConfig,
    IRemoteExecutorConfig
} from '@robota-sdk/agents';

// Import for extension
import type {
    IChatExecutionRequest as BaseChatExecutionRequest,
    IStreamExecutionRequest as BaseStreamExecutionRequest,
    IAssistantMessage,
    IToolSchema
} from '@robota-sdk/agents';

export type { TUniversalMessage, IAssistantMessage } from '@robota-sdk/agents';

// Extended AssistantMessage with provider info
export interface IExtendedAssistantMessage extends IAssistantMessage {
    provider?: string;
    model?: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    tools?: IToolSchema[];
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
export interface IChatRequestBody {
    messages: Array<{ role: string; content: string }>;
    provider: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    tools?: IToolSchema[];
    stream?: boolean;
}

// Extend the base execution requests with additional fields
export interface IExtendedChatExecutionRequest extends BaseChatExecutionRequest {
    temperature?: number;
    maxTokens?: number;
}

export interface IExtendedStreamExecutionRequest extends BaseStreamExecutionRequest {
    temperature?: number;
    maxTokens?: number;
}

export interface ITransportRequest<TBody = IChatRequestBody> {
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
export interface IChatResponseData {
    content: string;
    provider?: string;
    model?: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    tools?: IToolSchema[];
}

export interface ITransportResponse<TData = IChatResponseData> {
    id: string;
    status: number;
    headers: Record<string, string>;
    data: TData;
    timestamp: Date;
}

/**
 * Remote configuration
 */
export interface IRemoteConfig {
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
export interface IHealthStatus {
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
export interface IUserContext {
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
export interface IProviderStatus {
    name: string;
    available: boolean;
    models: string[];
    latency?: number;
    errorRate?: number;
} 