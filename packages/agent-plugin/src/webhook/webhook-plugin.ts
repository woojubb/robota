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
  type IPluginErrorContext,
  createLogger,
  type ILogger,
  PluginError,
} from '@robota-sdk/agent-core';

import { WebhookTransformer } from './transformer';
import { WebhookHttpClient } from './http-client';
import {
  validateWebhookEndpoints,
  WEBHOOK_EXEC_EVENTS,
  WEBHOOK_CONV_EVENTS,
  WEBHOOK_TOOL_EVENTS,
  WEBHOOK_ERROR_EVENTS,
} from './webhook-helpers';
import { WebhookQueueManager } from './webhook-queue';
import type {
  TWebhookEventName,
  IWebhookEventData,
  TWebhookMetadata,
  IWebhookPayload,
  IWebhookEndpoint,
  IWebhookPluginOptions,
  IWebhookPluginStats,
} from './types';

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
  private queue: WebhookQueueManager;

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
      events: [
        WEBHOOK_EXEC_EVENTS.COMPLETE,
        WEBHOOK_CONV_EVENTS.COMPLETE,
        WEBHOOK_TOOL_EVENTS.EXECUTED,
        WEBHOOK_ERROR_EVENTS.OCCURRED,
      ],
      defaultTimeout: 5000,
      defaultRetries: 3,
      async: true,
      maxConcurrency: 3,
      batching: {
        enabled: false,
        maxSize: 10,
        flushInterval: 5000,
      },
      payloadTransformer: WebhookTransformer.defaultPayloadTransformer,
      // Add plugin options defaults
      category: options.category ?? PluginCategory.NOTIFICATION,
      priority: options.priority ?? PluginPriority.LOW,
      moduleEvents: options.moduleEvents ?? [],
      subscribeToAllModuleEvents: options.subscribeToAllModuleEvents ?? false,
      ...options,
    };

    this.logger = createLogger(`${this.name}`);
    const httpClient = new WebhookHttpClient(this.logger);
    this.queue = new WebhookQueueManager(
      this.logger,
      httpClient,
      this.pluginOptions.maxConcurrency,
    );

    validateWebhookEndpoints(this.pluginOptions.endpoints, this.name, [
      WEBHOOK_EXEC_EVENTS.START,
      WEBHOOK_EXEC_EVENTS.COMPLETE,
      WEBHOOK_EXEC_EVENTS.ERROR,
      WEBHOOK_CONV_EVENTS.COMPLETE,
      WEBHOOK_TOOL_EVENTS.EXECUTED,
      WEBHOOK_ERROR_EVENTS.OCCURRED,
      'custom',
    ]);

    if (this.pluginOptions.batching.enabled) {
      this.queue.setupBatching(
        this.pluginOptions.batching.flushInterval,
        this.getEndpointsForEvent.bind(this),
      );
    }

    this.logger.info('WebhookPlugin initialized', {
      endpointCount: this.pluginOptions.endpoints.length,
      events: this.pluginOptions.events,
      batching: this.pluginOptions.batching.enabled,
    });
  }

  /**
   * Sends an execution-complete webhook after the agent finishes processing.
   */
  override async afterExecution(
    context: IPluginExecutionContext,
    result: IPluginExecutionResult,
  ): Promise<void> {
    const webhookContext = WebhookTransformer.contextToWebhook(context);
    const webhookResult = WebhookTransformer.resultToWebhook(result);
    const eventData = WebhookTransformer.createExecutionData(webhookContext, webhookResult);
    await this.sendWebhook(WEBHOOK_EXEC_EVENTS.COMPLETE, eventData);
  }

  /**
   * Sends a conversation-complete webhook after a conversation round finishes.
   */
  override async afterConversation(
    context: IPluginExecutionContext,
    result: IPluginExecutionResult,
  ): Promise<void> {
    const webhookContext = WebhookTransformer.contextToWebhook(context);
    const webhookResult = WebhookTransformer.resultToWebhook(result);
    const eventData = WebhookTransformer.createConversationData(webhookContext, webhookResult);
    await this.sendWebhook(WEBHOOK_CONV_EVENTS.COMPLETE, eventData);
  }

  /**
   * Sends a tool-executed webhook for each tool call in the result set.
   */
  override async afterToolExecution(
    context: IPluginExecutionContext,
    toolResults: IPluginExecutionResult,
  ): Promise<void> {
    const webhookContext = WebhookTransformer.contextToWebhook(context);
    if (toolResults.toolCalls && toolResults.toolCalls.length > 0) {
      for (const toolCall of toolResults.toolCalls) {
        const toolData = {
          toolName: toolCall.name || '',
          toolId: toolCall.id || '',
          result: toolCall.result,
          success: toolCall.result !== null,
          duration: toolResults.duration,
        };
        const eventData = WebhookTransformer.createToolData(webhookContext, toolData);
        await this.sendWebhook(WEBHOOK_TOOL_EVENTS.EXECUTED, eventData);
      }
    }
  }

  /**
   * Sends both an error-occurred and execution-error webhook on failure.
   */
  override async onError(error: Error, context?: IPluginErrorContext): Promise<void> {
    const webhookContext = context
      ? { executionId: context.executionId, sessionId: context.sessionId, userId: context.userId }
      : { executionId: undefined, sessionId: undefined, userId: undefined };
    const errorEventData = WebhookTransformer.createErrorData(webhookContext, error);
    await this.sendWebhook(WEBHOOK_ERROR_EVENTS.OCCURRED, errorEventData);
    await this.sendWebhook(WEBHOOK_EXEC_EVENTS.ERROR, errorEventData);
  }

  /**
   * Builds a webhook payload and delivers it to all matching endpoints. When
   * batching is enabled, payloads are queued and flushed at the configured interval.
   */
  async sendWebhook(
    event: TWebhookEventName,
    data: IWebhookEventData,
    metadata?: TWebhookMetadata,
  ): Promise<void> {
    if (!this.pluginOptions.events.includes(event)) return;

    const payload: IWebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data: this.pluginOptions.payloadTransformer(event, data),
      ...(metadata && { metadata }),
    };
    if (data.executionId) payload.executionId = data.executionId;
    if (data.sessionId) payload.sessionId = data.sessionId;
    if (data.userId) payload.userId = data.userId;

    this.logger.debug('Sending webhook', {
      event,
      endpointCount: this.getEndpointsForEvent(event).length,
    });

    if (this.pluginOptions.batching.enabled) {
      await this.queue.enqueueBatch(
        payload,
        this.pluginOptions.batching.maxSize,
        this.getEndpointsForEvent.bind(this),
      );
    } else {
      await this.queue.sendToEndpoints(
        payload,
        this.getEndpointsForEvent.bind(this),
        this.pluginOptions.async,
      );
    }
  }

  /**
   * Sends a webhook with the `custom` event type.
   */
  async sendCustomWebhook(data: IWebhookEventData, metadata?: TWebhookMetadata): Promise<void> {
    await this.sendWebhook('custom', data, metadata);
  }

  /**
   * Get webhook plugin statistics
   */
  override getStats(): IWebhookPluginStats {
    const base = super.getStats();
    return {
      ...base,
      endpointCount: this.pluginOptions.endpoints.length,
      queueLength: this.queue.queueLength,
      batchQueueLength: this.queue.batchQueueLength,
      activeConcurrency: this.queue.activeConcurrency,
      supportedEvents: this.pluginOptions.events,
      totalSent: this.queue.totalSentCount,
      totalErrors: this.queue.totalErrorCount,
      averageResponseTime:
        this.queue.totalSentCount > 0
          ? this.queue.totalResponseTime / this.queue.totalSentCount
          : 0,
    };
  }

  /**
   * Clear webhook queue
   */
  clearQueue(): void {
    this.queue.clearQueues();
    this.logger.info('Webhook queues cleared');
  }

  /**
   * Flushes pending batches, clears request queues, and stops the batch timer.
   */
  async destroy(): Promise<void> {
    this.queue.stopBatchTimer();
    await this.queue.drainBatch(this.getEndpointsForEvent.bind(this));
    this.clearQueue();
    this.logger.info('WebhookPlugin destroyed');
  }

  private getEndpointsForEvent(event: TWebhookEventName): IWebhookEndpoint[] {
    return this.pluginOptions.endpoints.filter((endpoint) => {
      if (!endpoint.events || endpoint.events.length === 0) return true;
      return endpoint.events.includes(event);
    });
  }
}
