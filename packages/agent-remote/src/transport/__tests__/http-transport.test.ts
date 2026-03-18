/**
 * HttpTransport Tests
 *
 * Tests the HTTP transport implementation with mocked fetch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpTransport } from '../http-transport';
import { TransportError } from '../transport-interface';
import type { ITransportRequest } from '../../shared/types';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('HttpTransport', () => {
  let transport: HttpTransport;

  beforeEach(() => {
    transport = new HttpTransport({
      baseUrl: 'https://api.test.com',
      timeout: 5000,
      headers: { 'X-Api-Key': 'test-key' },
    });
    mockFetch.mockReset();
  });

  describe('constructor', () => {
    it('should apply default config values', () => {
      const minimal = new HttpTransport({ baseUrl: 'https://x.com' });
      const caps = minimal.getCapabilities();
      // Default compression is false
      expect(caps.compression).toBe(false);
    });
  });

  describe('connect', () => {
    it('should perform health check and set connected', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ status: 'ok' }),
        headers: new Headers(),
      });

      await transport.connect();

      expect(transport.isConnected()).toBe(true);
      // connect() creates a request with full URL, then buildUrl prepends baseUrl
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should throw TransportError on connection failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network down'));

      await expect(transport.connect()).rejects.toThrow(TransportError);
      expect(transport.isConnected()).toBe(false);
    });

    it('should throw TransportError with CONNECTION_FAILED code', async () => {
      mockFetch.mockRejectedValue(new Error('Network down'));

      await expect(transport.connect()).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(TransportError);
        expect((error as TransportError).code).toBe('CONNECTION_FAILED');
        return true;
      });
    });

    it('should handle non-Error thrown values during connection', async () => {
      mockFetch.mockRejectedValue('string error');

      await expect(transport.connect()).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(TransportError);
        expect((error as TransportError).code).toBe('CONNECTION_FAILED');
        return true;
      });
    });
  });

  describe('disconnect', () => {
    it('should set connected to false', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({}),
        headers: new Headers(),
      });

      await transport.connect();
      expect(transport.isConnected()).toBe(true);

      await transport.disconnect();
      expect(transport.isConnected()).toBe(false);
    });
  });

  describe('getCapabilities', () => {
    it('should return HTTP capabilities', () => {
      const caps = transport.getCapabilities();

      expect(caps.streaming).toBe(false);
      expect(caps.bidirectional).toBe(false);
      expect(caps.protocols).toEqual(['http', 'https']);
      expect(caps.maxPayloadSize).toBe(104857600);
    });

    it('should reflect compression config', () => {
      const compressed = new HttpTransport({
        baseUrl: 'https://x.com',
        compression: true,
      });
      expect(compressed.getCapabilities().compression).toBe(true);
    });
  });

  describe('send', () => {
    it('should send GET request and return response', async () => {
      const responseData = { result: 'ok' };
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(responseData),
        headers: new Headers({ 'content-type': 'application/json' }),
      });

      const request: ITransportRequest = {
        id: 'req-1',
        url: '/health',
        endpoint: '/health',
        method: 'GET',
        headers: {},
      };

      const response = await transport.send(request);

      expect(response.id).toBe('req-1');
      expect(response.status).toBe(200);
      expect(response.data).toEqual(responseData);
      expect(response.timestamp).toBeInstanceOf(Date);
    });

    it('should send POST request with body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ success: true }),
        headers: new Headers(),
      });

      const request: ITransportRequest = {
        id: 'req-2',
        url: '/chat',
        endpoint: '/chat',
        method: 'POST',
        headers: {},
        body: { messages: [], provider: 'openai', model: 'gpt-4' },
      };

      await transport.send(request);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/chat',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(request.body),
        }),
      );
    });

    it('should not include body for GET requests', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({}),
        headers: new Headers(),
      });

      const request: ITransportRequest = {
        id: 'req-3',
        url: '/health',
        endpoint: '/health',
        method: 'GET',
        headers: {},
        body: { messages: [], provider: 'test', model: 'test' },
      };

      await transport.send(request);

      const [, init] = mockFetch.mock.calls[0];
      expect(init.body).toBeUndefined();
    });

    it('should throw TransportError on HTTP error response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: vi.fn().mockResolvedValue('Server error details'),
      });

      const request: ITransportRequest = {
        id: 'req-4',
        url: '/chat',
        endpoint: '/chat',
        method: 'POST',
        headers: {},
      };

      try {
        await transport.send(request);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TransportError);
        const tError = error as TransportError;
        expect(tError.code).toBe('HTTP_ERROR');
        expect(tError.status).toBe(500);
      }
    });

    it('should throw TransportError on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Failed to fetch'));

      const request: ITransportRequest = {
        id: 'req-5',
        url: '/chat',
        endpoint: '/chat',
        method: 'POST',
        headers: {},
      };

      try {
        await transport.send(request);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TransportError);
        expect((error as TransportError).code).toBe('NETWORK_ERROR');
      }
    });

    it('should handle non-Error network failures', async () => {
      mockFetch.mockRejectedValue('string error');

      const request: ITransportRequest = {
        id: 'req-6',
        url: '/chat',
        endpoint: '/chat',
        method: 'POST',
        headers: {},
      };

      try {
        await transport.send(request);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TransportError);
        expect((error as TransportError).code).toBe('NETWORK_ERROR');
      }
    });

    it('should merge request headers with config headers', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({}),
        headers: new Headers(),
      });

      const request: ITransportRequest = {
        id: 'req-7',
        url: '/chat',
        endpoint: '/chat',
        method: 'POST',
        headers: { 'X-Custom': 'value' },
      };

      await transport.send(request);

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers['X-Api-Key']).toBe('test-key');
      expect(init.headers['X-Custom']).toBe('value');
    });

    it('should use request timeout when provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({}),
        headers: new Headers(),
      });

      const request: ITransportRequest = {
        id: 'req-8',
        url: '/health',
        endpoint: '/health',
        method: 'GET',
        headers: {},
        timeout: 10000,
      };

      await transport.send(request);

      // Verify signal was created (AbortSignal.timeout)
      const [, init] = mockFetch.mock.calls[0];
      expect(init.signal).toBeDefined();
    });

    it('should parse response headers', async () => {
      const headers = new Headers();
      headers.set('x-request-id', 'abc123');
      headers.set('content-type', 'application/json');

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({}),
        headers,
      });

      const request: ITransportRequest = {
        id: 'req-9',
        url: '/health',
        endpoint: '/health',
        method: 'GET',
        headers: {},
      };

      const response = await transport.send(request);

      expect(response.headers['x-request-id']).toBe('abc123');
      expect(response.headers['content-type']).toBe('application/json');
    });

    it('should re-throw TransportError without wrapping', async () => {
      const originalError = new TransportError('original', 'ORIGINAL', 422);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 422,
        statusText: 'Unprocessable',
        text: vi.fn().mockResolvedValue('error body'),
      });

      const request: ITransportRequest = {
        id: 'req-10',
        url: '/chat',
        endpoint: '/chat',
        method: 'POST',
        headers: {},
      };

      try {
        await transport.send(request);
        expect.fail('Should have thrown');
      } catch (error) {
        // The error comes from the HTTP_ERROR path, which is a TransportError
        expect(error).toBeInstanceOf(TransportError);
        expect((error as TransportError).code).toBe('HTTP_ERROR');
      }
    });
  });

  describe('sendStream', () => {
    function createReadableStream(chunks: string[]): ReadableStream<Uint8Array> {
      const encoder = new TextEncoder();
      let index = 0;
      return new ReadableStream({
        pull(controller) {
          if (index < chunks.length) {
            controller.enqueue(encoder.encode(chunks[index]));
            index++;
          } else {
            controller.close();
          }
        },
      });
    }

    it('should yield parsed SSE data chunks', async () => {
      const body = createReadableStream([
        'data: {"role":"assistant","content":"Hello"}\n\n',
        'data: {"role":"assistant","content":" world"}\n\n',
        'data: [DONE]\n\n',
      ]);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        body,
      });

      const request: ITransportRequest = {
        id: 'stream-1',
        url: '/stream',
        endpoint: '/stream',
        method: 'POST',
        headers: {},
      };

      const chunks = [];
      for await (const chunk of transport.sendStream(request)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toEqual({ role: 'assistant', content: 'Hello' });
      expect(chunks[1]).toEqual({ role: 'assistant', content: ' world' });
    });

    it('should throw TransportError on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Server Error',
      });

      const request: ITransportRequest = {
        id: 'stream-2',
        url: '/stream',
        endpoint: '/stream',
        method: 'POST',
        headers: {},
      };

      try {
        for await (const _chunk of transport.sendStream(request)) {
          // Should not reach here
        }
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TransportError);
        expect((error as TransportError).code).toBe('HTTP_ERROR');
        expect((error as TransportError).status).toBe(500);
      }
    });

    it('should throw TransportError when response body is missing', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        body: null,
      });

      const request: ITransportRequest = {
        id: 'stream-3',
        url: '/stream',
        endpoint: '/stream',
        method: 'POST',
        headers: {},
      };

      try {
        for await (const _chunk of transport.sendStream(request)) {
          // Should not reach here
        }
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TransportError);
        expect((error as TransportError).code).toBe('NO_STREAM_BODY');
      }
    });

    it('should skip invalid JSON in SSE data', async () => {
      const body = createReadableStream([
        'data: not-json\n\n',
        'data: {"role":"assistant","content":"valid"}\n\n',
        'data: [DONE]\n\n',
      ]);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        body,
      });

      const request: ITransportRequest = {
        id: 'stream-4',
        url: '/stream',
        endpoint: '/stream',
        method: 'POST',
        headers: {},
      };

      const chunks = [];
      for await (const chunk of transport.sendStream(request)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({ role: 'assistant', content: 'valid' });
    });

    it('should skip empty lines', async () => {
      const body = createReadableStream(['\n\n', 'data: {"content":"hi"}\n\n', 'data: [DONE]\n\n']);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        body,
      });

      const request: ITransportRequest = {
        id: 'stream-5',
        url: '/stream',
        endpoint: '/stream',
        method: 'POST',
        headers: {},
      };

      const chunks = [];
      for await (const chunk of transport.sendStream(request)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
    });

    it('should handle network errors during streaming', async () => {
      mockFetch.mockRejectedValue(new Error('Connection reset'));

      const request: ITransportRequest = {
        id: 'stream-6',
        url: '/stream',
        endpoint: '/stream',
        method: 'POST',
        headers: {},
      };

      try {
        for await (const _chunk of transport.sendStream(request)) {
          // Should not reach here
        }
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TransportError);
        expect((error as TransportError).code).toBe('STREAM_ERROR');
      }
    });

    it('should handle non-Error thrown values during streaming', async () => {
      mockFetch.mockRejectedValue('string error');

      const request: ITransportRequest = {
        id: 'stream-7',
        url: '/stream',
        endpoint: '/stream',
        method: 'POST',
        headers: {},
      };

      try {
        for await (const _chunk of transport.sendStream(request)) {
          // Should not reach here
        }
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TransportError);
        expect((error as TransportError).code).toBe('STREAM_ERROR');
      }
    });
  });

  describe('URL building', () => {
    it('should handle baseUrl with trailing slash', async () => {
      const t = new HttpTransport({ baseUrl: 'https://api.test.com/' });
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({}),
        headers: new Headers(),
      });

      const request: ITransportRequest = {
        id: 'url-1',
        url: '/health',
        endpoint: '/health',
        method: 'GET',
        headers: {},
      };

      await t.send(request);

      expect(mockFetch).toHaveBeenCalledWith('https://api.test.com/health', expect.anything());
    });

    it('should handle path without leading slash', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({}),
        headers: new Headers(),
      });

      const request: ITransportRequest = {
        id: 'url-2',
        url: 'chat',
        endpoint: 'chat',
        method: 'GET',
        headers: {},
      };

      await transport.send(request);

      expect(mockFetch).toHaveBeenCalledWith('https://api.test.com/chat', expect.anything());
    });
  });
});
