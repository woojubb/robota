/**
 * Webhook plugin type definitions
 * Clean separation of concerns with domain-specific types
 */

/**
 * Webhook event types for different lifecycle events
 */
export type WebhookEventType =
    | 'execution.start'
    | 'execution.complete'
    | 'execution.error'
    | 'conversation.complete'
    | 'tool.executed'
    | 'error.occurred'
    | 'custom';

/**
 * Base webhook context data
 */
export interface WebhookContextData {
    executionId?: string | undefined;
    sessionId?: string | undefined;
    userId?: string | undefined;
}

/**
 * Execution result data for webhooks
 */
export interface WebhookExecutionData {
    response?: string | undefined;
    duration?: number | undefined;
    tokensUsed?: number | undefined;
    toolsExecuted?: number | undefined;
    success?: boolean | undefined;
}

/**
 * Conversation result data for webhooks
 */
export interface WebhookConversationData {
    response?: string | undefined;
    tokensUsed?: number | undefined;
    toolCalls?: WebhookToolCallData[] | undefined;
}

/**
 * Tool call data for webhooks
 */
export interface WebhookToolCallData {
    id: string;
    name: string;
    arguments: string;
    result: string;
}

/**
 * Tool execution data for webhooks
 */
export interface WebhookToolData {
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
export interface WebhookErrorData {
    message: string;
    stack?: string | undefined;
    context?: Record<string, string | number | boolean> | undefined;
    type?: string | undefined;
}

/**
 * Complete webhook event data structure
 */
export interface WebhookEventData extends WebhookContextData {
    result?: WebhookExecutionData | undefined;
    conversation?: WebhookConversationData | undefined;
    tool?: WebhookToolData | undefined;
    error?: WebhookErrorData | undefined;
}

/**
 * Webhook metadata for additional context
 */
export type WebhookMetadata = Record<string, string | number | boolean | Date | string[]>;

/**
 * Webhook execution context (simplified from base types)
 */
export interface WebhookExecutionContext {
    executionId?: string | undefined;
    sessionId?: string | undefined;
    userId?: string | undefined;
}

/**
 * Webhook execution result (simplified from base types)
 */
export interface WebhookExecutionResult {
    response?: string | undefined;
    content?: string | undefined;
    duration?: number | undefined;
    tokensUsed?: number | undefined;
    toolsExecuted?: number | undefined;
    success?: boolean | undefined;
    usage?: { totalTokens?: number | undefined } | undefined;
    toolCalls?: Array<{
        id?: string | undefined;
        name?: string | undefined;
        arguments?: Record<string, string | number | boolean> | undefined;
        result?: string | number | boolean | null | undefined;
    }> | undefined;
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
export interface WebhookPayload {
    event: WebhookEventType;
    timestamp: string;
    executionId?: string;
    sessionId?: string;
    userId?: string;
    data: WebhookEventData;
    metadata?: WebhookMetadata;
}

/**
 * Webhook endpoint configuration
 */
export interface WebhookEndpoint {
    url: string;
    headers?: Record<string, string>;
    events?: WebhookEventType[];
    retries?: number;
    timeout?: number;
    secret?: string;
}

/**
 * Webhook plugin configuration options
 */
export interface WebhookPluginOptions {
    /** Webhook endpoints */
    endpoints: WebhookEndpoint[];
    /** Events to send webhooks for */
    events?: WebhookEventType[];
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
    payloadTransformer?: (event: WebhookEventType, data: WebhookEventData) => WebhookEventData;
}

/**
 * Webhook plugin statistics
 */
export interface WebhookPluginStats {
    endpointCount: number;
    queueLength: number;
    batchQueueLength: number;
    activeConcurrency: number;
    supportedEvents: WebhookEventType[];
    totalSent: number;
    totalErrors: number;
    averageResponseTime: number;
}

/**
 * Internal webhook request structure
 */
export interface WebhookRequest {
    endpoint: WebhookEndpoint;
    payload: WebhookPayload;
    attempt: number;
    timestamp: Date;
} 