import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpRequestNodeDefinition } from '../index.js';
import type { INodeExecutionContext, TPortPayload } from '@robota-sdk/dag-core';

function makeContext(config: Record<string, unknown> = {}): INodeExecutionContext {
  return {
    executionRoot: '/test/execution-root',
    nodeDefinition: {
      nodeId: 'test-node-id',
      nodeType: 'http-request',
      config,
      inputs: [],
      outputs: [],
    },
    dagRunId: 'test-dag-run-id',
    dagId: 'test-dag-id',
  } as unknown as INodeExecutionContext; // allow-any: minimal test stub
}

describe('HttpRequestNodeDefinition', () => {
  const node = new HttpRequestNodeDefinition();

  beforeEach(() => {
    vi.stubGlobal('fetch', undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('TC-01: returns ok=true with statusCode=200 and body on successful fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('hello', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const input: TPortPayload = { url: 'https://example.com' };
    const context = makeContext({ method: 'GET', url: '', headers: {}, timeoutMs: 10000 });

    const result = await node.taskHandler.execute(input, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value['statusCode']).toBe(200);
    expect(result.value['body']).toBe('hello');
    expect(result.value['ok']).toBe(true);
  });

  it('TC-02: node succeeds (ok=true) but output.ok=false on 404 response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 }));
    vi.stubGlobal('fetch', mockFetch);

    const input: TPortPayload = { url: 'https://example.com/missing' };
    const context = makeContext({ method: 'GET', url: '', headers: {}, timeoutMs: 10000 });

    const result = await node.taskHandler.execute(input, context);

    // The node itself succeeded — HTTP error codes are not node failures
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value['ok']).toBe(false);
    expect(result.value['statusCode']).toBe(404);
    expect(result.value['body']).toBe('Not Found');
  });

  it('TC-03: returns errorCode=TIMEOUT when fetch aborts', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    const mockFetch = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal('fetch', mockFetch);

    const input: TPortPayload = { url: 'https://example.com/slow' };
    const context = makeContext({ method: 'GET', url: '', headers: {}, timeoutMs: 10000 });

    const result = await node.taskHandler.execute(input, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DAG_TASK_EXECUTION_HTTP_REQUEST_FAILED');
    expect(result.error.context?.['errorCode']).toBe('TIMEOUT');
  });

  it('CORE-027: a failure whose PROSE says "abort" is a network error, not this node\'s timeout', async () => {
    // The classification reads the node's own timeout signal and the platform's abort name —
    // never the message. A peer's phrasing must not borrow the timeout's error code.
    const proseError = new Error('connection aborted by peer');
    const mockFetch = vi.fn().mockRejectedValue(proseError);
    vi.stubGlobal('fetch', mockFetch);

    const input: TPortPayload = { url: 'https://example.com/flaky' };
    const context = makeContext({ method: 'GET', url: '', headers: {}, timeoutMs: 10000 });

    const result = await node.taskHandler.execute(input, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.context?.['errorCode'], 'prose was read as a timeout').toBe(
      'NETWORK_ERROR',
    );
  });

  it('TC-04: fails with DAG_VALIDATION_HTTP_REQUEST_URL_REQUIRED when url is empty', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    // No url in input, empty url in config
    const input: TPortPayload = {};
    const context = makeContext({ method: 'GET', url: '', headers: {}, timeoutMs: 10000 });

    const result = await node.taskHandler.execute(input, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DAG_VALIDATION_HTTP_REQUEST_URL_REQUIRED');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects an oversized response before reading the rest of its stream', async () => {
    let pulls = 0;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        if (pulls > 2) controller.close();
        else controller.enqueue(new TextEncoder().encode(pulls === 1 ? 'abc' : 'd'));
      },
    }, { highWaterMark: 0 }));
    const text = vi.spyOn(response, 'text');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const context = {
      ...makeContext({ method: 'GET', url: '', headers: {}, timeoutMs: 1000 }),
      byteLimits: { maxTextRepeatOutputBytes: 4 * 1024 * 1024, maxHttpResponseBodyBytes: 3 },
    } as INodeExecutionContext;
    const result = await node.taskHandler.execute({ url: 'https://example.com' }, context);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'DAG_TASK_EXECUTION_BYTE_LIMIT_EXCEEDED', retryable: false },
    });
    expect(pulls).toBe(2);
    expect(text).not.toHaveBeenCalled();
  });

  it('counts decoded UTF-8 bytes even when the response carries fewer raw bytes', async () => {
    const context = {
      ...makeContext({ method: 'GET', url: '', headers: {}, timeoutMs: 1000 }),
      byteLimits: { maxTextRepeatOutputBytes: 4 * 1024 * 1024, maxHttpResponseBodyBytes: 2 },
    } as INodeExecutionContext;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([0xff]))));
    const decoded = await node.taskHandler.execute({ url: 'https://example.com' }, context);
    expect(decoded).toMatchObject({ ok: false, error: { code: 'DAG_TASK_EXECUTION_BYTE_LIMIT_EXCEEDED' } });
  });

  it('accepts a bodyless 304 even when its representation length exceeds the body limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, {
      status: 304,
      headers: { 'content-length': '4194305' },
    })));
    const result = await node.taskHandler.execute(
      { url: 'https://example.com' },
      makeContext({ method: 'GET', url: '', headers: {}, timeoutMs: 1000 }),
    );
    expect(result).toMatchObject({ ok: true, value: { statusCode: 304, body: '' } });
  });

  it('preserves UTF-8 characters split across response chunks at the exact limit', async () => {
    const chunks = [new Uint8Array([0xf0, 0x9f]), new Uint8Array([0x98, 0x80])];
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks.shift();
        if (next) controller.enqueue(next);
        else controller.close();
      },
    }, { highWaterMark: 0 }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const context = {
      ...makeContext({ method: 'GET', url: '', headers: {}, timeoutMs: 1000 }),
      byteLimits: { maxTextRepeatOutputBytes: 4 * 1024 * 1024, maxHttpResponseBodyBytes: 4 },
    } as INodeExecutionContext;
    const result = await node.taskHandler.execute({ url: 'https://example.com' }, context);
    expect(result).toMatchObject({ ok: true, value: { body: '😀' } });
  });

  it('reads a response in a browser environment without a Node Buffer global', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('hello')));
    const savedBuffer = globalThis.Buffer;
    let result: Awaited<ReturnType<typeof node.taskHandler.execute>>;
    vi.stubGlobal('Buffer', undefined);
    try {
      result = await node.taskHandler.execute(
        { url: 'https://example.com' },
        makeContext({ method: 'GET', url: '', headers: {}, timeoutMs: 1000 }),
      );
    } finally {
      vi.stubGlobal('Buffer', savedBuffer);
    }
    expect(result).toMatchObject({ ok: true, value: { body: 'hello' } });
  });

  it('keeps the request timeout active while reading the response body', async () => {
    let unblock: (() => void) | undefined;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>((resolve) => { unblock = resolve; });
      },
    }, { highWaterMark: 0 }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const context = makeContext({ method: 'GET', url: '', headers: {}, timeoutMs: 10 });

    const result = await Promise.race([
      node.taskHandler.execute({ url: 'https://example.com' }, context),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 150)),
    ]);
    unblock?.();
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'DAG_TASK_EXECUTION_HTTP_REQUEST_FAILED', context: { errorCode: 'TIMEOUT' } },
    });
  });
});
