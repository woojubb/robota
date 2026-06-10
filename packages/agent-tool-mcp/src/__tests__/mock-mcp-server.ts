import { createServer } from 'node:http';

import type { IncomingMessage, Server, ServerResponse } from 'node:http';

export interface IRecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown> | undefined;
}

export interface IMockMcpServerOptions {
  /** Session id returned from initialize via the Mcp-Session-Id header. */
  sessionId?: string;
  /** Delay (ms) applied to tools/call responses. */
  toolCallDelayMs?: number;
  /** Respond to tools/call with a JSON-RPC error. */
  toolCallJsonRpcError?: { code: number; message: string };
  /** Respond to tools/call with an isError tool result. */
  toolCallIsError?: boolean;
  /** Fail the first N tools/call requests with HTTP 500. */
  failFirstToolCalls?: number;
  /** Text returned in the tool result content. */
  toolResultText?: string;
}

export interface IMockMcpServer {
  url: string;
  requests: IRecordedRequest[];
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString('utf8');
    });
    req.on('end', () => resolve(data));
  });
}

export async function startMockMcpServer(
  options: IMockMcpServerOptions = {},
): Promise<IMockMcpServer> {
  const requests: IRecordedRequest[] = [];
  let toolCallFailures = 0;

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const raw = await readBody(req);
      let body: Record<string, unknown> | undefined;
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
      } catch {
        // allow-fallback: test fixture records unparseable bodies as undefined for assertions
        body = undefined;
      }
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: { ...req.headers },
        body,
      });

      if (req.method === 'DELETE') {
        res.writeHead(204).end();
        return;
      }

      const rpcMethod = body?.['method'];
      const id = body?.['id'] as string | number | undefined;

      if (rpcMethod === 'initialize') {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (options.sessionId) headers['Mcp-Session-Id'] = options.sessionId;
        res.writeHead(200, headers);
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2025-03-26',
              capabilities: { tools: {} },
              serverInfo: { name: 'mock-mcp', version: '1.0.0' },
            },
          }),
        );
        return;
      }

      if (rpcMethod === 'notifications/initialized') {
        res.writeHead(202).end();
        return;
      }

      if (rpcMethod === 'tools/call') {
        if (options.failFirstToolCalls && toolCallFailures < options.failFirstToolCalls) {
          toolCallFailures++;
          res.writeHead(500, { 'Content-Type': 'text/plain' }).end('boom');
          return;
        }
        const respond = (): void => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          if (options.toolCallJsonRpcError) {
            res.end(JSON.stringify({ jsonrpc: '2.0', id, error: options.toolCallJsonRpcError }));
            return;
          }
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: options.toolResultText ?? 'mock tool output' }],
                isError: options.toolCallIsError ?? false,
              },
            }),
          );
        };
        if (options.toolCallDelayMs) {
          setTimeout(respond, options.toolCallDelayMs);
        } else {
          respond();
        }
        return;
      }

      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: id ?? null,
          error: { code: -32601, message: `Unknown method: ${String(rpcMethod)}` },
        }),
      );
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Mock MCP server failed to bind a port');
  }

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
