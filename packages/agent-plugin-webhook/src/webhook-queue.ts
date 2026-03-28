/**
 * Webhook Plugin - Queue and batch management.
 *
 * Extracted from webhook-plugin.ts to keep each file under 300 lines.
 * @internal
 */

import { type ILogger, type TTimerId } from '@robota-sdk/agent-core';
import type {
  TWebhookEventName,
  IWebhookPayload,
  IWebhookEndpoint,
  IWebhookRequest,
} from './types';
import { WebhookHttpClient } from './http-client';

/** Manages the async request queue, batch queue, and concurrency for WebhookPlugin. @internal */
export class WebhookQueueManager {
  private requestQueue: IWebhookRequest[] = [];
  private batchQueue: IWebhookPayload[] = [];
  private batchTimer?: TTimerId;
  activeConcurrency = 0;
  totalSentCount = 0;
  totalErrorCount = 0;
  totalResponseTime = 0;

  constructor(
    private readonly logger: ILogger,
    private readonly httpClient: WebhookHttpClient,
    private readonly maxConcurrency: number,
  ) {}

  get queueLength(): number {
    return this.requestQueue.length;
  }

  get batchQueueLength(): number {
    return this.batchQueue.length;
  }

  setupBatching(
    flushInterval: number,
    getEndpoints: (event: TWebhookEventName) => IWebhookEndpoint[],
  ): void {
    this.batchTimer = setInterval(() => {
      this.drainBatch(getEndpoints);
    }, flushInterval);
  }

  async enqueueBatch(
    payload: IWebhookPayload,
    maxSize: number,
    getEndpoints: (event: TWebhookEventName) => IWebhookEndpoint[],
  ): Promise<void> {
    this.batchQueue.push(payload);
    if (this.batchQueue.length >= maxSize) {
      await this.drainBatch(getEndpoints);
    }
  }

  async sendToEndpoints(
    payload: IWebhookPayload,
    getEndpoints: (event: TWebhookEventName) => IWebhookEndpoint[],
    async_: boolean = true,
  ): Promise<void> {
    const endpoints = getEndpoints(payload.event);
    if (endpoints.length === 0) return;

    const requests: IWebhookRequest[] = endpoints.map((endpoint) => ({
      endpoint,
      payload,
      attempt: 1,
      timestamp: new Date(),
    }));

    if (async_) {
      this.requestQueue.push(...requests);
      this.processQueue();
    } else {
      await Promise.allSettled(
        requests.map((req) => {
          const startTime = Date.now();
          return this.httpClient
            .sendRequest(req)
            .then(() => {
              this.totalSentCount++;
              this.totalResponseTime += Date.now() - startTime;
            })
            .catch((error: unknown) => {
              this.totalErrorCount++;
              throw error;
            });
        }),
      );
    }
  }

  private processQueue(): void {
    while (this.requestQueue.length > 0 && this.activeConcurrency < this.maxConcurrency) {
      const request = this.requestQueue.shift();
      if (!request) break;

      this.activeConcurrency++;
      const startTime = Date.now();
      this.httpClient
        .sendRequest(request)
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
            error: message,
          });
        })
        .finally(() => {
          this.activeConcurrency--;
          if (this.requestQueue.length > 0) this.processQueue();
        });
    }
  }

  async drainBatch(getEndpoints: (event: TWebhookEventName) => IWebhookEndpoint[]): Promise<void> {
    if (this.batchQueue.length === 0) return;
    const payloads = [...this.batchQueue];
    this.batchQueue = [];
    this.logger.debug('Flushing webhook batch', { payloadCount: payloads.length });
    for (const payload of payloads) {
      await this.sendToEndpoints(payload, getEndpoints);
    }
  }

  clearQueues(): void {
    this.requestQueue = [];
    this.batchQueue = [];
  }

  stopBatchTimer(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = undefined;
    }
  }
}
