import { BasePlugin } from '../abstracts/base-plugin';
import { Logger, createLogger } from '../utils/logger';
import { PluginError, ErrorContext } from '../utils/errors';

/**
 * Webhook event types
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
 * Webhook event data types
 */
export type WebhookEventData =
    | { result: { response?: string; duration?: number; tokensUsed?: number; toolsExecuted?: number; success?: boolean } }
    | { conversation: { response?: string; tokensUsed?: number; toolCalls?: unknown[] } }
    | { tool: { name: string; id: string; success: boolean; duration?: number; result?: unknown; error?: string } }
    | { error: { message: string; stack?: string; context?: Record<string, unknown> } }
    | Record<string, unknown>;

/**
 * Webhook metadata for additional context
 */
export type WebhookMetadata = Record<string, string | number | boolean | Date | string[]>;

/**
 * Plugin execution context for webhooks
 */
export interface WebhookExecutionContext {
    executionId?: string;
    sessionId?: string;
    userId?: string;
}

/**
 * Plugin execution result for webhooks
 */
export interface WebhookExecutionResult {
    response?: string;
    content?: string;
    duration?: number;
    tokensUsed?: number;
    toolsExecuted?: number;
    success?: boolean;
    usage?: { totalTokens?: number };
    toolCalls?: unknown[];
    results?: unknown[];
    error?: Error;
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
 * Webhook plugin configuration
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
 * Webhook request queue item
 */
interface WebhookRequest {
    endpoint: WebhookEndpoint;
    payload: WebhookPayload;
    attempt: number;
    timestamp: Date;
}

/**
 * Plugin for sending webhook notifications
 * Sends HTTP requests to external systems on agent events
 */
export class WebhookPlugin extends BasePlugin {
    name = 'WebhookPlugin';
    version = '1.0.0';

    private options: Required<WebhookPluginOptions>;
    private logger: Logger;
    private requestQueue: WebhookRequest[] = [];
    private batchQueue: WebhookPayload[] = [];
    private activeConcurrency = 0;
    private batchTimer?: NodeJS.Timeout;

    constructor(options: WebhookPluginOptions) {
        super();
        this.logger = createLogger('WebhookPlugin');

        this.options = {
            endpoints: options.endpoints,
            events: options.events ?? [
                'execution.complete',
                'execution.error',
                'conversation.complete',
                'tool.executed',
                'error.occurred'
            ],
            defaultTimeout: options.defaultTimeout ?? 10000,
            defaultRetries: options.defaultRetries ?? 3,
            async: options.async ?? true,
            maxConcurrency: options.maxConcurrency ?? 10,
            batching: options.batching ?? {
                enabled: false,
                maxSize: 100,
                flushInterval: 10000
            },
            payloadTransformer: options.payloadTransformer ?? this.defaultPayloadTransformer.bind(this)
        };

        // Validate endpoints
        this.validateEndpoints();

        if (this.options.batching.enabled) {
            this.setupBatching();
        }

        this.logger.info('WebhookPlugin initialized', {
            endpointCount: this.options.endpoints.length,
            events: this.options.events,
            batchingEnabled: this.options.batching.enabled
        });
    }

    /**
     * After execution completes
     */
    async afterExecution(context: WebhookExecutionContext, result: WebhookExecutionResult): Promise<void> {
        await this.sendWebhook('execution.complete', {
            executionId: context.executionId,
            sessionId: context.sessionId,
            userId: context.userId,
            result: {
                response: result?.response,
                duration: result?.duration,
                tokensUsed: result?.tokensUsed,
                toolsExecuted: result?.toolsExecuted,
                success: result?.success
            }
        });
    }

    /**
     * After conversation completes
     */
    async afterConversation(context: WebhookExecutionContext, result: WebhookExecutionResult): Promise<void> {
        await this.sendWebhook('conversation.complete', {
            executionId: context.executionId,
            sessionId: context.sessionId,
            userId: context.userId,
            conversation: {
                response: result?.content || result?.response,
                tokensUsed: result?.usage?.totalTokens || result?.tokensUsed,
                toolCalls: result?.toolCalls
            }
        });
    }

    /**
     * After tool execution
     */
    async afterToolExecution(context: WebhookExecutionContext, toolResults: WebhookExecutionResult): Promise<void> {
        const results = Array.isArray(toolResults?.results) ? toolResults.results :
            toolResults ? [toolResults] : [];

        for (const result of results) {
            const toolResult = result as any; // Type assertion for tool result structure
            await this.sendWebhook('tool.executed', {
                executionId: context.executionId,
                sessionId: context.sessionId,
                userId: context.userId,
                tool: {
                    name: toolResult.toolName || 'unknown',
                    id: toolResult.toolId || toolResult.executionId || 'unknown',
                    success: !toolResult.error,
                    duration: toolResult.duration,
                    result: toolResult.error ? undefined : toolResult.result,
                    error: toolResult.error?.message
                }
            });
        }
    }

    /**
     * On error
     */
    override async onError(error: Error, context?: WebhookExecutionContext): Promise<void> {
        await this.sendWebhook('error.occurred', {
            executionId: context.executionId,
            sessionId: context.sessionId,
            userId: context.userId,
            error: {
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                type: error instanceof Error ? error.constructor.name : 'Unknown'
            }
        });

        await this.sendWebhook('execution.error', {
            executionId: context.executionId,
            sessionId: context.sessionId,
            userId: context.userId,
            error: {
                message: error instanceof Error ? error.message : String(error),
                context: context
            }
        });
    }

    /**
     * Send webhook notification
     */
    async sendWebhook(
        event: WebhookEventType,
        data: any,
        metadata?: Record<string, any>
    ): Promise<void> {
        if (!this.options.events.includes(event)) {
            return;
        }

        const payload: WebhookPayload = {
            event,
            timestamp: new Date().toISOString(),
            data: this.options.payloadTransformer(event, data),
            ...(metadata && { metadata })
        };

        // Add context data if available
        if (data.executionId) payload.executionId = data.executionId;
        if (data.sessionId) payload.sessionId = data.sessionId;
        if (data.userId) payload.userId = data.userId;

        this.logger.debug('Sending webhook', {
            event,
            endpointCount: this.getEndpointsForEvent(event).length
        });

        // Batch or send immediately
        if (this.options.batching.enabled) {
            this.batchQueue.push(payload);

            if (this.batchQueue.length >= this.options.batching.maxSize) {
                await this.flushBatch();
            }
        } else {
            await this.sendToEndpoints(payload);
        }
    }

    /**
     * Send custom webhook
     */
    async sendCustomWebhook(data: any, metadata?: Record<string, any>): Promise<void> {
        await this.sendWebhook('custom', data, metadata);
    }

    /**
     * Send payload to all applicable endpoints
     */
    private async sendToEndpoints(payload: WebhookPayload): Promise<void> {
        const endpoints = this.getEndpointsForEvent(payload.event);

        if (endpoints.length === 0) {
            return;
        }

        const requests: WebhookRequest[] = endpoints.map(endpoint => ({
            endpoint,
            payload,
            attempt: 1,
            timestamp: new Date()
        }));

        if (this.options.async) {
            // Add to queue for async processing
            this.requestQueue.push(...requests);
            this.processQueue();
        } else {
            // Send synchronously
            await Promise.allSettled(requests.map(req => this.sendRequest(req)));
        }
    }

    /**
     * Process webhook request queue
     */
    private async processQueue(): Promise<void> {
        while (this.requestQueue.length > 0 && this.activeConcurrency < this.options.maxConcurrency) {
            const request = this.requestQueue.shift();
            if (!request) break;

            this.activeConcurrency++;

            // Process request asynchronously
            this.sendRequest(request).finally(() => {
                this.activeConcurrency--;
                // Continue processing queue
                if (this.requestQueue.length > 0) {
                    this.processQueue();
                }
            });
        }
    }

    /**
     * Send a single webhook request
     */
    private async sendRequest(request: WebhookRequest): Promise<void> {
        const { endpoint, payload, attempt } = request;
        const timeout = endpoint.timeout ?? this.options.defaultTimeout;
        const maxRetries = endpoint.retries ?? this.options.defaultRetries;

        try {
            // Prepare request body
            const body = JSON.stringify(payload);

            // Prepare headers
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'User-Agent': `robota-webhook/${this.version}`,
                ...endpoint.headers
            };

            // Add signature if secret is provided
            if (endpoint.secret) {
                headers['X-Webhook-Signature'] = this.generateSignature(body, endpoint.secret);
            }

            // Make HTTP request
            const response = await this.makeHttpRequest(endpoint.url, {
                method: 'POST',
                headers,
                body,
                timeout
            });

            if (response.ok) {
                this.logger.debug('Webhook sent successfully', {
                    url: endpoint.url,
                    event: payload.event,
                    status: response.status,
                    attempt
                });
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

        } catch (error) {
            this.logger.warn('Webhook request failed', {
                url: endpoint.url,
                event: payload.event,
                attempt,
                maxRetries,
                error: error instanceof Error ? error.message : String(error)
            });

            // Retry if attempts remaining
            if (attempt < maxRetries) {
                const retryRequest: WebhookRequest = {
                    ...request,
                    attempt: attempt + 1
                };

                // Add exponential backoff delay
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
                setTimeout(() => {
                    this.requestQueue.push(retryRequest);
                    this.processQueue();
                }, delay);
            } else {
                this.logger.error('Webhook failed after all retries', {
                    url: endpoint.url,
                    event: payload.event,
                    totalAttempts: attempt,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }

    /**
     * Get endpoints that should receive this event
     */
    private getEndpointsForEvent(event: WebhookEventType): WebhookEndpoint[] {
        return this.options.endpoints.filter(endpoint => {
            return !endpoint.events || endpoint.events.includes(event);
        });
    }

    /**
     * Setup webhook batching
     */
    private setupBatching(): void {
        this.batchTimer = setInterval(() => {
            this.flushBatch();
        }, this.options.batching.flushInterval);
    }

    /**
     * Flush batched webhooks
     */
    private async flushBatch(): Promise<void> {
        if (this.batchQueue.length === 0) {
            return;
        }

        const batch = [...this.batchQueue];
        this.batchQueue = [];

        this.logger.debug('Flushing webhook batch', { count: batch.length });

        // Send batch as a single payload
        const batchPayload: WebhookPayload = {
            event: 'custom',
            timestamp: new Date().toISOString(),
            data: {
                type: 'batch',
                events: batch,
                count: batch.length
            }
        };

        await this.sendToEndpoints(batchPayload);
    }

    /**
     * Generate webhook signature
     */
    private generateSignature(body: string, secret: string): string {
        // Simple HMAC-like signature for demo
        // In real implementation, use proper HMAC-SHA256
        const hash = require('crypto').createHash('sha256');
        hash.update(secret + body);
        return `sha256=${hash.digest('hex')}`;
    }

    /**
     * Make HTTP request (placeholder implementation)
     */
    private async makeHttpRequest(url: string, options: {
        method: string;
        headers: Record<string, string>;
        body: string;
        timeout: number;
    }): Promise<Response> {
        // In a real implementation, this would use fetch or a proper HTTP client
        // For now, we'll create a mock response
        this.logger.debug('Making HTTP request', { url, method: options.method });

        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 100));

        // Mock successful response
        return {
            ok: true,
            status: 200,
            statusText: 'OK'
        } as Response;
    }

    /**
     * Default payload transformer
     */
    private defaultPayloadTransformer(event: WebhookEventType, data: any): any {
        return {
            event,
            ...data
        };
    }

    /**
     * Validate webhook endpoints
     */
    private validateEndpoints(): void {
        for (const endpoint of this.options.endpoints) {
            if (!endpoint.url) {
                throw new PluginError('Webhook endpoint URL is required', this.name);
            }

            try {
                new URL(endpoint.url);
            } catch (error) {
                throw new PluginError(
                    `Invalid webhook URL: ${endpoint.url}`,
                    this.name,
                    { url: endpoint.url }
                );
            }
        }
    }

    /**
     * Get webhook statistics
     */
    getStats(): WebhookPluginStats {
        return {
            endpointCount: this.options.endpoints.length,
            queueLength: this.requestQueue.length,
            batchQueueLength: this.batchQueue.length,
            activeConcurrency: this.activeConcurrency,
            supportedEvents: this.options.events,
            totalSent: 0, // TODO: Track total sent webhooks
            totalErrors: 0, // TODO: Track total errors
            averageResponseTime: 0 // TODO: Track average response time
        };
    }

    /**
     * Clear all queued requests
     */
    clearQueue(): void {
        this.requestQueue = [];
        this.batchQueue = [];
        this.logger.info('Webhook queues cleared');
    }

    /**
     * Cleanup on plugin destruction
     */
    async destroy(): Promise<void> {
        if (this.batchTimer) {
            clearInterval(this.batchTimer);
        }

        // Flush any remaining batched webhooks
        await this.flushBatch();

        // Process remaining queue items (with shorter timeout)
        const originalTimeout = this.options.defaultTimeout;
        this.options.defaultTimeout = 2000; // 2 second timeout for cleanup

        while (this.requestQueue.length > 0 && this.activeConcurrency > 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        this.options.defaultTimeout = originalTimeout;
        this.clearQueue();

        this.logger.info('WebhookPlugin destroyed');
    }
} 