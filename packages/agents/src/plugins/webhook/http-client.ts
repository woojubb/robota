/**
 * Webhook HTTP client for sending webhook requests
 * Handles retries, timeouts, and error scenarios
 */

import { createHmac } from 'crypto';
import type { WebhookRequest } from './types';
import { Logger } from '../../utils/logger';

/**
 * HTTP client for webhook requests
 */
export class WebhookHttpClient {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /**
     * Send a single webhook request with retries
     */
    async sendRequest(request: WebhookRequest): Promise<void> {
        const { endpoint, payload, attempt } = request;
        const timeout = endpoint.timeout ?? 5000;
        const maxRetries = endpoint.retries ?? 3;

        try {
            // Prepare request body
            const body = JSON.stringify(payload);

            // Prepare headers
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'User-Agent': 'robota-webhook/1.0.0',
                ...endpoint.headers
            };

            // Add signature if secret is provided
            if (endpoint.secret) {
                const signature = this.generateSignature(body, endpoint.secret);
                headers['X-Webhook-Signature'] = signature;
            }

            // Make HTTP request
            const response = await this.makeHttpRequest(endpoint.url, {
                method: 'POST',
                headers,
                body,
                timeout
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            this.logger.debug('Webhook sent successfully', {
                url: endpoint.url,
                event: payload.event,
                attempt,
                status: response.status
            });

        } catch (error) {
            this.logger.error('Webhook request failed', {
                url: endpoint.url,
                event: payload.event,
                attempt,
                error: error instanceof Error ? error.message : String(error)
            });

            // Retry if we haven't exceeded max attempts
            if (attempt < maxRetries) {
                const retryRequest: WebhookRequest = {
                    ...request,
                    attempt: attempt + 1
                };

                // Exponential backoff
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                await this.delay(delay);

                return this.sendRequest(retryRequest);
            }

            // Max retries exceeded
            throw error;
        }
    }

    /**
     * Generate HMAC signature for webhook security
     */
    private generateSignature(body: string, secret: string): string {
        return createHmac('sha256', secret)
            .update(body)
            .digest('hex');
    }

    /**
     * Make HTTP request with timeout support
     */
    private async makeHttpRequest(url: string, options: {
        method: string;
        headers: Record<string, string>;
        body: string;
        timeout: number;
    }): Promise<Response> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), options.timeout);

        try {
            const response = await fetch(url, {
                method: options.method,
                headers: options.headers,
                body: options.body,
                signal: controller.signal
            });

            return response;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Delay utility for retry backoff
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
} 