import { EXECUTION_EVENTS, EXECUTION_EVENT_PREFIX } from '../../services/execution-service';

/**
 * Webhook plugin type definitions
 * Clean separation of concerns with domain-specific types
 */

/**
 * Webhook event types for different lifecycle events
 */
type TExecutionEventName = `${typeof EXECUTION_EVENT_PREFIX}.${typeof EXECUTION_EVENTS[keyof typeof EXECUTION_EVENTS]}`;

export type TWebhookEventName =
    | TExecutionEventName
    | 'conversation.complete'
    | 'tool.executed'
    | 'error.occurred'
    | 'custom';

/**
 * Base webhook context data
 */
export interface IWebhookContextData {
    executionId?: string | undefined;
    sessionId?: string | undefined;
    userId?: string | undefined;
}

/**
 * Execution result data for webhooks
 */
export interface IWebhookExecutionData {
    response?: string | undefined;
    duration?: number | undefined;
    tokensUsed?: number | undefined;
    toolsExecuted?: number | undefined;
    success?: boolean | undefined;
}

/**
 * Conversation result data for webhooks
 */
export interface IWebhookConversationData {
    response?: string | undefined;
    tokensUsed?: number | undefined;
    toolCalls?: IWebhookToolCallData[] | undefined;
}

/**
 * Tool call data for webhooks
 */
export interface IWebhookToolCallData {
    id: string;
    name: string;
    arguments: string;
    result: string;
}

/**
 * Tool execution data for webhooks
 */
export interface IWebhookToolData {
    name: string;
    id: string;
    success: boolean;
    duration?: number | undefined;
    result?: string | undefined;
    error?: string | undefined;
}

/**
 * Error data for webhooks
 */
export interface IWebhookErrorData {
    message: string;
    stack?: string | undefined;
    context?: Record<string, string | number | boolean> | undefined;
    type?: string | undefined;
}

/**
 * Complete webhook event data structure
 */
export interface IWebhookEventData extends IWebhookContextData {
    result?: IWebhookExecutionData | undefined;
    conversation?: IWebhookConversationData | undefined;
    tool?: IWebhookToolData | undefined;
    error?: IWebhookErrorData | undefined;
}

/**
 * Webhook metadata for additional context
 */
export type TWebhookMetadata = Record<string, string | number | boolean | Date | string[]>;

/**
 * Webhook execution context (simplified from base types)
 */
export interface IWebhookExecutionContext {
    executionId?: string | undefined;
    sessionId?: string | undefined;
    userId?: string | undefined;
}

/**
 * Webhook execution result (simplified from base types)
 */
export interface IWebhookExecutionResult {
    response?: string | undefined;
    content?: string | undefined;
    duration?: number | undefined;
    tokensUsed?: number | undefined;
    toolsExecuted?: number | undefined;
    success?: boolean | undefined;
    usage?: { totalTokens?: number | undefined } | undefined;
    // SSOT: reuse the canonical toolCalls shape from IPluginExecutionResult.
    toolCalls?: import('../../abstracts/abstract-plugin').IPluginExecutionResult['toolCalls'];
    results?: Array<{
        toolName?: string | undefined;
        toolId?: string | undefined;
        executionId?: string | undefined;
        error?: Error | undefined;
        duration?: number | undefined;
        result?: string | number | boolean | undefined;
    }> | undefined;
    error?: Error | undefined;
}

/**
 * Webhook payload structure
 */
export interface IWebhookPayload {
    event: TWebhookEventName;
    timestamp: string;
    executionId?: string;
    sessionId?: string;
    userId?: string;
    data: IWebhookEventData;
    metadata?: TWebhookMetadata;
}

/**
 * Webhook endpoint configuration
 */
export interface IWebhookEndpoint {
    url: string;
    headers?: Record<string, string>;
    events?: TWebhookEventName[];
    retries?: number;
    timeout?: number;
    secret?: string;
}

import type { IPluginOptions, IPluginStats } from '../../abstracts/abstract-plugin';

/**
 * Webhook plugin configuration options
 */
export interface IWebhookPluginOptions extends IPluginOptions {
    /** Webhook endpoints */
    endpoints: IWebhookEndpoint[];
    /** Events to send webhooks for */
    events?: TWebhookEventName[];
    /** Default timeout for webhook requests */
    defaultTimeout?: number;
    /** Default retry attempts */
    defaultRetries?: number;
    /** Whether to use async sending */
    async?: boolean;
    /** Maximum concurrent webhook requests */
    maxConcurrency?: number;
    /** Whether to batch webhook requests */
    batching?: {
        enabled: boolean;
        maxSize: number;
        flushInterval: number;
    };
    /** Custom payload transformer */
    payloadTransformer?: (event: TWebhookEventName, data: IWebhookEventData) => IWebhookEventData;
}

/**
 * Webhook plugin statistics
 */
export interface IWebhookPluginStats extends IPluginStats {
    endpointCount: number;
    queueLength: number;
    batchQueueLength: number;
    activeConcurrency: number;
    supportedEvents: TWebhookEventName[];
    totalSent: number;
    totalErrors: number;
    averageResponseTime: number;
}

/**
 * Internal webhook request structure
 */
export interface IWebhookRequest {
    endpoint: IWebhookEndpoint;
    payload: IWebhookPayload;
    attempt: number;
    timestamp: Date;
} 