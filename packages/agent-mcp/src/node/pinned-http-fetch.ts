import { openEgressExchange } from '@robota-sdk/agent-core/node';
import type { IEgressDeps, IEgressPolicy, TEgressRejectionReason } from '@robota-sdk/agent-core/node';

const OPEN_TIMEOUT_MS = 30_000;

interface IMCPPinnedHttpCarrier {
  readonly fetch: typeof globalThis.fetch;
  readonly signal: AbortSignal;
  close(): Promise<void>;
}

export class MCPTransportEgressRefusedError extends Error {
  constructor(readonly reason: TEgressRejectionReason | 'endpoint-mismatch') {
    // No URL, query, headers or carrier error text: these can contain an owner credential.
    super(`Streamable HTTP transport refused egress (${reason})`);
    this.name = 'MCPTransportEgressRefusedError';
  }
}

/** A session owns every response/connection, including authentication retry and SSE reconnect. */
export function createMcpPinnedFetch(endpoint: string, policy: IEgressPolicy, deps: IEgressDeps): IMCPPinnedHttpCarrier {
  const lifetime = new AbortController();
  const openings = new Set<Promise<Response>>();
  const active = new Set<() => Promise<void>>();

  async function open(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const inputUrl = input instanceof Request ? input.url : String(input);
    if (inputUrl !== endpoint) throw new MCPTransportEgressRefusedError('endpoint-mismatch');
    const request = new AbortController();
    const signals = [lifetime.signal, request.signal];
    if (init?.signal) signals.push(init.signal);
    const signal = AbortSignal.any(signals);
    const timer = setTimeout(() => request.abort(new DOMException('MCP HTTP opening timed out', 'TimeoutError')), OPEN_TIMEOUT_MS);
    let exchange;
    try {
      exchange = await openEgressExchange(new URL(endpoint), init ?? {}, policy, deps, signal);
    } finally {
      clearTimeout(timer);
    }
    if (!('response' in exchange)) throw new MCPTransportEgressRefusedError(exchange.reason);
    if (signal.aborted) {
      await exchange.close();
      signal.throwIfAborted();
    }
    const response = exchange.response;
    if (!response.body) {
      await exchange.close();
      return response;
    }
    const reader = response.body.getReader();
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      closing ??= (async () => {
        request.abort();
        try {
          try { await reader.cancel(); } catch { /* A failed/aborted body is already unreadable. */ }
          await exchange.close();
        } finally { active.delete(close); }
      })();
      return closing;
    };
    active.add(close);
    try {
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) { await close(); controller.close(); }
            else controller.enqueue(value);
          } catch (error) {
            await close();
            controller.error(error);
          }
        },
        cancel: () => close(),
      }, { highWaterMark: 0 });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) {
      await close();
      throw error;
    }
  }

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const opening = open(input, init);
    openings.add(opening);
    try { return await opening; } finally { openings.delete(opening); }
  };
  return {
    fetch,
    signal: lifetime.signal,
    async close() {
      lifetime.abort();
      await Promise.allSettled([...openings]);
      await Promise.all([...active].map((close) => close()));
    },
  };
}
