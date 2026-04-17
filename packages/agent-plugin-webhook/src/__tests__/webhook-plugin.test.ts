import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PluginError } from '@robota-sdk/agent-core';
import type {
  IPluginExecutionContext,
  IPluginExecutionResult,
  IPluginErrorContext,
} from '@robota-sdk/agent-core';

// Mock logger before importing WebhookPlugin
vi.mock('@robota-sdk/agent-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-core')>();
  return {
    ...actual,
    createLogger: vi.fn().mockReturnValue({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      isDebugEnabled: vi.fn().mockReturnValue(false),
      setLevel: vi.fn(),
      getLevel: vi.fn().mockReturnValue('warn'),
    }),
  };
});

import { WebhookPlugin } from '../webhook-plugin';
import type { IWebhookEndpoint, IWebhookEventData, TWebhookEventName } from '../types';

function createContext(overrides: Partial<IPluginExecutionContext> = {}): IPluginExecutionContext {
  return {
    executionId: 'exec_1',
    sessionId: 'session_1',
    userId: 'user_1',
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        content: 'hello',
        state: 'complete' as const,
        timestamp: new Date(),
      },
    ],
    config: { model: 'gpt-4' },
    ...overrides,
  };
}

function createResult(overrides: Partial<IPluginExecutionResult> = {}): IPluginExecutionResult {
  return {
    success: true,
    response: 'Hello there',
    duration: 150,
    tokensUsed: 42,
    ...overrides,
  };
}

function createEndpoint(overrides: Partial<IWebhookEndpoint> = {}): IWebhookEndpoint {
  return {
    url: 'https://example.com/webhook',
    ...overrides,
  };
}

describe('WebhookPlugin', () => {
  beforeEach(() => {
    // Mock global fetch
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // ----------------------------------------------------------------
  // Construction
  // ----------------------------------------------------------------
  describe('construction', () => {
    it('should create plugin with valid endpoint', () => {
      const plugin = new WebhookPlugin({
        endpoints: [createEndpoint()],
      });

      expect(plugin.name).toBe('WebhookPlugin');
      expect(plugin.version).toBe('1.0.0');
    });

    it('should throw when no endpoints are provided', () => {
      expect(
        () =>
          new WebhookPlugin({
            endpoints: [],
          }),
      ).toThrow(PluginError);
    });

    it('should throw when endpoints array is missing', () => {
      expect(
        () =>
          new WebhookPlugin({
            endpoints: undefined as unknown as IWebhookEndpoint[],
          }),
      ).toThrow(PluginError);
    });

    it('should throw when endpoint URL is missing', () => {
      expect(
        () =>
          new WebhookPlugin({
            endpoints: [{ url: '' }],
          }),
      ).toThrow(PluginError);
    });

    it('should throw when endpoint URL is invalid', () => {
      expect(
        () =>
          new WebhookPlugin({
            endpoints: [{ url: 'not-a-url' }],
          }),
      ).toThrow(PluginError);
    });

    it('should accept multiple endpoints', () => {
      const plugin = new WebhookPlugin({
        endpoints: [
          createEndpoint({ url: 'https://a.com/hook' }),
          createEndpoint({ url: 'https://b.com/hook' }),
        ],
      });

      const stats = plugin.getStats();
      expect(stats.endpointCount).toBe(2);
    });

    it('should throw when endpoint URL uses file:// scheme', () => {
      expect(
        () =>
          new WebhookPlugin({
            endpoints: [{ url: 'file:///etc/passwd' }],
          }),
      ).toThrow(PluginError);
      expect(
        () =>
          new WebhookPlugin({
            endpoints: [{ url: 'file:///etc/passwd' }],
          }),
      ).toThrow('Webhook endpoint URL must use http or https');
    });

    it('should throw when endpoint URL uses ftp:// scheme', () => {
      expect(
        () =>
          new WebhookPlugin({
            endpoints: [{ url: 'ftp://example.com/data' }],
          }),
      ).toThrow(PluginError);
    });

    it('should accept http:// endpoint URL', () => {
      const plugin = new WebhookPlugin({
        endpoints: [{ url: 'http://localhost:3000/hook' }],
      });
      expect(plugin.name).toBe('WebhookPlugin');
    });

    it('should accept https:// endpoint URL', () => {
      const plugin = new WebhookPlugin({
        endpoints: [{ url: 'https://example.com/hook' }],
      });
      expect(plugin.name).toBe('WebhookPlugin');
    });

    it('should throw on invalid event filter in endpoint', () => {
      expect(
        () =>
          new WebhookPlugin({
            endpoints: [
              {
                url: 'https://example.com/hook',
                events: ['invalid.event' as TWebhookEventName],
              },
            ],
          }),
      ).toThrow(PluginError);
    });
  });

  // ----------------------------------------------------------------
  // Event filtering
  // ----------------------------------------------------------------
  describe('event filtering', () => {
    it('should skip events not in plugin event list', async () => {
      const plugin = new WebhookPlugin({
        endpoints: [createEndpoint()],
        events: ['error.occurred'],
        async: false,
      });

      // This event is not in the events list, so fetch should not be called
      await plugin.sendWebhook('custom', { executionId: 'test' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should send events that are in the plugin event list', async () => {
      const plugin = new WebhookPlugin({
        endpoints: [createEndpoint()],
        events: ['custom'],
        async: false,
      });

      await plugin.sendWebhook('custom', { executionId: 'test' });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should filter endpoints by their event subscriptions', async () => {
      const plugin = new WebhookPlugin({
        endpoints: [
          { url: 'https://a.com/hook', events: ['error.occurred'] },
          { url: 'https://b.com/hook', events: ['custom'] },
        ],
        events: ['custom', 'error.occurred'],
        async: false,
      });

      await plugin.sendWebhook('custom', { executionId: 'test' });

      // Only endpoint B should receive the custom event
      expect(fetch).toHaveBeenCalledTimes(1);
      const callUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(callUrl).toBe('https://b.com/hook');
    });

    it('should send to endpoint with no event filter (receives all)', async () => {
      const plugin = new WebhookPlugin({
        endpoints: [
          { url: 'https://all.com/hook' }, // no events filter = all events
        ],
        events: ['custom'],
        async: false,
      });

      await plugin.sendWebhook('custom', { executionId: 'test' });
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  // ----------------------------------------------------------------
  // Lifecycle hooks
  // ----------------------------------------------------------------
  describe('lifecycle hooks', () => {
    it('should send webhook on afterExecution', async () => {
      const plugin = new WebhookPlugin({
        endpoints: [createEndpoint()],
        async: false,
      });

      await plugin.afterExecution(createContext(), createResult());
      expect(fetch).toHaveBeenCalled();
    });

    it('should send webhook on afterConversation', async () => {
      const plugin = new WebhookPlugin({
        endpoints: [createEndpoint()],
        async: false,
      });

      await plugin.afterConversation(createContext(), createResult());
      expect(fetch).toHaveBeenCalled();
    });

    it('should send webhook on onError', async () => {
      const plugin = new WebhookPlugin({
        endpoints: [createEndpoint()],
        async: false,
      });

      const error = new Error('Test error');
      const errorContext: IPluginErrorContext = {
        action: 'test',
        executionId: 'exec_1',
        sessionId: 'session_1',
        userId: 'user_1',
      };

      await plugin.onError(error, errorContext);
      // onError sends two webhooks: error.occurred and execution.error
      expect(fetch).toHaveBeenCalled();
    });

    it('should send webhook on afterToolExecution with tool calls', async () => {
      const plugin = new WebhookPlugin({
        endpoints: [createEndpoint()],
        async: false,
      });

      const resultWithTools = createResult({
        toolCalls: [
          { id: 'tool-1', name: 'search', result: 'found' },
          { id: 'tool-2', name: 'calc', result: '42' },
        ],
      });

      await plugin.afterToolExecution(createContext(), resultWithTools);
      // Should send one webhook per tool call
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should not send on afterToolExecution with no tool calls', async () => {
      const plugin = new WebhookPlugin({
        endpoints: [createEndpoint()],
        async: false,
      });

      await plugin.afterToolExecution(createContext(), createResult());
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // Custom webhooks
  // ----------------------------------------------------------------
  describe('sendCustomWebhook', () => {
    it('should send a custom event webhook', async () => {
      const plugin = new WebhookPlugin({
        endpoints: [createEndpoint()],
        events: ['custom'],
        async: false,
      });

      await plugin.sendCustomWebhook({ executionId: 'test-exec' });
      expect(fetch).toHaveBeenCalledTimes(1);

      const body = JSON.parse(
        (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
      ) as Record<string, unknown>;
      expect(body.event).toBe('custom');
    });
  });

  // ----------------------------------------------------------------
  // Payload structure
  // ----------------------------------------------------------------
  describe('payload structure', () => {
    it('should include event, timestamp, and data in payload', async () => {
      const plugin = new WebhookPlugin({
        endpoints: [createEndpoint()],
        events: ['custom'],
        async: false,
      });

      await plugin.sendWebhook('custom', {
        executionId: 'exec-123',
        sessionId: 'sess-456',
      });

      const body = JSON.parse(
        (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
      ) as Record<string, unknown>;
      expect(body.event).toBe('custom');
      expect(body.timestamp).toBeDefined();
      expect(body.executionId).toBe('exec-123');
      expect(body.sessionId).toBe('sess-456');
    });

    it('should include metadata when provided', async () => {
      const plugin = new WebhookPlugin({
        endpoints: [createEndpoint()],
        events: ['custom'],
        async: false,
      });

      await plugin.sendWebhook('custom', { executionId: 'test' }, { source: 'test-suite' });

      const body = JSON.parse(
        (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
      ) as Record<string, unknown>;
      expect(body.metadata).toEqual({ source: 'test-suite' });
    });
  });

  // ----------------------------------------------------------------
  // Batching
  // ----------------------------------------------------------------
  describe('batching', () => {
    it('should queue payloads when batching is enabled', async () => {
      const plugin = new WebhookPlugin({
        endpoints: [createEndpoint()],
        events: ['custom'],
        async: false,
        batching: { enabled: true, maxSize: 5, flushInterval: 60000 },
      });

      await plugin.sendWebhook('custom', { executionId: '1' });
      await plugin.sendWebhook('custom', { executionId: '2' });

      // Not flushed yet because batch size is 5
      expect(fetch).not.toHaveBeenCalled();

      const stats = plugin.getStats();
      expect(stats.batchQueueLength).toBe(2);

      await plugin.destroy();
    });

    it('should auto-flush when batch reaches maxSize', async () => {
      const plugin = new WebhookPlugin({
        endpoints: [createEndpoint()],
        events: ['custom'],
        async: false,
        batching: { enabled: true, maxSize: 2, flushInterval: 60000 },
      });

      await plugin.sendWebhook('custom', { executionId: '1' });
      await plugin.sendWebhook('custom', { executionId: '2' });

      // Should have flushed since we hit maxSize of 2
      expect(fetch).toHaveBeenCalledTimes(2);

      await plugin.destroy();
    });
  });

  // ----------------------------------------------------------------
  // Statistics
  // ----------------------------------------------------------------
  describe('getStats', () => {
    it('should return complete stats', async () => {
      const plugin = new WebhookPlugin({
        endpoints: [createEndpoint(), createEndpoint({ url: 'https://b.com/hook' })],
        events: ['custom'],
        async: false,
      });

      await plugin.sendWebhook('custom', { executionId: 'test' });

      const stats = plugin.getStats();
      expect(stats.endpointCount).toBe(2);
      expect(stats.totalSent).toBe(2); // sent to both endpoints
      expect(stats.totalErrors).toBe(0);
      expect(stats.supportedEvents).toContain('custom');
      expect(typeof stats.averageResponseTime).toBe('number');
    });

    it('should track errors in stats', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const plugin = new WebhookPlugin({
        endpoints: [
          {
            url: 'https://example.com/hook',
            retries: 0,
            timeout: 100,
          },
        ],
        events: ['custom'],
        async: false,
      });

      // sendWebhook catches errors internally and tracks them in stats
      await plugin.sendWebhook('custom', { executionId: 'test' });

      const stats = plugin.getStats();
      expect(stats.totalErrors).toBeGreaterThan(0);
    });
  });

  // ----------------------------------------------------------------
  // Queue management
  // ----------------------------------------------------------------
  describe('clearQueue', () => {
    it('should clear both request and batch queues', async () => {
      const plugin = new WebhookPlugin({
        endpoints: [createEndpoint()],
        events: ['custom'],
        async: false,
        batching: { enabled: true, maxSize: 100, flushInterval: 60000 },
      });

      await plugin.sendWebhook('custom', { executionId: '1' });
      await plugin.sendWebhook('custom', { executionId: '2' });

      plugin.clearQueue();

      const stats = plugin.getStats();
      expect(stats.queueLength).toBe(0);
      expect(stats.batchQueueLength).toBe(0);

      await plugin.destroy();
    });
  });

  // ----------------------------------------------------------------
  // Destroy
  // ----------------------------------------------------------------
  describe('destroy', () => {
    it('should flush batched payloads on destroy', async () => {
      const plugin = new WebhookPlugin({
        endpoints: [createEndpoint()],
        events: ['custom'],
        async: false,
        batching: { enabled: true, maxSize: 100, flushInterval: 60000 },
      });

      await plugin.sendWebhook('custom', { executionId: '1' });
      expect(fetch).not.toHaveBeenCalled();

      await plugin.destroy();
      expect(fetch).toHaveBeenCalled();
    });

    it('should complete without error when queue is empty', async () => {
      const plugin = new WebhookPlugin({
        endpoints: [createEndpoint()],
      });

      await expect(plugin.destroy()).resolves.not.toThrow();
    });
  });

  // ----------------------------------------------------------------
  // Payload transformer
  // ----------------------------------------------------------------
  describe('payload transformer', () => {
    it('should apply custom payload transformer', async () => {
      const transformer = vi.fn((_event: TWebhookEventName, data: IWebhookEventData) => ({
        ...data,
        executionId: 'transformed',
      }));

      const plugin = new WebhookPlugin({
        endpoints: [createEndpoint()],
        events: ['custom'],
        async: false,
        payloadTransformer: transformer,
      });

      await plugin.sendWebhook('custom', { executionId: 'original' });

      expect(transformer).toHaveBeenCalledWith(
        'custom',
        expect.objectContaining({ executionId: 'original' }),
      );

      const body = JSON.parse(
        (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
      ) as Record<string, unknown>;
      const data = body.data as Record<string, unknown>;
      expect(data.executionId).toBe('transformed');
    });
  });
});
