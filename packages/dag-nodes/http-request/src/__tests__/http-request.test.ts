import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpRequestNodeDefinition } from '../index.js';
import type { INodeExecutionContext, TPortPayload } from '@robota-sdk/dag-core';

function makeContext(config: Record<string, unknown> = {}): INodeExecutionContext {
  return {
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
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => 'hello',
      headers: new Headers(),
    });
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
    const mockFetch = vi.fn().mockResolvedValue({
      status: 404,
      ok: false,
      text: async () => 'Not Found',
      headers: new Headers(),
    });
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
});
