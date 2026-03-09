/**
 * Webhook Plugin - Facade Pattern Implementation
 * Coordinates webhook functionality through clean, separated components
 */

import {
    AbstractPlugin,
    PluginCategory,
    PluginPriority,
    type IPluginExecutionContext,
    type IPluginExecutionResult,
    type IPluginErrorContext
} from '../../abstracts/abstract-plugin';
import { EXECUTION_EVENTS, EXECUTION_EVENT_PREFIX } from '../../services/execution-service';
import { createLogger, type ILogger } from '../../utils/logger';
import { PluginError } from '../../utils/errors';
import type { TTimerId } from '../../utils';

import { WebhookTransformer } from './transformer';
import { WebhookHttpClient } from './http-client';
import type {
    TWebhookEventName,
    IWebhookEventData,
    TWebhookMetadata,
    IWebhookPayload,
    IWebhookEndpoint,
    IWebhookPluginOptions,
    IWebhookPluginStats,
    IWebhookRequest
} from './types';

// Local event constants for webhook usage (kept internal to plugin)
const EXEC_EVENTS: { START: TWebhookEventName; COMPLETE: TWebhookEventName; ERROR: TWebhookEventName } = {
    START: `${EXECUTION_EVENT_PREFIX}.${EXECUTION_EVENTS.START}`,
    COMPLETE: `${EXECUTION_EVENT_PREFIX}.${EXECUTION_EVENTS.COMPLETE}`,
    ERROR: `${EXECUTION_EVENT_PREFIX}.${EXECUTION_EVENTS.ERROR}`
} as const;

const CONV_EVENTS: { COMPLETE: TWebhookEventName } = {
    COMPLETE: 'conversation.complete'
} as const;

const TOOL_EVENTS_LOCAL: { EXECUTED: TWebhookEventName } = {
    EXECUTED: 'tool.executed'
} as const;

const ERROR_EVENTS: { OCCURRED: TWebhookEventName } = {
    OCCURRED: 'error.occurred'
} as const;

/**
 * Sends HTTP webhook notifications for agent execution lifecycle events.
 *
 * Routes events to configured {@link IWebhookEndpoint | endpoints} with
 * optional event filtering per endpoint. Supports asynchronous delivery with
 * configurable concurrency, automatic retries via {@link WebhookHttpClient},
 * and optional payload batching.
 *
 * Lifecycle hooks used: {@link AbstractPlugin.afterExecution | afterExecution},
 * {@link AbstractPlugin.afterConversation | afterConversation},
 * {@link AbstractPlugin.afterToolExecution | afterToolExecution},
 * {@link AbstractPlugin.onError | onError}
 *
 * @extends AbstractPlugin
 * @see IWebhookPluginOptions - configuration options
 * @see WebhookTransformer - payload transformation utilities
 * @see WebhookHttpClient - HTTP delivery client
 *
 * @example
 * ```ts
 * const plugin = new WebhookPlugin({
 *   endpoints: [{ url: 'https://example.com/hook' }],
 *   async: true,
 *   maxConcurrency: 3,
 * });
 * ```
 */
export class WebhookPlugin extends AbstractPlugin<IWebhookPluginOptions, IWebhookPluginStats> {
    name = 'WebhookPlugin';
    version = '1.0.0';

    private pluginOptions: Required<IWebhookPluginOptions>;
    private logger: ILogger;
    private httpClient: WebhookHttpClient;
    private requestQueue: IWebhookRequest[] = [];
    private batchQueue: IWebhookPayload[] = [];
    private activeConcurrency = 0;
    private batchTimer?: TTimerId;
    private totalSentCount = 0;
    private totalErrorCount = 0;
    private totalResponseTime = 0;

    constructor(options: IWebhookPluginOptions) {
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
            events: [EXEC_EVENTS.COMPLETE, CONV_EVENTS.COMPLETE, TOOL_EVENTS_LOCAL.EXECUTED, ERROR_EVENTS.OCCURRED],
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
            // Add plugin options defaults
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
     * Sends an execution-complete webhook after the agent finishes processing.
     */
    override async afterExecution(context: IPluginExecutionContext, result: IPluginExecutionResult): Promise<void> {
        const webhookContext = WebhookTransformer.contextToWebhook(context);
        const webhookResult = WebhookTransformer.resultToWebhook(result);
        const eventData = WebhookTransformer.createExecutionData(webhookContext, webhookResult);

        await this.sendWebhook(EXEC_EVENTS.COMPLETE, eventData);
    }

    /**
     * Sends a conversation-complete webhook after a conversation round finishes.
     */
    override async afterConversation(context: IPluginExecutionContext, result: IPluginExecutionResult): Promise<void> {
        const webhookContext = WebhookTransformer.contextToWebhook(context);
        const webhookResult = WebhookTransformer.resultToWebhook(result);
        const eventData = WebhookTransformer.createConversationData(webhookContext, webhookResult);

        await this.sendWebhook(CONV_EVENTS.COMPLETE, eventData);
    }

    /**
     * Sends a tool-executed webhook for each tool call in the result set.
     */
    override async afterToolExecution(context: IPluginExecutionContext, toolResults: IPluginExecutionResult): Promise<void> {
        const webhookContext = WebhookTransformer.contextToWebhook(context);
        // Handle tool results from IPluginExecutionResult
        if (toolResults.toolCalls && toolResults.toolCalls.length > 0) {
            for (const toolCall of toolResults.toolCalls) {
                const toolData = {
                    toolName: toolCall.name || '',
                    toolId: toolCall.id || '',
                    result: toolCall.result,
                    success: toolCall.result !== null,
                    duration: toolResults.duration
                };
                const eventData = WebhookTransformer.createToolData(webhookContext, toolData);
                await this.sendWebhook(TOOL_EVENTS_LOCAL.EXECUTED, eventData);
            }
        }
    }

    /**
     * Sends both an error-occurred and execution-error webhook on failure.
     */
    override async onError(error: Error, context?: IPluginErrorContext): Promise<void> {
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

        await this.sendWebhook(ERROR_EVENTS.OCCURRED, errorEventData);
        await this.sendWebhook(EXEC_EVENTS.ERROR, errorEventData);
    }

    /**
     * Builds a webhook payload and delivers it to all matching endpoints. When
     * batching is enabled, payloads are queued and flushed at the configured interval.
     */
    async sendWebhook(
        event: TWebhookEventName,
        data: IWebhookEventData,
        metadata?: TWebhookMetadata
    ): Promise<void> {
        if (!this.pluginOptions.events.includes(event)) {
            return;
        }

        const payload: IWebhookPayload = {
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
     * Sends a webhook with the `custom` event type.
     */
    async sendCustomWebhook(data: IWebhookEventData, metadata?: TWebhookMetadata): Promise<void> {
        await this.sendWebhook('custom', data, metadata);
    }

    /**
     * Send payload to all applicable endpoints
     */
    private async sendToEndpoints(payload: IWebhookPayload): Promise<void> {
        const endpoints = this.getEndpointsForEvent(payload.event);

        if (endpoints.length === 0) {
            return;
        }

        const requests: IWebhookRequest[] = endpoints.map(endpoint => ({
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
            await Promise.allSettled(requests.map(req => {
                const startTime = Date.now();
                return this.httpClient.sendRequest(req).then(() => {
                    this.totalSentCount++;
                    this.totalResponseTime += Date.now() - startTime;
                }).catch((error: unknown) => {
                    this.totalErrorCount++;
                    throw error;
                });
            }));
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
            const startTime = Date.now();
            this.httpClient.sendRequest(request)
                .then(() => {
                    this.totalSentCount++;
                    this.totalResponseTime += Date.now() - startTime;
                })
                .catch((error: unknown) => {
                    this.totalErrorCount++;
                    const message = error instanceof Error ? error.message : String(error);
                    this.logger.error('Webhook request failed', {
                        endpoint: request.endpoint.url,
                        event: request.payload.event,
                        error: message
                    });
                })
                .finally(() => {
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
    private getEndpointsForEvent(event: TWebhookEventName): IWebhookEndpoint[] {
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

            let parsed: URL;
            try {
                parsed = new URL(endpoint.url);
            } catch {
                throw new PluginError(`Invalid webhook URL: ${endpoint.url}`, this.name);
            }

            if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
                throw new PluginError(`Webhook endpoint URL must use http or https: ${endpoint.url}`, this.name);
            }

            if (endpoint.events) {
                const validEvents: TWebhookEventName[] = [
                    EXEC_EVENTS.START, EXEC_EVENTS.COMPLETE, EXEC_EVENTS.ERROR,
                    CONV_EVENTS.COMPLETE, TOOL_EVENTS_LOCAL.EXECUTED, ERROR_EVENTS.OCCURRED, 'custom'
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
    override getStats(): IWebhookPluginStats {
        const base = super.getStats();
        return {
            ...base,
            endpointCount: this.pluginOptions.endpoints.length,
            queueLength: this.requestQueue.length,
            batchQueueLength: this.batchQueue.length,
            activeConcurrency: this.activeConcurrency,
            supportedEvents: this.pluginOptions.events,
            totalSent: this.totalSentCount,
            totalErrors: this.totalErrorCount,
            averageResponseTime: this.totalSentCount > 0
                ? this.totalResponseTime / this.totalSentCount
                : 0
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
     * Flushes pending batches, clears request queues, and stops the batch timer.
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