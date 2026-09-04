import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestJson } from './http-client';
import { decodeCreateVideoTaskResponse, decodeVideoTaskResponse } from './response-decoders';
import type { IBytedanceProviderOptions } from './types';
import type { TProviderMediaResult } from '@robota-sdk/agent-core';

const BASE_OPTIONS: IBytedanceProviderOptions = {
  apiKey: 'test-api-key',
  baseUrl: 'https://api.byteplus.test',
};

/** The transport tests are about the request and the error mapping; the body passes through. */
const passThrough = (value: unknown): TProviderMediaResult<unknown> => ({ ok: true, value });

describe('requestJson', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends GET request with Authorization header', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: '123' }),
    });

    await requestJson(BASE_OPTIONS, { path: '/tasks/123', method: 'GET', decode: passThrough });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.byteplus.test/tasks/123',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-api-key',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('sends POST request with body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: 'new-task' }),
    });

    const body = JSON.stringify({ model: 'seedance' });
    await requestJson(BASE_OPTIONS, { path: '/tasks', method: 'POST', body, decode: passThrough });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.byteplus.test/tasks',
      expect.objectContaining({
        method: 'POST',
        body,
      }),
    );
  });

  it('returns parsed JSON on success', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: 'task-1', status: 'queued' }),
    });

    const result = await requestJson(BASE_OPTIONS, {
      path: '/tasks',
      method: 'GET',
      decode: decodeVideoTaskResponse('getVideoJob'),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ id: 'task-1', status: 'queued' });
    }
  });

  it('includes custom default headers', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({}),
    });

    const options: IBytedanceProviderOptions = {
      ...BASE_OPTIONS,
      defaultHeaders: { 'X-Custom': 'value' },
    };
    await requestJson(options, { path: '/tasks', method: 'GET', decode: passThrough });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Custom': 'value',
        }),
      }),
    );
  });

  it('normalizes base URL trailing slash', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({}),
    });

    await requestJson(
      { ...BASE_OPTIONS, baseUrl: 'https://api.test/' },
      { path: '/path', method: 'GET', decode: passThrough },
    );

    expect(fetchMock).toHaveBeenCalledWith('https://api.test/path', expect.any(Object));
  });

  it('normalizes path without leading slash', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({}),
    });

    await requestJson(BASE_OPTIONS, { path: 'tasks', method: 'GET', decode: passThrough });

    expect(fetchMock).toHaveBeenCalledWith('https://api.byteplus.test/tasks', expect.any(Object));
  });

  describe('HTTP error mapping', () => {
    it('maps 401 to PROVIDER_AUTH_ERROR', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ message: 'Unauthorized' }),
      });

      const result = await requestJson(BASE_OPTIONS, {
        path: '/tasks',
        method: 'GET',
        decode: passThrough,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PROVIDER_AUTH_ERROR');
      }
    });

    it('maps 403 to PROVIDER_AUTH_ERROR', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ message: 'Forbidden' }),
      });

      const result = await requestJson(BASE_OPTIONS, {
        path: '/tasks',
        method: 'GET',
        decode: passThrough,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PROVIDER_AUTH_ERROR');
      }
    });

    it('maps 404 to PROVIDER_JOB_NOT_FOUND', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ message: 'Not found' }),
      });

      const result = await requestJson(BASE_OPTIONS, {
        path: '/tasks/missing',
        method: 'GET',
        decode: passThrough,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PROVIDER_JOB_NOT_FOUND');
      }
    });

    it('maps 409 to PROVIDER_JOB_NOT_CANCELLABLE', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 409,
        text: async () => JSON.stringify({ message: 'Conflict' }),
      });

      const result = await requestJson(BASE_OPTIONS, {
        path: '/tasks/1',
        method: 'DELETE',
        decode: passThrough,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PROVIDER_JOB_NOT_CANCELLABLE');
      }
    });

    it('maps 429 to PROVIDER_RATE_LIMITED', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ message: 'Rate limited' }),
      });

      const result = await requestJson(BASE_OPTIONS, {
        path: '/tasks',
        method: 'POST',
        decode: passThrough,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PROVIDER_RATE_LIMITED');
      }
    });

    it('maps 4xx (not 401/403/404/409/429) to PROVIDER_INVALID_REQUEST', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 422,
        text: async () => JSON.stringify({ message: 'Unprocessable' }),
      });

      const result = await requestJson(BASE_OPTIONS, {
        path: '/tasks',
        method: 'POST',
        decode: passThrough,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PROVIDER_INVALID_REQUEST');
      }
    });

    it('maps 5xx to PROVIDER_UPSTREAM_ERROR', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ message: 'Internal error' }),
      });

      const result = await requestJson(BASE_OPTIONS, {
        path: '/tasks',
        method: 'GET',
        decode: passThrough,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PROVIDER_UPSTREAM_ERROR');
      }
    });

    it('handles non-JSON error response body', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'plain text error',
      });

      const result = await requestJson(BASE_OPTIONS, {
        path: '/tasks',
        method: 'GET',
        decode: passThrough,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PROVIDER_UPSTREAM_ERROR');
        expect(result.error.message).toBe('plain text error');
      }
    });
  });

  it('returns PROVIDER_UPSTREAM_ERROR for invalid JSON success response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => 'not-json',
    });

    const result = await requestJson(BASE_OPTIONS, {
      path: '/tasks',
      method: 'GET',
      decode: passThrough,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_UPSTREAM_ERROR');
      expect(result.error.message).toContain('not valid JSON');
    }
  });

  it('returns PROVIDER_TIMEOUT on AbortError', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);

    const result = await requestJson(
      { ...BASE_OPTIONS, timeoutMs: 1 },
      { path: '/tasks', method: 'GET', decode: passThrough },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_TIMEOUT');
    }
  });

  it('returns PROVIDER_UPSTREAM_ERROR on network error', async () => {
    fetchMock.mockRejectedValue(new Error('Network failure'));

    const result = await requestJson(BASE_OPTIONS, {
      path: '/tasks',
      method: 'GET',
      decode: passThrough,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_UPSTREAM_ERROR');
      expect(result.error.message).toBe('Network failure');
    }
  });

  it('returns PROVIDER_UPSTREAM_ERROR for non-Error thrown value', async () => {
    fetchMock.mockRejectedValue('string error');

    const result = await requestJson(BASE_OPTIONS, {
      path: '/tasks',
      method: 'GET',
      decode: passThrough,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_UPSTREAM_ERROR');
    }
  });

  describe('issue #2166 — a malformed 2xx body is a typed upstream error, not a typed DTO', () => {
    const MALFORMED_2XX: [string, unknown][] = [
      ['an empty object', {}],
      ['an array', [{ id: 'task-1', status: 'queued' }]],
      ['a string', 'task-1'],
      ['a number', 42],
      ['null', null],
      ['a numeric id', { id: 123, status: 'queued' }],
      ['a missing status', { id: 'task-1' }],
      ['a non-string status', { id: 'task-1', status: { code: 'queued' } }],
      ['a non-string video_url', { id: 'task-1', status: 'succeeded', video_url: ['x'] }],
      ['a non-object content', { id: 'task-1', status: 'succeeded', content: 'video' }],
      ['a non-number bytes', { id: 'task-1', status: 'succeeded', bytes: '100' }],
      ['a boolean created_at', { id: 'task-1', status: 'queued', created_at: true }],
    ];

    it.each(MALFORMED_2XX)('task lookup: %s', async (_label, body) => {
      fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify(body) });

      const result = await requestJson(BASE_OPTIONS, {
        path: '/tasks/task-1',
        method: 'GET',
        decode: decodeVideoTaskResponse('getVideoJob'),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PROVIDER_UPSTREAM_ERROR');
        expect(result.error.message).toContain('getVideoJob response is malformed');
      }
    });

    it.each([
      ['an empty object', {}],
      ['an array', []],
      ['a numeric id', { id: 7 }],
      ['a non-string status', { id: 'task-1', status: 1 }],
    ] as [string, unknown][])('task creation: %s', async (_label, body) => {
      fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify(body) });

      const result = await requestJson(BASE_OPTIONS, {
        path: '/tasks',
        method: 'POST',
        body: '{}',
        decode: decodeCreateVideoTaskResponse,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PROVIDER_UPSTREAM_ERROR');
        expect(result.error.message).toContain('createVideo response is malformed');
      }
    });

    it('task creation accepts the documented shape, with status and created_at optional', async () => {
      fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ id: 'task-1' }) });

      const result = await requestJson(BASE_OPTIONS, {
        path: '/tasks',
        method: 'POST',
        body: '{}',
        decode: decodeCreateVideoTaskResponse,
      });

      expect(result).toEqual({ ok: true, value: { id: 'task-1' } });
    });

    it('task lookup keeps every optional field it validated', async () => {
      const body = {
        id: 'task-1',
        status: 'succeeded',
        content: { video_url: 'https://cdn.test/v.mp4' },
        mime_type: 'video/mp4',
        bytes: 1024,
        created_at: 1_700_000_000,
        updated_at: '2026-01-01T00:00:00Z',
      };
      fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify(body) });

      const result = await requestJson(BASE_OPTIONS, {
        path: '/tasks/task-1',
        method: 'GET',
        decode: decodeVideoTaskResponse('getVideoJob'),
      });

      expect(result).toEqual({ ok: true, value: body });
    });
  });
});
