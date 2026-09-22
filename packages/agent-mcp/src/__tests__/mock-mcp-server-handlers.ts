/**
 * Per-JSON-RPC-method response handlers for the mock MCP server (`./mock-mcp-server.ts`), split out
 * to keep `startMockMcpServer`'s request listener under this repo's line/complexity budget.
 * Behaviour is unchanged from the pre-split version — every branch below is a verbatim move.
 */

import type {
  IMockListChangedDomain,
  IMockMcpServerOptions,
  IMockPrompt,
  IMockResource,
  IMockTool,
} from './mock-mcp-server.js';
import type { ServerResponse } from 'node:http';

const HTTP_OK = 200;
const HTTP_INTERNAL_SERVER_ERROR = 500;

const JSON_RPC_INVALID_PARAMS = -32602;

/** Mutable per-server counters/queues the handlers below read and update across requests. */
export interface IMockServerRuntimeState {
  toolCallFailures: number;
  unauthorizedSeen: number;
  pendingListChanged: IMockListChangedDomain[];
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64');
}

/** Decodes an opaque cursor to an offset, or undefined when it is not a valid cursor. */
function decodeCursor(cursor: string): number | undefined {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64').toString('utf8');
  } catch {
    // allow-fallback: test fixture treats an undecodable cursor as invalid rather than throwing
    return undefined;
  }
  const offset = Number(decoded);
  if (!Number.isInteger(offset) || offset < 0) {
    return undefined;
  }
  return offset;
}

export function handleInitialize(
  res: ServerResponse,
  id: string | number | undefined,
  options: IMockMcpServerOptions,
  declaredCapabilities: Record<string, { listChanged?: boolean }>,
): void {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.sessionId) headers['Mcp-Session-Id'] = options.sessionId;
  res.writeHead(HTTP_OK, headers);
  const result: Record<string, unknown> = {
    protocolVersion: options.protocolVersion ?? '2025-03-26',
    capabilities: declaredCapabilities,
    serverInfo: options.serverInfo ?? { name: 'mock-mcp', version: '1.0.0' },
  };
  if (options.instructions !== undefined) {
    result['instructions'] = options.instructions;
  }
  res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
}

export function handleListRequest(
  domain: IMockListChangedDomain,
  params: Record<string, unknown> | undefined,
  id: string | number | undefined,
  items: IMockTool[] | IMockPrompt[] | IMockResource[],
  options: IMockMcpServerOptions,
  res: ServerResponse,
): void {
  const respond = (): void => {
    const cursorParam = params?.['cursor'];
    let offset = 0;
    if (cursorParam !== undefined) {
      if (typeof cursorParam !== 'string') {
        sendJson(res, HTTP_OK, {
          jsonrpc: '2.0',
          id: id ?? null,
          error: { code: JSON_RPC_INVALID_PARAMS, message: 'Invalid cursor' },
        });
        return;
      }
      const decoded = decodeCursor(cursorParam);
      if (decoded === undefined) {
        sendJson(res, HTTP_OK, {
          jsonrpc: '2.0',
          id: id ?? null,
          error: { code: JSON_RPC_INVALID_PARAMS, message: 'Invalid cursor' },
        });
        return;
      }
      offset = decoded;
    }
    const size = options.pageSize ?? items.length;
    const page = items.slice(offset, offset + size);
    const nextOffset = offset + size;
    const result: Record<string, unknown> = { [domain]: page };
    if (options.endlessCursor || nextOffset < items.length) {
      result['nextCursor'] = encodeCursor(nextOffset);
    }
    sendJson(res, HTTP_OK, { jsonrpc: '2.0', id, result });
  };

  if (options.listDelayMs) {
    setTimeout(respond, options.listDelayMs);
  } else {
    respond();
  }
}

function buildToolCallResponse(
  id: string | number | undefined,
  options: IMockMcpServerOptions,
  params: { name?: string; arguments?: Record<string, unknown> } | undefined,
  toolName: string | undefined,
): Record<string, unknown> {
  if (options.toolCallJsonRpcError) {
    return { jsonrpc: '2.0', id, error: options.toolCallJsonRpcError };
  }
  return {
    jsonrpc: '2.0',
    id,
    result: {
      content: [
        {
          type: 'text',
          text:
            options.toolResultText ??
            (options.tools && toolName === 'echo'
              ? JSON.stringify(params?.arguments ?? {})
              : 'mock tool output'),
        },
      ],
      isError: options.toolCallIsError ?? false,
    },
  };
}

function emitListChangedThenResult(
  res: ServerResponse,
  state: IMockServerRuntimeState,
  rpcResponse: Record<string, unknown>,
): void {
  const domains = state.pendingListChanged;
  state.pendingListChanged = [];
  res.writeHead(HTTP_OK, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  for (const domain of domains) {
    const notification = { jsonrpc: '2.0', method: `notifications/${domain}/list_changed` };
    res.write(`event: message\ndata: ${JSON.stringify(notification)}\n\n`);
  }
  res.write(`event: message\ndata: ${JSON.stringify(rpcResponse)}\n\n`);
  res.end();
}

export function handleToolsCall(
  body: Record<string, unknown> | undefined,
  id: string | number | undefined,
  options: IMockMcpServerOptions,
  state: IMockServerRuntimeState,
  res: ServerResponse,
): void {
  const params = body?.['params'] as
    { name?: string; arguments?: Record<string, unknown> } | undefined;
  const toolName = params?.name;

  if (options.tools && !options.tools.some((tool) => tool.name === toolName)) {
    sendJson(res, HTTP_OK, {
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code: JSON_RPC_INVALID_PARAMS, message: `Unknown tool: ${String(toolName)}` },
    });
    return;
  }

  if (options.failFirstToolCalls && state.toolCallFailures < options.failFirstToolCalls) {
    state.toolCallFailures++;
    res.writeHead(HTTP_INTERNAL_SERVER_ERROR, { 'Content-Type': 'text/plain' }).end('boom');
    return;
  }

  const respond = (): void => {
    const rpcResponse = buildToolCallResponse(id, options, params, toolName);
    if (state.pendingListChanged.length > 0) {
      emitListChangedThenResult(res, state, rpcResponse);
      return;
    }
    res.writeHead(HTTP_OK, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rpcResponse));
  };

  if (options.toolCallDelayMs) {
    setTimeout(respond, options.toolCallDelayMs);
  } else {
    respond();
  }
}
