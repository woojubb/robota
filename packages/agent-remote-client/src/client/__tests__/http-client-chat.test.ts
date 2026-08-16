/**
 * HttpClient chat and chatStream Tests
 *
 * Tests the chat-specific methods of HttpClient that were not covered
 * by the existing http-client.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpClient, type IHttpClientConfig } from '../http-client';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('HttpClient chat methods', () => {
  let httpClient: HttpClient;

  beforeEach(() => {
    const config: IHttpClientConfig = {
      baseUrl: 'https://api.test.com',
      timeout: 30000,
      headers: { Authorization: 'Bearer test-key' },
    };
    httpClient = new HttpClient(config);
    mockFetch.mockReset();
  });

  describe('chat', () => {
    it('should send chat request and return response message', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          id: 'msg_1',
          role: 'assistant',
          content: 'Hello!',
          state: 'complete',
        }),
        headers: new Map(),
      });

      const messages = [{ role: 'user' as const, content: 'Hi' }];
      const result = await httpClient.chat(messages, 'openai', 'gpt-4');

      expect(result.role).toBe('assistant');
      expect(result.content).toBe('Hello!');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4');
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('passes the run signal to fetch so a remote call is cancellable (CORE-042)', async () => {
      // `fetch` was called with no `signal` at all, so an aborted run left the request in flight and
      // the turn waiting on it -- the remote seam was the one provider call that could not be
      // cancelled. This asserts the option arrives; CORE-044 owns the rest of `IChatOptions`, which
      // needs a wire-schema change this does not.
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ role: 'assistant', content: 'ok', state: 'complete' }),
        headers: new Map(),
      });

      const controller = new AbortController();
      await httpClient.chat(
        [{ role: 'user' as const, content: 'Hi' }],
        'openai',
        'gpt-4',
        undefined,
        { signal: controller.signal },
      );

      const init = mockFetch.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(init?.signal).toBe(controller.signal);
    });

    it('carries the per-call options in the request body (CORE-044)', async () => {
      // The body was `{ messages, provider, model, tools }`. A caller's toolChoice, maxTokens,
      // temperature and effort went nowhere, and the model behaved as though nothing had been asked.
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ role: 'assistant', content: 'ok', state: 'complete' }),
        headers: new Map(),
      });

      await httpClient.chat(
        [{ role: 'user' as const, content: 'Hi' }],
        'openai',
        'gpt-4',
        undefined,
        {
          maxTokens: 256,
          temperature: 0.4,
          effort: 'high',
          toolChoice: 'required',
        },
      );

      const init = mockFetch.mock.calls[0]?.[1] as RequestInit | undefined;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body['options']).toEqual({
        maxTokens: 256,
        temperature: 0.4,
        effort: 'high',
        toolChoice: 'required',
      });
      // One object, not parallel top-level fields: adding an option must not mean touching the body
      // shape, the server destructure and both of their tests.
      expect(body['toolChoice']).toBeUndefined();
      expect(body['maxTokens']).toBeUndefined();
    });

    it('surfaces an abort as an AbortError rather than a generic request failure (CORE-042)', async () => {
      // The catch rewrapped every rejection as `Request failed: …`, which erased the `AbortError`
      // name. A caller cannot then tell its own cancellation from a transport fault, and threading
      // the signal in would have been cosmetic.
      mockFetch.mockRejectedValue(Object.assign(new Error('Aborted'), { name: 'AbortError' }));

      await expect(
        httpClient.chat([{ role: 'user' as const, content: 'Hi' }], 'openai', 'gpt-4'),
      ).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('should include tools in request body when provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          role: 'assistant',
          content: 'ok',
          state: 'complete',
        }),
        headers: new Map(),
      });

      const tools = [
        {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object' as const, properties: {} },
        },
      ];
      await httpClient.chat(
        [{ role: 'user' as const, content: 'weather?' }],
        'openai',
        'gpt-4',
        tools,
      );

      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.tools).toEqual(tools);
    });

    it('should not include tools when array is empty', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          role: 'assistant',
          content: 'ok',
          state: 'complete',
        }),
        headers: new Map(),
      });

      await httpClient.chat([{ role: 'user' as const, content: 'hi' }], 'openai', 'gpt-4', []);

      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.tools).toBeUndefined();
    });

    it('should preserve toolCalls from response', async () => {
      const toolCalls = [
        {
          id: 'call_1',
          type: 'function' as const,
          function: { name: 'get_weather', arguments: '{"city":"Seoul"}' },
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          role: 'assistant',
          content: '',
          toolCalls,
          state: 'complete',
        }),
        headers: new Map(),
      });

      const result = await httpClient.chat(
        [{ role: 'user' as const, content: 'weather in Seoul?' }],
        'openai',
        'gpt-4',
      );

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls?.[0].id).toBe('call_1');
    });

    it('should handle assistant messages with toolCalls in request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          role: 'assistant',
          content: 'done',
          state: 'complete',
        }),
        headers: new Map(),
      });

      const messages = [
        {
          role: 'assistant' as const,
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              type: 'function' as const,
              function: { name: 'get_weather', arguments: '{}' },
            },
          ],
        },
        {
          role: 'tool' as const,
          content: '{"temp": 20}',
          toolCallId: 'call_1',
        },
      ];

      await httpClient.chat(messages, 'openai', 'gpt-4');

      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.messages[0].toolCalls).toHaveLength(1);
      expect(body.messages[1].toolCallId).toBe('call_1');
    });

    it('should handle missing data in response gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({}),
        headers: new Map(),
      });

      const result = await httpClient.chat(
        [{ role: 'user' as const, content: 'hi' }],
        'openai',
        'gpt-4',
      );

      // Should default to assistant role and empty content
      expect(result.role).toBe('assistant');
      expect(result.content).toBe('');
    });

    it('should handle unknown role in response by defaulting to assistant', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          role: 'unknown_role',
          content: 'test',
          state: 'complete',
        }),
        headers: new Map(),
      });

      const result = await httpClient.chat(
        [{ role: 'user' as const, content: 'hi' }],
        'openai',
        'gpt-4',
      );

      expect(result.role).toBe('assistant');
    });

    it('should handle non-string content in response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          role: 'assistant',
          content: 123,
          state: 'complete',
        }),
        headers: new Map(),
      });

      const result = await httpClient.chat(
        [{ role: 'user' as const, content: 'hi' }],
        'openai',
        'gpt-4',
      );

      expect(result.content).toBe('');
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(
        httpClient.chat([{ role: 'user' as const, content: 'hi' }], 'openai', 'gpt-4'),
      ).rejects.toThrow('HTTP 500');
    });

    it('should filter out invalid toolCalls entries', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'call_1', type: 'function', function: { name: 'test', arguments: '{}' } },
            { invalid: 'entry' }, // should be filtered
            null, // should be filtered
          ],
          state: 'complete',
        }),
        headers: new Map(),
      });

      const result = await httpClient.chat(
        [{ role: 'user' as const, content: 'hi' }],
        'openai',
        'gpt-4',
      );

      expect(result.toolCalls).toHaveLength(1);
    });
  });

  // CORE-044: the `chatStream` cases were deleted with the method. They asserted that the client
  // posts to `${baseUrl}/stream` and parses the SSE frames that come back — against an endpoint no
  // server in this repository serves. They passed because the fetch was mocked, which is what let a
  // 404-in-production sit behind a green suite; see the note on SimpleRemoteExecutor.
});
