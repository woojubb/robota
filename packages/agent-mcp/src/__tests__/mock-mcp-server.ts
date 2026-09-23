import { createServer } from 'node:http';

import {
  handleInitialize,
  handleListRequest,
  handleToolsCall,
} from './mock-mcp-server-handlers.js';

import type { IMockServerRuntimeState } from './mock-mcp-server-handlers.js';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

const HTTP_NOT_FOUND = 404;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NO_CONTENT = 204;
const HTTP_ACCEPTED = 202;
const HTTP_BAD_REQUEST = 400;
const JSON_RPC_METHOD_NOT_FOUND = -32601;

export interface IRecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown> | undefined;
}

/** A single capability domain: an options object enables it, `false` declares it absent. */
export type IMockCapabilityDomain = { listChanged?: boolean } | false;

export interface IMockCapabilities {
  tools?: IMockCapabilityDomain;
  prompts?: IMockCapabilityDomain;
  resources?: IMockCapabilityDomain;
}

export interface IMockTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

export interface IMockPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface IMockPrompt {
  name: string;
  description?: string;
  arguments?: IMockPromptArgument[];
}

export interface IMockResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export type IMockListChangedDomain = 'tools' | 'prompts' | 'resources';

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
  /**
   * Declares which capability domains initialize reports. When omitted, reproduces today's
   * behaviour exactly: `capabilities: { tools: {} }`. When provided, a domain set to `false`
   * is omitted from the initialize result (declared-absent); a domain given as an object is
   * included as-is.
   */
  capabilities?: IMockCapabilities;
  /** protocolVersion echoed in the initialize result. Defaults to '2025-03-26'. */
  protocolVersion?: string;
  /** serverInfo echoed in the initialize result. Defaults to { name: 'mock-mcp', version: '1.0.0' }. */
  serverInfo?: { name: string; version: string };
  /** instructions echoed in the initialize result when set. */
  instructions?: string;
  /** Tools exposed via tools/list; also gates tools/call name validation when provided. */
  tools?: IMockTool[];
  /** Prompts exposed via prompts/list. */
  prompts?: IMockPrompt[];
  /** Resources exposed via resources/list. */
  resources?: IMockResource[];
  /** Page size for tools/list, prompts/list, resources/list. Defaults to everything in one page. */
  pageSize?: number;
  /** When true, every list response carries a fresh nextCursor forever (for a page-bound test). */
  endlessCursor?: boolean;
  /** Delay (ms) applied to list responses (for a per-request-timeout test). */
  listDelayMs?: number;
  /**
   * When set, the NEXT tools/call response is sent as an SSE stream carrying one
   * `notifications/<domain>/list_changed` event per listed domain before the JSON-RPC result
   * event. Cleared after it fires once. Can also be armed at runtime via `queueListChanged`.
   */
  emitListChangedBefore?: IMockListChangedDomain[];
  /** The first N POSTs get HTTP 401 with a text/plain 'unauthorized' body. */
  unauthorizedFirstRequests?: number;
  /** When true, respond 404 to everything. */
  notFoundPath?: boolean;
}

export interface IMockMcpServer {
  url: string;
  requests: IRecordedRequest[];
  close(): Promise<void>;
  /** Arms a one-shot server-initiated list_changed notification for the next tools/call. */
  queueListChanged(domains: IMockListChangedDomain[]): void;
}

/** Returns n tools named tool-1..tool-n plus an `echo` tool. */
export function mockTools(n: number): IMockTool[] {
  const tools: IMockTool[] = [];
  for (let i = 1; i <= n; i++) {
    tools.push({
      name: `tool-${i}`,
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    });
  }
  tools.push({
    name: 'echo',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  });
  return tools;
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

function buildCapabilities(
  capabilities: IMockCapabilities | undefined,
): Record<string, { listChanged?: boolean }> {
  if (!capabilities) {
    return { tools: {} };
  }
  const result: Record<string, { listChanged?: boolean }> = {};
  (['tools', 'prompts', 'resources'] as const).forEach((domain) => {
    const value = capabilities[domain];
    if (value === false || value === undefined) {
      return;
    }
    result[domain] = value;
  });
  return result;
}

/** Reads and JSON-parses the request body; an unparseable body is recorded as `undefined`. */
async function parseRequestBody(
  req: IncomingMessage,
): Promise<Record<string, unknown> | undefined> {
  const raw = await readBody(req);
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
  } catch {
    // allow-fallback: test fixture records unparseable bodies as undefined for assertions
    return undefined;
  }
}

/** The three request-independent early exits; returns `true` when one of them already responded. */
function respondIfGated(
  req: IncomingMessage,
  res: ServerResponse,
  options: IMockMcpServerOptions,
  state: IMockServerRuntimeState,
): boolean {
  if (options.notFoundPath) {
    res.writeHead(HTTP_NOT_FOUND, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return true;
  }

  if (req.method === 'POST' && options.unauthorizedFirstRequests !== undefined) {
    if (state.unauthorizedSeen < options.unauthorizedFirstRequests) {
      state.unauthorizedSeen++;
      res.writeHead(HTTP_UNAUTHORIZED, { 'Content-Type': 'text/plain' });
      res.end('unauthorized');
      return true;
    }
  }

  if (req.method === 'DELETE') {
    res.writeHead(HTTP_NO_CONTENT).end();
    return true;
  }

  return false;
}

function respondUnknownMethod(
  res: ServerResponse,
  id: string | number | undefined,
  methodName: string,
): void {
  res.writeHead(HTTP_BAD_REQUEST, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code: JSON_RPC_METHOD_NOT_FOUND, message: `Unknown method: ${methodName}` },
    }),
  );
}

/** One request, fully dispatched: parse, record, gate, then route by JSON-RPC method. */
async function dispatchRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: IMockMcpServerOptions,
  declaredCapabilities: Record<string, { listChanged?: boolean }>,
  isDomainDeclared: (domain: IMockListChangedDomain) => boolean,
  listItemsFor: (domain: IMockListChangedDomain) => IMockTool[] | IMockPrompt[] | IMockResource[],
  state: IMockServerRuntimeState,
  requests: IRecordedRequest[],
): Promise<void> {
  const body = await parseRequestBody(req);
  requests.push({
    method: req.method ?? '',
    url: req.url ?? '',
    headers: { ...req.headers },
    body,
  });

  if (respondIfGated(req, res, options, state)) {
    return;
  }

  const rpcMethod = body?.['method'];
  const id = body?.['id'] as string | number | undefined;

  if (rpcMethod === 'initialize') {
    handleInitialize(res, id, options, declaredCapabilities);
    return;
  }

  if (rpcMethod === 'notifications/initialized') {
    res.writeHead(HTTP_ACCEPTED).end();
    return;
  }

  if (
    (rpcMethod === 'tools/list' ||
      rpcMethod === 'prompts/list' ||
      rpcMethod === 'resources/list') &&
    isDomainDeclared(rpcMethod.split('/')[0] as IMockListChangedDomain)
  ) {
    const domain = rpcMethod.split('/')[0] as IMockListChangedDomain;
    const params = body?.['params'] as Record<string, unknown> | undefined;
    handleListRequest(domain, params, id, listItemsFor(domain), options, res);
    return;
  }

  if (rpcMethod === 'tools/call') {
    handleToolsCall(body, id, options, state, res);
    return;
  }

  respondUnknownMethod(res, id, String(rpcMethod));
}

export async function startMockMcpServer(
  options: IMockMcpServerOptions = {},
): Promise<IMockMcpServer> {
  const requests: IRecordedRequest[] = [];
  const state: IMockServerRuntimeState = {
    toolCallFailures: 0,
    unauthorizedSeen: 0,
    pendingListChanged: options.emitListChangedBefore ? [...options.emitListChangedBefore] : [],
  };

  const declaredCapabilities = buildCapabilities(options.capabilities);
  const isDomainDeclared = (domain: IMockListChangedDomain): boolean =>
    Object.prototype.hasOwnProperty.call(declaredCapabilities, domain);

  const listItemsFor = (
    domain: IMockListChangedDomain,
  ): IMockTool[] | IMockPrompt[] | IMockResource[] => {
    if (domain === 'tools') return options.tools ?? [];
    if (domain === 'prompts') return options.prompts ?? [];
    return options.resources ?? [];
  };

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void dispatchRequest(
      req,
      res,
      options,
      declaredCapabilities,
      isDomainDeclared,
      listItemsFor,
      state,
      requests,
    );
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
    queueListChanged: (domains: IMockListChangedDomain[]): void => {
      state.pendingListChanged = [...domains];
    },
  };
}
