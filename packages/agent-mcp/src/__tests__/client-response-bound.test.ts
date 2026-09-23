import { describe, expect, it } from 'vitest';

import {
  MCPTransportResponseLimitError,
  createStreamableHttpAdapter,
} from '../client/transport.js';
import { classifyMcpFailure } from '../supervisor/connection.js';

import type { TEgressLookup } from '@robota-sdk/agent-core/node';

describe('Streamable HTTP receive bound', () => {
  it('refuses chunked output before the SDK can materialize or parse the whole response', async () => {
    let cancelled = false;
    let chunkCount = 0;
    const bytes = new Uint8Array(4 * 1024 * 1024);
    const fetchStub = (async () => {
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          chunkCount += 1;
          controller.enqueue(bytes);
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;
    const lookup: TEgressLookup = async () => ['203.0.113.9'];
    const adapter = createStreamableHttpAdapter({ fetch: fetchStub, lookup });
    const admission = await adapter.admit({ url: 'https://mcp.example.test/mcp' });
    expect(admission.ok).toBe(true);
    if (!admission.ok) return;

    const transport = adapter.construct(admission.admitted);
    const error = await transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' }).then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(MCPTransportResponseLimitError);
    expect(classifyMcpFailure(error)).toBe('config');
    expect(chunkCount).toBeLessThanOrEqual(4);
    expect(cancelled).toBe(true);
  });
});
