/**
 * Webhook Plugin - Validation helpers and event constants.
 *
 * Extracted from webhook-plugin.ts to keep each file under 300 lines.
 * @internal
 */

import { PluginError, EXECUTION_EVENTS, EXECUTION_EVENT_PREFIX } from '@robota-sdk/agent-core';
import type { TWebhookEventName, IWebhookEndpoint } from './types';

/** Local execution event names used by WebhookPlugin. @internal */
export const WEBHOOK_EXEC_EVENTS = {
  START: `${EXECUTION_EVENT_PREFIX}.${EXECUTION_EVENTS.START}` as TWebhookEventName,
  COMPLETE: `${EXECUTION_EVENT_PREFIX}.${EXECUTION_EVENTS.COMPLETE}` as TWebhookEventName,
  ERROR: `${EXECUTION_EVENT_PREFIX}.${EXECUTION_EVENTS.ERROR}` as TWebhookEventName,
} as const;

export const WEBHOOK_CONV_EVENTS = {
  COMPLETE: 'conversation.complete' as TWebhookEventName,
} as const;
export const WEBHOOK_TOOL_EVENTS = { EXECUTED: 'tool.executed' as TWebhookEventName } as const;
export const WEBHOOK_ERROR_EVENTS = { OCCURRED: 'error.occurred' as TWebhookEventName } as const;

/**
 * Validate all configured webhook endpoints. Throws PluginError for any
 * invalid URL or unsupported event name. @internal
 */
export function validateWebhookEndpoints(
  endpoints: IWebhookEndpoint[],
  pluginName: string,
  validEvents: TWebhookEventName[],
): void {
  for (const endpoint of endpoints) {
    if (!endpoint.url) {
      throw new PluginError(`Webhook endpoint URL is required`, pluginName);
    }

    let parsed: URL;
    try {
      parsed = new URL(endpoint.url);
    } catch {
      throw new PluginError(`Invalid webhook URL: ${endpoint.url}`, pluginName);
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new PluginError(
        `Webhook endpoint URL must use http or https: ${endpoint.url}`,
        pluginName,
      );
    }

    if (endpoint.events) {
      for (const event of endpoint.events) {
        if (!validEvents.includes(event)) {
          throw new PluginError(`Invalid webhook event: ${event}`, pluginName);
        }
      }
    }
  }
}
