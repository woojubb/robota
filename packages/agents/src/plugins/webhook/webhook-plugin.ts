/**
 * Webhook Plugin - Facade Pattern Implementation
 * Coordinates webhook functionality through clean, separated components
 */

import { BasePlugin, PluginCategory, PluginPriority, type BaseExecutionContext, type BaseExecutionResult, type ErrorContext } from '../../abstracts/base-plugin';
import { Logger, createLogger } from '../../utils/logger';
import { PluginError } from '../../utils/errors';

import { WebhookTransformer } from './transformer';
import { WebhookHttpClient } from './http-client';
import type {
    WebhookEventType,
    WebhookEventData,
    WebhookMetadata,
    WebhookPayload,
    WebhookEndpoint,
    WebhookPluginOptions,
    WebhookPluginStats,
    WebhookRequest
} from './types';

/**
 * Webhook Plugin using Facade Pattern
 * Provides a clean interface for webhook functionality
 */
export class WebhookPlugin extends BasePlugin<WebhookPluginOptions, WebhookPluginStats> {
    name = 'WebhookPlugin';
    version = '1.0.0';

    private pluginOptions: Required<WebhookPluginOptions>;
    private logger: Logger;
    private httpClient: WebhookHttpClient;
    private requestQueue: WebhookRequest[] = [];
    private batchQueue: WebhookPayload[] = [];
    private activeConcurrency = 0;
    private batchTimer?: NodeJS.Timeout;

    constructor(options: WebhookPluginOptions) {
        super();

        // Set plugin classification
        this.category = PluginCategory.NOTIFICATION;
        this.priority = PluginPriority.LOW;

        // Validate required options
        if (!options.endpoints || options.endpoints.length === 0) {
            throw new PluginError('At least one webhook endpoint is required', this.name);
        }

        // Set default options
        this.pluginOptions = {
            enabled: options.enabled ?? true,
            events: ['execution.complete', 'conversation.complete', 'tool.executed', 'error.occurred'],
            defaultTimeout: 5000,
            defaultRetries: 3,
            async: true,
            maxConcurrency: 3,
            batching: {
                enabled: false,
                maxSize: 10,
                flushInterval: 5000
            },
            payloadTransformer: WebhookTransformer.defaultPayloadTransformer,
            // Add BasePluginOptions defaults
            category: options.category ?? PluginCategory.NOTIFICATION,
            priority: options.priority ?? PluginPriority.LOW,
            moduleEvents: options.moduleEvents ?? [],
            subscribeToAllModuleEvents: options.subscribeToAllModuleEvents ?? false,
            ...options
        };

        this.logger = createLogger(`${this.name}`);
        this.httpClient = new WebhookHttpClient(this.logger);

        this.validateEndpoints();

        if (this.pluginOptions.batching.enabled) {
            this.setupBatching();
        }

        this.logger.info('WebhookPlugin initialized', {
            endpointCount: this.pluginOptions.endpoints.length,
            events: this.pluginOptions.events,
            batching: this.pluginOptions.batching.enabled
        });
    }

    /**
     * After execution completes
     */
    override async afterExecution(context: BaseExecutionContext, result: BaseExecutionResult): Promise<void> {
        const webhookContext = WebhookTransformer.contextToWebhook(context);
        const webhookResult = WebhookTransformer.resultToWebhook(result);
        const eventData = WebhookTransformer.createExecutionData(webhookContext, webhookResult);

        await this.sendWebhook('execution.complete', eventData);
    }

    /**
     * After conversation completes
     */
    override async afterConversation(context: BaseExecutionContext, result: BaseExecutionResult): Promise<void> {
        const webhookContext = WebhookTransformer.contextToWebhook(context);
        const webhookResult = WebhookTransformer.resultToWebhook(result);
        const eventData = WebhookTransformer.createConversationData(webhookContext, webhookResult);

        await this.sendWebhook('conversation.complete', eventData);
    }

    /**
     * After tool execution
     * 
     * REASON: Tool results structure varies by tool type and provider, needs flexible handling for webhook processing
     * ALTERNATIVES_CONSIDERED:
     * 1. Strict tool result interfaces (breaks tool compatibility)
     * 2. Union types (insufficient for dynamic tool results)
     * 3. Generic constraints (too complex for webhook processing)
     * 4. Interface definitions (too rigid for varied tool results)
     * 5. Type assertions (decreases type safety)
     * TODO: Consider standardized tool result interface across tools
     */
    override async afterToolExecution(context: BaseExecutionContext, toolResults: Record<string, string | number | boolean | object | Array<string | number | boolean> | null | undefined>): Promise<void> {
        const webhookContext = WebhookTransformer.contextToWebhook(context);
        const results = Array.isArray(toolResults?.['results']) ? toolResults['results'] :
            toolResults ? [toolResults] : [];

        for (const result of results) {
            const eventData = WebhookTransformer.createToolData(webhookContext, result);
            await this.sendWebhook('tool.executed', eventData);
        }
    }

    /**
     * On error
     */
    override async onError(error: Error, context?: ErrorContext): Promise<void> {
        const webhookContext = context ? {
            executionId: context.executionId,
            sessionId: context.sessionId,
            userId: context.userId
        } : {
            executionId: undefined,
            sessionId: undefined,
            userId: undefined
        };

        const errorEventData = WebhookTransformer.createErrorData(webhookContext, error);

        await this.sendWebhook('error.occurred', errorEventData);
        await this.sendWebhook('execution.error', errorEventData);
    }

    /**
     * Send webhook notification
     */
    async sendWebhook(
        event: WebhookEventType,
        data: WebhookEventData,
        metadata?: WebhookMetadata
    ): Promise<void> {
        if (!this.pluginOptions.events.includes(event)) {
            return;
        }

        const payload: WebhookPayload = {
            event,
            timestamp: new Date().toISOString(),
            data: this.pluginOptions.payloadTransformer(event, data),
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
        if (this.pluginOptions.batching.enabled) {
            this.batchQueue.push(payload);

            if (this.batchQueue.length >= this.pluginOptions.batching.maxSize) {
                await this.flushBatch();
            }
        } else {
            await this.sendToEndpoints(payload);
        }
    }

    /**
     * Send custom webhook
     */
    async sendCustomWebhook(data: WebhookEventData, metadata?: WebhookMetadata): Promise<void> {
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

        if (this.pluginOptions.async) {
            // Add to queue for async processing
            this.requestQueue.push(...requests);
            this.processQueue();
        } else {
            // Send synchronously
            await Promise.allSettled(requests.map(req => this.httpClient.sendRequest(req)));
        }
    }

    /**
     * Process webhook request queue
     */
    private async processQueue(): Promise<void> {
        while (this.requestQueue.length > 0 && this.activeConcurrency < this.pluginOptions.maxConcurrency) {
            const request = this.requestQueue.shift();
            if (!request) break;

            this.activeConcurrency++;

            // Process request asynchronously
            this.httpClient.sendRequest(request).finally(() => {
                this.activeConcurrency--;
                // Continue processing queue
                if (this.requestQueue.length > 0) {
                    this.processQueue();
                }
            });
        }
    }

    /**
     * Get endpoints that should receive the event
     */
    private getEndpointsForEvent(event: WebhookEventType): WebhookEndpoint[] {
        return this.pluginOptions.endpoints.filter(endpoint => {
            if (!endpoint.events || endpoint.events.length === 0) {
                return true; // No event filter means all events
            }
            return endpoint.events.includes(event);
        });
    }

    /**
     * Setup event batching
     */
    private setupBatching(): void {
        this.batchTimer = setInterval(() => {
            this.flushBatch();
        }, this.pluginOptions.batching.flushInterval);
    }

    /**
     * Flush batched webhooks
     */
    private async flushBatch(): Promise<void> {
        if (this.batchQueue.length === 0) {
            return;
        }

        const payloads = [...this.batchQueue];
        this.batchQueue = [];

        this.logger.debug('Flushing webhook batch', { payloadCount: payloads.length });

        // Send all batched payloads
        for (const payload of payloads) {
            await this.sendToEndpoints(payload);
        }
    }

    /**
     * Validate webhook endpoints
     */
    private validateEndpoints(): void {
        for (const endpoint of this.pluginOptions.endpoints) {
            if (!endpoint.url) {
                throw new PluginError(`Webhook endpoint URL is required`, this.name);
            }

            try {
                new URL(endpoint.url);
            } catch {
                throw new PluginError(`Invalid webhook URL: ${endpoint.url}`, this.name);
            }

            if (endpoint.events) {
                const validEvents: WebhookEventType[] = [
                    'execution.start', 'execution.complete', 'execution.error',
                    'conversation.complete', 'tool.executed', 'error.occurred', 'custom'
                ];

                for (const event of endpoint.events) {
                    if (!validEvents.includes(event)) {
                        throw new PluginError(`Invalid webhook event: ${event}`, this.name);
                    }
                }
            }
        }
    }

    /**
     * Get webhook plugin statistics
     */
    getStats(): WebhookPluginStats {
        return {
            endpointCount: this.pluginOptions.endpoints.length,
            queueLength: this.requestQueue.length,
            batchQueueLength: this.batchQueue.length,
            activeConcurrency: this.activeConcurrency,
            supportedEvents: this.pluginOptions.events,
            totalSent: 0, // TODO: Track total sent webhooks
            totalErrors: 0, // TODO: Track total webhook errors
            averageResponseTime: 0 // TODO: Track average response time
        };
    }

    /**
     * Clear webhook queue
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

        await this.flushBatch();
        this.clearQueue();

        this.logger.info('WebhookPlugin destroyed');
    }
} 