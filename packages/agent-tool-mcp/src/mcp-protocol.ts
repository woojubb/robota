import type { TToolParameters } from '@robota-sdk/agent-core';
import type { IUniversalObjectValue } from '@robota-sdk/agent-core';

const ID_RADIX = 36;
const ID_SUBSTR_END = 11;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_RETRIES = 3;
const RETRY_BACKOFF_MS = 250;
const MCP_PROTOCOL_VERSION = '2025-03-26';

/**
 * MCP (Model Context Protocol) tool configuration.
 * Transport: Streamable HTTP (JSON-RPC 2.0 over HTTP POST). stdio is out of scope.
 */
export interface IMCPConfig {
  endpoint: string;
  apiKey?: string;
  timeout?: number;
  retries?: number;
  headers?: Record<string, string>;
}

/**
 * MCP protocol message types (JSON-RPC 2.0)
 */
export interface IMCPRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface IMCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: IMCPToolCallResult;
  error?: IMCPError;
}

/** `tools/call` params per the MCP specification. */
export interface IMCPToolCallParams {
  name: string;
  arguments: TToolParameters;

  [key: string]: unknown;
}

/** A single content part of an MCP tool result. */
export interface IMCPContentPart {
  type: string;
  text?: string;

  [key: string]: unknown;
}

/** `tools/call` result per the MCP specification. */
export interface IMCPToolCallResult {
  content?: IMCPContentPart[];
  isError?: boolean;

  [key: string]: unknown;
}

export interface IMCPError {
  code: number;
  message: string;
  data?: Record<string, string | number | boolean>;
}

/**
 * MCP connection status
 */
export type TMCPConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'connecting'
  | 'disconnecting'
  | 'error';

/**
 * Build a JSON-RPC 2.0 `tools/call` request from tool name and parameters.
 */
export function buildMCPRequest(toolName: string, parameters: TToolParameters): IMCPRequest {
  const requestId = `${toolName}-${Date.now()}-${Math.random().toString(ID_RADIX).substring(2, ID_SUBSTR_END)}`;

  const params: IMCPToolCallParams = {
    name: toolName,
    arguments: parameters,
  };

  return {
    jsonrpc: '2.0',
    id: requestId,
    method: 'tools/call',
    params,
  } satisfies IMCPRequest;
}

function buildHeaders(config: IMCPConfig, sessionId: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...(config.headers ?? {}),
  };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }
  if (sessionId) {
    headers['Mcp-Session-Id'] = sessionId;
  }
  return headers;
}

/** Parse an SSE body and return the JSON-RPC message matching the request id. */
function parseSseResponse(body: string, requestId: string | number): IMCPResponse {
  for (const block of body.split('\n\n')) {
    for (const line of block.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice('data:'.length).trim();
      if (!payload) continue;
      let parsed: IMCPResponse;
      try {
        parsed = JSON.parse(payload) as IMCPResponse;
      } catch {
        // allow-fallback: non-JSON SSE data lines (comments/keepalives) are skipped while scanning for the response
        continue;
      }
      if (parsed.id === requestId) {
        return parsed;
      }
    }
  }
  throw new Error(`MCP SSE response did not contain a message for request id ${requestId}`);
}

export interface IMCPSendResult {
  response: IMCPResponse | null;
  sessionId: string | undefined;
}

function isRetryableStatus(status: number): boolean {
  return status >= 500;
}

/**
 * Send a JSON-RPC message to the MCP endpoint over Streamable HTTP.
 *
 * - Requests (with `id`) resolve to the parsed JSON-RPC response (JSON or SSE body).
 * - Notifications (no `id`) resolve to `response: null` once accepted.
 * - `config.timeout` bounds each attempt via AbortSignal; timeouts are not retried.
 * - `config.retries` retries network-level failures and HTTP 5xx with linear backoff.
 */
export async function sendMCPRequest(
  request: IMCPRequest,
  config: IMCPConfig,
  sessionId?: string,
  signal?: AbortSignal,
): Promise<IMCPSendResult> {
  const timeoutMs = config.timeout ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = (config.retries ?? DEFAULT_RETRIES) + 1;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw lastError ?? new Error('MCP request aborted');
    }
    if (attempt > 1) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS * (attempt - 1)));
    }

    let response: Response;
    try {
      response = await fetch(config.endpoint, {
        method: 'POST',
        headers: buildHeaders(config, sessionId),
        body: JSON.stringify(request),
        // CORE-018: the run-scoped signal aborts the in-flight request alongside the timeout.
        signal: signal
          ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal])
          : AbortSignal.timeout(timeoutMs),
      });
    } catch (raw) {
      // allow-fallback: network-level failures feed the bounded retry loop and are rethrown when exhausted
      const error = raw instanceof Error ? raw : new Error(String(raw));
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw new Error(`MCP request timed out after ${timeoutMs}ms (${request.method})`);
      }
      lastError = error;
      continue;
    }

    const newSessionId = response.headers.get('Mcp-Session-Id') ?? sessionId;

    if (!response.ok) {
      const text = await response.text();
      const failure = new Error(
        `MCP server responded ${response.status} for ${request.method}: ${text.slice(0, 200)}`,
      );
      if (isRetryableStatus(response.status)) {
        lastError = failure;
        continue;
      }
      throw failure;
    }

    if (request.id === undefined) {
      return { response: null, sessionId: newSessionId ?? undefined };
    }

    const contentType = response.headers.get('Content-Type') ?? '';
    const bodyText = await response.text();
    const parsed = contentType.includes('text/event-stream')
      ? parseSseResponse(bodyText, request.id)
      : (JSON.parse(bodyText) as IMCPResponse);

    return { response: parsed, sessionId: newSessionId ?? undefined };
  }

  throw new Error(
    `MCP request failed after ${maxAttempts} attempt(s) (${request.method}): ${lastError?.message ?? 'unknown error'}`,
  );
}

/**
 * Perform the MCP initialize handshake: `initialize` request followed by the
 * `notifications/initialized` notification. Returns the negotiated session id, if any.
 */
export async function initializeMCPSession(config: IMCPConfig): Promise<string | undefined> {
  const initRequest: IMCPRequest = {
    jsonrpc: '2.0',
    id: `init-${Date.now()}-${Math.random().toString(ID_RADIX).substring(2, ID_SUBSTR_END)}`,
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'robota-agent-tool-mcp', version: '1.0.0' },
    },
  };

  const { response, sessionId } = await sendMCPRequest(initRequest, config);
  if (response?.error) {
    throw new Error(`MCP initialize failed: ${response.error.message} (${response.error.code})`);
  }

  await sendMCPRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }, config, sessionId);

  return sessionId;
}

/** Best-effort session termination per the Streamable HTTP transport (HTTP DELETE). */
export async function terminateMCPSession(
  config: IMCPConfig,
  sessionId: string | undefined,
): Promise<void> {
  await fetch(config.endpoint, {
    method: 'DELETE',
    headers: buildHeaders(config, sessionId),
    signal: AbortSignal.timeout(config.timeout ?? DEFAULT_TIMEOUT_MS),
  });
}

/**
 * Extract the text content from a successful MCP tool result.
 * Throws when the response carries a JSON-RPC error or an `isError` result.
 */
export function processMCPResponse(response: IMCPResponse): IUniversalObjectValue {
  if (response.error) {
    throw new Error(`MCP tool error ${response.error.code}: ${response.error.message}`);
  }

  const result = response.result;
  if (!result) {
    throw new Error('MCP response carried neither result nor error');
  }

  const text = (result.content ?? [])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n');

  if (result.isError) {
    throw new Error(`MCP tool reported an error: ${text || 'no error detail provided'}`);
  }

  return {
    success: true,
    content: text,
  };
}
